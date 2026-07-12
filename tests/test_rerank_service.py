import httpx
import pytest

from app.core.config import get_settings
from app.services.rerank_service import RerankService


class FakeResponse:
    def __init__(self, payload: dict) -> None:
        self.payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self.payload


class FakeAsyncClient:
    def __init__(self, outcomes: list[Exception | FakeResponse]) -> None:
        self.outcomes = outcomes
        self.calls = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args) -> None:
        return None

    async def post(self, *_args, **_kwargs):
        outcome = self.outcomes[self.calls]
        self.calls += 1
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def _documents() -> list[dict]:
    return [
        {"content": "first", "document_id": "a", "score": 0.9},
        {"content": "second", "document_id": "b", "score": 0.8},
    ]


@pytest.mark.asyncio
async def test_rerank_retries_transport_failure_then_succeeds(monkeypatch) -> None:
    monkeypatch.setenv("APP_RERANK_API_KEY", "test-key")
    monkeypatch.setenv("APP_RERANK_MAX_ATTEMPTS", "2")
    monkeypatch.setenv("APP_RERANK_RETRY_BASE_SECONDS", "0")
    get_settings.cache_clear()
    request = httpx.Request("POST", "https://rerank.example/rerank")
    client = FakeAsyncClient(
        [
            httpx.ReadTimeout("timed out", request=request),
            FakeResponse(
                {"results": [{"index": 1, "relevance_score": 0.95}]}
            ),
        ]
    )
    monkeypatch.setattr(
        "app.services.rerank_service.httpx.AsyncClient", lambda **_kwargs: client
    )
    try:
        result = await RerankService().rerank("query", _documents(), 1)
    finally:
        get_settings.cache_clear()

    assert client.calls == 2
    assert result[0]["document_id"] == "b"
    assert result[0]["rerank_status"] == "success"
    assert result[0]["rerank_attempts"] == 2


@pytest.mark.asyncio
async def test_rerank_fallback_exposes_reason_after_retry_exhaustion(monkeypatch) -> None:
    monkeypatch.setenv("APP_RERANK_API_KEY", "test-key")
    monkeypatch.setenv("APP_RERANK_MAX_ATTEMPTS", "2")
    monkeypatch.setenv("APP_RERANK_RETRY_BASE_SECONDS", "0")
    get_settings.cache_clear()
    request = httpx.Request("POST", "https://rerank.example/rerank")
    client = FakeAsyncClient(
        [
            httpx.ReadTimeout("timed out", request=request),
            httpx.ReadTimeout("timed out", request=request),
        ]
    )
    monkeypatch.setattr(
        "app.services.rerank_service.httpx.AsyncClient", lambda **_kwargs: client
    )
    try:
        result = await RerankService().rerank("query", _documents(), 1)
    finally:
        get_settings.cache_clear()

    assert client.calls == 2
    assert result[0]["document_id"] == "a"
    assert result[0]["rerank_status"] == "fallback"
    assert result[0]["rerank_attempts"] == 2
    assert result[0]["rerank_fallback_reason"] == "timeout"
