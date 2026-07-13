import httpx
import pytest
from fastapi import FastAPI, HTTPException

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


@pytest.mark.asyncio
async def test_metrics_endpoint() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/metrics")
    assert response.status_code == 200
    assert "rag_http_requests_total" in response.text


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
