from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

import app.api.v1.chat as chat_module
from app.schemas.chat import ChatRequest
from app.security.identity import RequestIdentity


@pytest.mark.asyncio
async def test_model_configuration_or_provider_failure_returns_sanitized_503(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = AsyncMock()
    monkeypatch.setattr(
        chat_module,
        "validate_rag_configuration",
        lambda: (_ for _ in ()).throw(RuntimeError("secret provider detail")),
    )

    with pytest.raises(HTTPException) as caught:
        await chat_module._run_chat(
            ChatRequest(question="test"),
            db,
            RequestIdentity(tenant_id="tenant", user_id="user"),
        )

    assert caught.value.status_code == 503
    assert caught.value.detail == "RAG model service is temporarily unavailable"
    assert "secret provider detail" not in str(caught.value.detail)
    db.rollback.assert_awaited_once()
