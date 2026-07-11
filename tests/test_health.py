import httpx
import pytest

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
