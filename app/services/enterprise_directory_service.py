import asyncio
import time
from functools import lru_cache
from typing import Any, Literal
from urllib.parse import quote, urlsplit, urlunsplit

import httpx

from app.core.config import Settings, get_settings
from app.schemas.knowledge_base import DirectoryPrincipalRead


class EnterpriseDirectoryError(RuntimeError):
    pass


class EnterpriseDirectoryNotConfigured(EnterpriseDirectoryError):
    pass


class EnterpriseDirectoryTenantMismatch(EnterpriseDirectoryError):
    pass


class KeycloakDirectoryService:
    def __init__(
        self,
        settings: Settings,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.settings = settings
        self.transport = transport
        self._access_token: str | None = None
        self._access_token_expires_at = 0.0
        self._token_lock = asyncio.Lock()

    def _endpoints(self) -> tuple[str, str]:
        issuer = self.settings.oidc_issuer.rstrip("/")
        parsed = urlsplit(issuer)
        marker = "/realms/"
        if marker not in parsed.path:
            raise EnterpriseDirectoryNotConfigured(
                "OIDC issuer must contain /realms/{realm} for Keycloak directory search"
            )
        server_path, realm = parsed.path.rsplit(marker, 1)
        if not realm or "/" in realm:
            raise EnterpriseDirectoryNotConfigured(
                "OIDC issuer must identify exactly one Keycloak realm"
            )
        server_base = urlunsplit(
            (parsed.scheme, parsed.netloc, server_path.rstrip("/"), "", "")
        ).rstrip("/")
        token_url = f"{issuer}/protocol/openid-connect/token"
        admin_base = f"{server_base}/admin/realms/{quote(realm, safe='')}"
        return token_url, admin_base

    async def _token(self, client: httpx.AsyncClient, token_url: str) -> str:
        now = time.monotonic()
        if self._access_token and now < self._access_token_expires_at:
            return self._access_token
        async with self._token_lock:
            now = time.monotonic()
            if self._access_token and now < self._access_token_expires_at:
                return self._access_token
            try:
                response = await client.post(
                    token_url,
                    data={
                        "client_id": self.settings.enterprise_directory_client_id,
                        "client_secret": (
                            self.settings.enterprise_directory_client_secret.get_secret_value()
                        ),
                        "grant_type": "client_credentials",
                    },
                    headers={"Accept": "application/json"},
                )
                response.raise_for_status()
                payload = response.json()
                access_token = payload["access_token"]
                expires_in = payload.get("expires_in", 60)
                if not isinstance(access_token, str) or not access_token:
                    raise ValueError("missing access_token")
                if not isinstance(expires_in, (int, float)):
                    raise ValueError("invalid expires_in")
            except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
                raise EnterpriseDirectoryError(
                    "Keycloak directory authentication failed"
                ) from exc
            self._access_token = access_token
            self._access_token_expires_at = now + max(1.0, float(expires_in) - 30.0)
            return access_token

    @staticmethod
    def _user_result(item: Any) -> DirectoryPrincipalRead | None:
        if not isinstance(item, dict) or item.get("enabled") is False:
            return None
        user_id = item.get("id")
        username = item.get("username")
        email = item.get("email")
        first_name = item.get("firstName")
        last_name = item.get("lastName")
        if not isinstance(user_id, str) or not user_id or len(user_id) > 128:
            return None
        full_name = " ".join(
            part for part in (first_name, last_name) if isinstance(part, str) and part
        )
        display_name = full_name or (
            username if isinstance(username, str) and username else user_id
        )
        secondary_parts = [
            value
            for value in (username, email)
            if isinstance(value, str) and value and value != display_name
        ]
        return DirectoryPrincipalRead(
            principal_type="user",
            principal_id=user_id,
            display_name=display_name[:255],
            secondary_text=" · ".join(dict.fromkeys(secondary_parts))[:512] or None,
        )

    def _group_results(self, items: Any) -> list[DirectoryPrincipalRead]:
        if not isinstance(items, list):
            raise EnterpriseDirectoryError("Keycloak returned an invalid group list")
        results: list[DirectoryPrincipalRead] = []

        def visit(item: Any) -> None:
            if not isinstance(item, dict):
                return
            name = item.get("name")
            path = item.get("path")
            if isinstance(name, str) and name:
                principal_id = (
                    path
                    if self.settings.enterprise_directory_group_principal == "path"
                    and isinstance(path, str)
                    and path
                    else name
                )
                if len(principal_id) <= 128:
                    results.append(
                        DirectoryPrincipalRead(
                            principal_type="group",
                            principal_id=principal_id,
                            display_name=name[:255],
                            secondary_text=(
                                path[:512]
                                if isinstance(path, str) and path != name
                                else None
                            ),
                        )
                    )
            subgroups = item.get("subGroups")
            if isinstance(subgroups, list):
                for subgroup in subgroups:
                    visit(subgroup)

        for group in items:
            visit(group)
        return results

    async def search(
        self,
        *,
        tenant_id: str,
        principal_type: Literal["user", "group"],
        query: str,
        limit: int,
        offset: int,
    ) -> list[DirectoryPrincipalRead]:
        if self.settings.enterprise_directory_provider != "keycloak":
            raise EnterpriseDirectoryNotConfigured(
                "enterprise directory search is not configured"
            )
        if tenant_id != self.settings.enterprise_directory_tenant_id:
            raise EnterpriseDirectoryTenantMismatch(
                "enterprise directory search is not configured for this tenant"
            )
        token_url, admin_base = self._endpoints()
        resource = "users" if principal_type == "user" else "groups"
        params: dict[str, str | int] = {
            "search": query,
            "first": offset,
            "max": limit,
            "briefRepresentation": "true",
        }
        if principal_type == "user":
            params["exact"] = "false"
        try:
            async with httpx.AsyncClient(
                timeout=self.settings.enterprise_directory_http_timeout_seconds,
                follow_redirects=False,
                transport=self.transport,
            ) as client:
                token = await self._token(client, token_url)
                response = await client.get(
                    f"{admin_base}/{resource}",
                    params=params,
                    headers={
                        "Accept": "application/json",
                        "Authorization": f"Bearer {token}",
                    },
                )
                response.raise_for_status()
                payload = response.json()
        except EnterpriseDirectoryError:
            raise
        except (httpx.HTTPError, TypeError, ValueError) as exc:
            raise EnterpriseDirectoryError("Keycloak directory search failed") from exc
        if not isinstance(payload, list):
            raise EnterpriseDirectoryError("Keycloak returned an invalid directory response")
        if principal_type == "user":
            return [
                result
                for item in payload
                if (result := self._user_result(item)) is not None
            ][:limit]
        return self._group_results(payload)[:limit]


@lru_cache
def get_enterprise_directory_service() -> KeycloakDirectoryService:
    return KeycloakDirectoryService(get_settings())
