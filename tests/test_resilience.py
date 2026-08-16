from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from redis.exceptions import RedisError

import app.services.redis_service as redis_module
from app.services.redis_service import RedisService
from app.workers.celery_app import celery_app


def settings(*, fail_open: bool) -> SimpleNamespace:
    return SimpleNamespace(
        timezone="Asia/Shanghai",
        chat_rate_limit_per_minute=30,
        chat_rate_limit_per_tenant_per_minute=300,
        chat_daily_limit_per_user=1_000,
        chat_daily_limit_per_tenant=100_000,
        rate_limit_fail_open=fail_open,
    )


@pytest.mark.asyncio
async def test_redis_outage_fails_closed_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    service = RedisService.__new__(RedisService)
    service.client = MagicMock()
    service.client.eval.side_effect = RedisError("unavailable")
    monkeypatch.setattr(redis_module, "get_settings", lambda: settings(fail_open=False))

    with pytest.raises(RuntimeError, match="rate limit service unavailable"):
        await service.allow_chat_request("tenant", "user")


@pytest.mark.asyncio
async def test_explicit_fail_open_policy_is_observable(monkeypatch: pytest.MonkeyPatch) -> None:
    service = RedisService.__new__(RedisService)
    service.client = MagicMock()
    service.client.eval.side_effect = RedisError("unavailable")
    monkeypatch.setattr(redis_module, "get_settings", lambda: settings(fail_open=True))

    decision = await service.allow_chat_request("tenant", "user")
    assert decision.allowed is True
    assert decision.user_remaining == 0
    assert decision.tenant_remaining == 0


def test_worker_loss_configuration_preserves_at_least_once_recovery() -> None:
    assert celery_app.conf.task_acks_late is True
    assert celery_app.conf.task_reject_on_worker_lost is True
    assert celery_app.conf.worker_prefetch_multiplier == 1
