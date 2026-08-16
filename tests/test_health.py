import json
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse

import app.api.v1.health as health_module
from app.core.errors import install_exception_handlers
from app.main import app


@pytest.mark.asyncio
async def test_liveness_and_problem_details() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health/live")
        invalid_tenant = await client.get(
            "/api/v1/documents", headers={"X-Tenant-Id": "../escape"}
        )
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert invalid_tenant.status_code == 422
    assert invalid_tenant.headers["content-type"].startswith("application/problem+json")
    assert invalid_tenant.json()["type"] == "urn:rag-study-helper:validation-error"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert "frame-ancestors 'none'" in response.headers["content-security-policy"]
    assert response.headers["permissions-policy"] == (
        "camera=(), geolocation=(), microphone=(), payment=(), usb=()"
    )


@pytest.mark.asyncio
async def test_cors_preflight_allows_only_configured_origins_headers_and_methods() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        allowed = await client.options(
            "/api/v1/auth/me",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization,x-request-id",
            },
        )
        rejected_origin = await client.options(
            "/api/v1/auth/me",
            headers={
                "Origin": "https://attacker.example",
                "Access-Control-Request-Method": "GET",
            },
        )
        rejected_header = await client.options(
            "/api/v1/auth/me",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "x-forwarded-user",
            },
        )

    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert rejected_origin.status_code == 400
    assert "access-control-allow-origin" not in rejected_origin.headers
    assert rejected_header.status_code == 400


@pytest.mark.asyncio
async def test_untrusted_request_id_is_replaced_before_logging_and_echoing() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        accepted = await client.get("/health/live", headers={"X-Request-ID": "client-123"})
        replaced = await client.get("/health/live", headers={"X-Request-ID": "x" * 65})

    assert accepted.headers["x-request-id"] == "client-123"
    assert replaced.headers["x-request-id"] != "x" * 65
    assert len(replaced.headers["x-request-id"]) == 36


@pytest.mark.asyncio
async def test_metrics_endpoint() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/metrics")
    assert response.status_code == 200
    assert "rag_http_requests_total" in response.text


@pytest.mark.asyncio
async def test_readiness_reports_dependency_failures_without_hanging(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class BrokenEngine:
        def connect(self):
            raise RuntimeError("postgres unavailable")

    monkeypatch.setattr(health_module, "engine", BrokenEngine())
    monkeypatch.setattr(health_module.redis_service, "ping", AsyncMock(return_value=False))
    monkeypatch.setattr(
        health_module.milvus_service,
        "ping",
        AsyncMock(side_effect=TimeoutError("milvus unavailable")),
    )

    response = await health_module.readiness()
    assert isinstance(response, JSONResponse)
    assert response.status_code == 503
    payload = json.loads(response.body)
    assert payload["status"] == "degraded"
    assert payload["dependencies"] == {
        "postgres": "error: RuntimeError",
        "redis": "error",
        "milvus": "error: TimeoutError",
    }


@pytest.mark.asyncio
async def test_problem_details_preserve_structured_http_exception_data() -> None:
    test_app = FastAPI()
    install_exception_handlers(test_app)

    @test_app.get("/blocked")
    async def blocked() -> None:
        raise HTTPException(status_code=409, detail={"passed": False, "checks": []})

    transport = httpx.ASGITransport(app=test_app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/blocked")

    assert response.status_code == 409
    assert response.json()["detail"] == "request rejected"
    assert response.json()["data"] == {"passed": False, "checks": []}
