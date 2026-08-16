import asyncio
import time
from collections.abc import Mapping
from typing import Any
from urllib.parse import urlsplit

import httpx
import jwt

from app.core.config import Settings


class InvalidBearerToken(Exception):
    """The presented bearer token failed local validation."""


class OIDCProviderUnavailable(Exception):
    """The configured OIDC provider could not supply validation metadata."""


class OIDCTokenVerifier:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._metadata: dict[str, Any] | None = None
        self._jwks: dict[str, Any] | None = None
        self._metadata_expires_at = 0.0
        self._jwks_expires_at = 0.0
        self._lock = asyncio.Lock()

    async def verify(self, token: str) -> dict[str, Any]:
        if not token or len(token) > self.settings.oidc_max_token_length:
            raise InvalidBearerToken("invalid bearer token length")

        try:
            header = jwt.get_unverified_header(token)
        except jwt.InvalidTokenError as exc:
            raise InvalidBearerToken("malformed bearer token") from exc

        algorithm = header.get("alg")
        key_id = header.get("kid")
        token_type = header.get("typ")
        if not isinstance(algorithm, str) or algorithm not in self.settings.oidc_algorithms:
            raise InvalidBearerToken("bearer token uses an unsupported algorithm")
        if not isinstance(key_id, str) or not key_id:
            raise InvalidBearerToken("bearer token is missing kid")
        if not isinstance(token_type, str) or token_type not in self.settings.oidc_token_types:
            raise InvalidBearerToken("bearer token has an unsupported type")

        jwk = await self._find_jwk(key_id)
        if jwk is None:
            jwk = await self._find_jwk(key_id, force_refresh=True)
        if jwk is None:
            raise InvalidBearerToken("bearer token signing key was not found")

        try:
            signing_key = jwt.PyJWK.from_dict(jwk, algorithm=algorithm).key
            claims = jwt.decode(
                token,
                key=signing_key,
                algorithms=sorted(self.settings.oidc_algorithms),
                audience=self.settings.oidc_audience,
                issuer=self.settings.oidc_issuer,
                leeway=self.settings.oidc_clock_skew_seconds,
                options={"require": ["aud", "exp", "iat", "iss", "sub"]},
            )
        except (jwt.InvalidTokenError, ValueError, TypeError) as exc:
            raise InvalidBearerToken("bearer token validation failed") from exc
        if not isinstance(claims, dict):
            raise InvalidBearerToken("bearer token claims must be an object")
        return claims

    async def _find_jwk(self, key_id: str, *, force_refresh: bool = False) -> dict[str, Any] | None:
        jwks = await self._get_jwks(force_refresh=force_refresh)
        keys = jwks.get("keys")
        if not isinstance(keys, list):
            raise OIDCProviderUnavailable("OIDC JWKS payload is missing keys")
        for item in keys:
            if not isinstance(item, dict) or item.get("kid") != key_id:
                continue
            if item.get("use") not in {None, "sig"}:
                continue
            key_ops = item.get("key_ops")
            if key_ops is not None and (
                not isinstance(key_ops, list) or "verify" not in key_ops
            ):
                continue
            algorithm = item.get("alg")
            if algorithm is not None and algorithm not in self.settings.oidc_algorithms:
                continue
            return item
        return None

    async def _get_jwks(self, *, force_refresh: bool = False) -> dict[str, Any]:
        now = time.monotonic()
        if not force_refresh and self._jwks is not None and now < self._jwks_expires_at:
            return self._jwks

        async with self._lock:
            now = time.monotonic()
            if not force_refresh and self._jwks is not None and now < self._jwks_expires_at:
                return self._jwks
            jwks_url = self.settings.oidc_jwks_url or await self._discovered_jwks_url()
            payload = await self._fetch_json(jwks_url)
            if not isinstance(payload.get("keys"), list):
                raise OIDCProviderUnavailable("OIDC JWKS payload is invalid")
            self._jwks = payload
            self._jwks_expires_at = now + self.settings.oidc_jwks_cache_seconds
            return payload

    async def _discovered_jwks_url(self) -> str:
        now = time.monotonic()
        if self._metadata is None or now >= self._metadata_expires_at:
            discovery_url = (
                f"{self.settings.oidc_issuer.rstrip('/')}/.well-known/openid-configuration"
            )
            metadata = await self._fetch_json(discovery_url)
            if metadata.get("issuer") != self.settings.oidc_issuer:
                raise OIDCProviderUnavailable("OIDC discovery issuer does not match configuration")
            self._metadata = metadata
            self._metadata_expires_at = now + self.settings.oidc_jwks_cache_seconds

        jwks_url = self._metadata.get("jwks_uri")
        if not isinstance(jwks_url, str) or not jwks_url:
            raise OIDCProviderUnavailable("OIDC discovery metadata is missing jwks_uri")
        return jwks_url

    async def _fetch_json(self, url: str) -> dict[str, Any]:
        parsed = urlsplit(url)
        production = self.settings.env.lower() in {"prod", "production"}
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.fragment
            or (production and parsed.scheme != "https")
        ):
            raise OIDCProviderUnavailable("OIDC metadata URL is not allowed")
        try:
            async with httpx.AsyncClient(
                timeout=self.settings.oidc_http_timeout_seconds,
                follow_redirects=False,
            ) as client:
                response = await client.get(url, headers={"Accept": "application/json"})
                response.raise_for_status()
                payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise OIDCProviderUnavailable("OIDC metadata request failed") from exc
        if not isinstance(payload, Mapping):
            raise OIDCProviderUnavailable("OIDC metadata response must be an object")
        return dict(payload)
