from typing import Any, cast
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.knowledge_bases import search_directory_principals
from app.core.config import Settings
from app.security.identity import RequestIdentity
from app.services.enterprise_directory_service import (
    EnterpriseDirectoryError,
    EnterpriseDirectoryNotConfigured,
    EnterpriseDirectoryTenantMismatch,
    KeycloakDirectoryService,
)
from app.services.knowledge_base_service import knowledge_base_service


def directory_settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "auth_mode": "trusted_header",
        "enterprise_directory_provider": "keycloak",
        "enterprise_directory_tenant_id": "tenant-a",
        "enterprise_directory_client_id": "directory-reader",
        "enterprise_directory_client_secret": "test-only-secret",
        "oidc_issuer": "https://id.example.com/auth/realms/company",
    }
    values.update(overrides)
    return Settings(_env_file=None, **cast(Any, values))


@pytest.mark.asyncio
async def test_keycloak_directory_searches_users_and_reuses_service_token() -> None:
    token_requests = 0
    search_requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal token_requests
        if request.method == "POST":
            token_requests += 1
            assert request.url.path == "/auth/realms/company/protocol/openid-connect/token"
            return httpx.Response(200, json={"access_token": "service-token", "expires_in": 120})
        search_requests.append(request)
        return httpx.Response(
            200,
            json=[
                {
                    "id": "11111111-1111-4111-8111-111111111111",
                    "username": "mei.lin",
                    "email": "mei@example.com",
                    "firstName": "Mei",
                    "lastName": "Lin",
                    "enabled": True,
                },
                {
                    "id": "22222222-2222-4222-8222-222222222222",
                    "username": "disabled",
                    "enabled": False,
                },
            ],
        )

    service = KeycloakDirectoryService(
        directory_settings(), transport=httpx.MockTransport(handler)
    )
    first = await service.search(
        tenant_id="tenant-a",
        principal_type="user",
        query="mei",
        limit=20,
        offset=0,
    )
    second = await service.search(
        tenant_id="tenant-a",
        principal_type="user",
        query="lin",
        limit=10,
        offset=5,
    )

    assert token_requests == 1
    assert len(search_requests) == 2
    assert search_requests[0].url.path == "/auth/admin/realms/company/users"
    assert search_requests[0].url.params["search"] == "mei"
    assert search_requests[0].url.params["exact"] == "false"
    assert search_requests[0].url.params["first"] == "0"
    assert search_requests[0].url.params["max"] == "20"
    assert search_requests[0].headers["Authorization"] == "Bearer service-token"
    assert first == second
    assert len(first) == 1
    assert first[0].principal_id == "11111111-1111-4111-8111-111111111111"
    assert first[0].display_name == "Mei Lin"
    assert first[0].secondary_text == "mei.lin · mei@example.com"


@pytest.mark.asyncio
async def test_keycloak_directory_flattens_groups_and_preserves_claim_path() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json={"access_token": "token", "expires_in": 60})
        return httpx.Response(
            200,
            json=[
                {
                    "id": "g1",
                    "name": "engineering",
                    "path": "/engineering",
                    "subGroups": [
                        {"id": "g2", "name": "platform", "path": "/engineering/platform"}
                    ],
                }
            ],
        )

    service = KeycloakDirectoryService(
        directory_settings(enterprise_directory_group_principal="path"),
        transport=httpx.MockTransport(handler),
    )
    results = await service.search(
        tenant_id="tenant-a",
        principal_type="group",
        query="eng",
        limit=20,
        offset=0,
    )

    assert [item.principal_id for item in results] == [
        "/engineering",
        "/engineering/platform",
    ]


@pytest.mark.asyncio
async def test_directory_rejects_disabled_and_cross_tenant_access() -> None:
    disabled = KeycloakDirectoryService(Settings(_env_file=None))
    with pytest.raises(EnterpriseDirectoryNotConfigured):
        await disabled.search(
            tenant_id="tenant-a",
            principal_type="user",
            query="mei",
            limit=20,
            offset=0,
        )

    configured = KeycloakDirectoryService(directory_settings())
    with pytest.raises(EnterpriseDirectoryTenantMismatch):
        await configured.search(
            tenant_id="tenant-b",
            principal_type="group",
            query="eng",
            limit=20,
            offset=0,
        )


@pytest.mark.asyncio
async def test_directory_maps_keycloak_permission_failure_without_leaking_response() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json={"access_token": "token", "expires_in": 60})
        return httpx.Response(403, text="upstream-sensitive-detail")

    service = KeycloakDirectoryService(
        directory_settings(), transport=httpx.MockTransport(handler)
    )
    with pytest.raises(EnterpriseDirectoryError, match="directory search failed") as caught:
        await service.search(
            tenant_id="tenant-a",
            principal_type="user",
            query="mei",
            limit=20,
            offset=0,
        )
    assert "upstream-sensitive-detail" not in str(caught.value)


@pytest.mark.asyncio
async def test_directory_endpoint_requires_owner_and_forwards_tenant(monkeypatch) -> None:
    directory = AsyncMock(spec=KeycloakDirectoryService)
    directory.search.return_value = []
    authorize = AsyncMock()
    monkeypatch.setattr(knowledge_base_service, "authorize_identity", authorize)
    identity = RequestIdentity(tenant_id="tenant-a", user_id="owner-a")
    db = AsyncMock(spec=AsyncSession)
    knowledge_base_id = uuid4()

    result = await search_directory_principals(
        knowledge_base_id=knowledge_base_id,
        principal_type="group",
        query="  eng  ",
        limit=10,
        offset=20,
        identity=identity,
        db=db,
        directory_service=directory,
    )

    assert result == []
    authorize.assert_awaited_once_with(
        db, identity, knowledge_base_id, required_permission="owner"
    )
    directory.search.assert_awaited_once_with(
        tenant_id="tenant-a",
        principal_type="group",
        query="eng",
        limit=10,
        offset=20,
    )

    authorize.side_effect = PermissionError("owner required")
    with pytest.raises(HTTPException) as caught:
        await search_directory_principals(
            knowledge_base_id=knowledge_base_id,
            principal_type="user",
            query="mei",
            limit=20,
            offset=0,
            identity=identity,
            db=db,
            directory_service=directory,
        )
    assert caught.value.status_code == 403
