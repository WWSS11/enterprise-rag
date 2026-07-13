import json
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import FastAPI
from jwt.algorithms import RSAAlgorithm
from pydantic import ValidationError

import app.api.dependencies as auth_dependencies
from app.api.dependencies import get_oidc_token_verifier
from app.api.v1.auth import router as auth_router
from app.core.config import Settings
from app.core.errors import install_exception_handlers
from app.schemas.knowledge_base import KnowledgeBaseMemberUpsert
from app.security.oidc import InvalidBearerToken, OIDCTokenVerifier

ISSUER = "http://issuer.test/realms/enterprise-rag"
AUDIENCE = "enterprise-rag-api"


class StaticJWKVerifier(OIDCTokenVerifier):
    def __init__(self, settings: Settings, jwk: dict[str, Any]) -> None:
        super().__init__(settings)
        self.jwk = jwk

    async def _get_jwks(self, *, force_refresh: bool = False) -> dict[str, Any]:
        return {"keys": [self.jwk]}


def _settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "auth_mode": "oidc",
        "oidc_issuer": ISSUER,
        "oidc_audience": AUDIENCE,
        "oidc_jwks_url": "http://issuer.test/jwks",
        "oidc_algorithms": {"RS256"},
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


@pytest.fixture
def signing_material() -> tuple[Any, dict[str, Any]]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = json.loads(RSAAlgorithm.to_jwk(private_key.public_key()))
    jwk.update({"kid": "test-key", "alg": "RS256", "use": "sig"})
    return private_key, jwk


def _token(private_key: Any, **claim_overrides: Any) -> str:
    now = datetime.now(UTC)
    claims: dict[str, Any] = {
        "iss": ISSUER,
        "aud": [AUDIENCE],
        "sub": "11111111-1111-4111-8111-111111111111",
        "iat": now,
        "exp": now + timedelta(minutes=5),
        "tenant_id": "default",
        "realm_access": {"roles": ["rag-user", "rag-admin"]},
        "groups": ["engineering"],
    }
    claims.update(claim_overrides)
    return jwt.encode(
        claims,
        private_key,
        algorithm="RS256",
        headers={"kid": "test-key", "typ": "JWT"},
    )


@pytest.mark.asyncio
async def test_oidc_verifier_accepts_expected_audience(
    signing_material: tuple[Any, dict[str, Any]],
) -> None:
    private_key, jwk = signing_material
    claims = await StaticJWKVerifier(_settings(), jwk).verify(_token(private_key))
    assert claims["aud"] == [AUDIENCE]
    assert claims["tenant_id"] == "default"


@pytest.mark.asyncio
async def test_oidc_verifier_rejects_wrong_audience_and_expired_token(
    signing_material: tuple[Any, dict[str, Any]],
) -> None:
    private_key, jwk = signing_material
    verifier = StaticJWKVerifier(_settings(oidc_clock_skew_seconds=0), jwk)

    with pytest.raises(InvalidBearerToken):
        await verifier.verify(_token(private_key, aud=["another-api"]))
    with pytest.raises(InvalidBearerToken):
        await verifier.verify(
            _token(private_key, exp=datetime.now(UTC) - timedelta(seconds=1))
        )


@pytest.mark.asyncio
async def test_oidc_verifier_rejects_wrong_issuer_and_signature(
    signing_material: tuple[Any, dict[str, Any]],
) -> None:
    private_key, jwk = signing_material
    verifier = StaticJWKVerifier(_settings(), jwk)

    with pytest.raises(InvalidBearerToken):
        await verifier.verify(_token(private_key, iss="http://attacker.test/realm"))

    attacker_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    with pytest.raises(InvalidBearerToken):
        await verifier.verify(_token(attacker_key))


@pytest.mark.asyncio
async def test_oidc_dependency_is_injectable_and_rejects_trusted_headers(
    monkeypatch: pytest.MonkeyPatch,
    signing_material: tuple[Any, dict[str, Any]],
) -> None:
    private_key, jwk = signing_material
    settings = _settings()
    verifier = StaticJWKVerifier(settings, jwk)
    monkeypatch.setattr(auth_dependencies, "get_settings", lambda: settings)

    test_app = FastAPI()
    install_exception_handlers(test_app)
    test_app.include_router(auth_router, prefix="/auth")
    test_app.dependency_overrides[get_oidc_token_verifier] = lambda: verifier

    transport = httpx.ASGITransport(app=test_app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        missing = await client.get("/auth/me")
        rejected_header = await client.get(
            "/auth/me",
            headers={
                "Authorization": f"Bearer {_token(private_key)}",
                "X-Tenant-Id": "default",
            },
        )
        accepted = await client.get(
            "/auth/me", headers={"Authorization": f"Bearer {_token(private_key)}"}
        )

    assert missing.status_code == 401
    assert missing.headers["www-authenticate"] == "Bearer"
    assert rejected_header.status_code == 400
    assert accepted.status_code == 200
    assert accepted.json() == {
        "user_id": "11111111-1111-4111-8111-111111111111",
        "tenant_id": "default",
        "roles": ["rag-admin", "rag-user"],
        "groups": ["engineering"],
        "auth_method": "oidc",
        "is_admin": True,
    }


@pytest.mark.asyncio
async def test_trusted_header_mode_remains_explicit_and_rejects_bearer_tokens(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings(
        _env_file=None,
        auth_mode="trusted_header",
        identity_header_secret="internal-secret",
        admin_user_ids={"admin"},
    )
    monkeypatch.setattr(auth_dependencies, "get_settings", lambda: settings)

    test_app = FastAPI()
    install_exception_handlers(test_app)
    test_app.include_router(auth_router, prefix="/auth")
    test_app.dependency_overrides[get_oidc_token_verifier] = lambda: OIDCTokenVerifier(
        settings
    )

    transport = httpx.ASGITransport(app=test_app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        missing_secret = await client.get("/auth/me")
        bearer = await client.get(
            "/auth/me", headers={"Authorization": "Bearer not-used-in-this-mode"}
        )
        accepted = await client.get(
            "/auth/me",
            headers={
                "X-Tenant-Id": "default",
                "X-User-Id": "admin",
                "X-Identity-Secret": "internal-secret",
            },
        )

    assert missing_secret.status_code == 401
    assert bearer.status_code == 400
    assert accepted.status_code == 200
    assert accepted.json()["auth_method"] == "trusted_header"
    assert accepted.json()["is_admin"] is True


def test_oidc_mode_requires_audience_and_rejects_none_algorithm() -> None:
    with pytest.raises(ValidationError, match="APP_OIDC_AUDIENCE"):
        Settings(
            _env_file=None,
            auth_mode="oidc",
            oidc_issuer=ISSUER,
            oidc_audience="",
        )
    with pytest.raises(ValidationError, match="alg=none"):
        _settings(oidc_algorithms={"none"})


def test_member_payload_supports_user_compatibility_and_group_principals() -> None:
    legacy_user = KnowledgeBaseMemberUpsert.model_validate(
        {"user_id": "legacy-user", "permission": "reader"}
    )
    group = KnowledgeBaseMemberUpsert.model_validate(
        {
            "principal_type": "group",
            "principal_id": "engineering",
            "permission": "editor",
        }
    )
    assert legacy_user.principal_type == "user"
    assert legacy_user.principal_id == "legacy-user"
    assert group.principal_type == "group"
    assert group.principal_id == "engineering"
