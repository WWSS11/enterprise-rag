import json
import math
from collections.abc import Awaitable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, tzinfo
from typing import Any, cast
from zoneinfo import ZoneInfo

import structlog
from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.core.config import get_settings

logger = structlog.get_logger(__name__)

CHAT_LIMIT_SCRIPT = """
local function refill(key, capacity, refill_rate, now)
    local values = redis.call('HMGET', key, 'tokens', 'updated_at')
    local tokens = tonumber(values[1]) or capacity
    local updated_at = tonumber(values[2]) or now
    tokens = math.min(capacity, tokens + math.max(0, now - updated_at) * refill_rate)
    return tokens
end

local now = tonumber(ARGV[1])
local user_capacity = tonumber(ARGV[2])
local tenant_capacity = tonumber(ARGV[3])
local user_refill = user_capacity / 60
local tenant_refill = tenant_capacity / 60
local user_daily_limit = tonumber(ARGV[4])
local tenant_daily_limit = tonumber(ARGV[5])
local daily_ttl = tonumber(ARGV[6])

local user_tokens = refill(KEYS[1], user_capacity, user_refill, now)
local tenant_tokens = refill(KEYS[2], tenant_capacity, tenant_refill, now)
local user_daily = tonumber(redis.call('GET', KEYS[3])) or 0
local tenant_daily = tonumber(redis.call('GET', KEYS[4])) or 0

local allowed = user_tokens >= 1
    and tenant_tokens >= 1
    and user_daily < user_daily_limit
    and tenant_daily < tenant_daily_limit

local retry_after = 0
if not allowed then
    if user_tokens < 1 then
        retry_after = math.max(retry_after, math.ceil((1 - user_tokens) / user_refill))
    end
    if tenant_tokens < 1 then
        retry_after = math.max(retry_after, math.ceil((1 - tenant_tokens) / tenant_refill))
    end
    if user_daily >= user_daily_limit or tenant_daily >= tenant_daily_limit then
        retry_after = math.max(retry_after, daily_ttl)
    end
else
    user_tokens = user_tokens - 1
    tenant_tokens = tenant_tokens - 1
    user_daily = redis.call('INCR', KEYS[3])
    tenant_daily = redis.call('INCR', KEYS[4])
    if user_daily == 1 then redis.call('EXPIRE', KEYS[3], daily_ttl) end
    if tenant_daily == 1 then redis.call('EXPIRE', KEYS[4], daily_ttl) end
end

redis.call('HSET', KEYS[1], 'tokens', user_tokens, 'updated_at', now)
redis.call('HSET', KEYS[2], 'tokens', tenant_tokens, 'updated_at', now)
redis.call('EXPIRE', KEYS[1], 120)
redis.call('EXPIRE', KEYS[2], 120)

return {
    allowed and 1 or 0,
    math.floor(user_tokens),
    math.floor(tenant_tokens),
    user_daily,
    tenant_daily,
    retry_after
}
"""


@dataclass(frozen=True, slots=True)
class RateLimitDecision:
    allowed: bool
    retry_after: int = 0
    user_remaining: int = 0
    tenant_remaining: int = 0
    user_daily_used: int = 0
    tenant_daily_used: int = 0


class RedisService:
    def __init__(self) -> None:
        settings = get_settings()
        self.client: Redis = Redis.from_url(settings.redis_url, decode_responses=True)
        self.session_ttl = settings.session_ttl_seconds

    async def ping(self) -> bool:
        return bool(await self.client.ping())

    async def close(self) -> None:
        await self.client.aclose()

    @staticmethod
    def _daily_window() -> tuple[str, int]:
        settings = get_settings()
        try:
            timezone: tzinfo = ZoneInfo(settings.timezone)
        except Exception:
            timezone = UTC
        now = datetime.now(timezone)
        tomorrow = datetime.combine(now.date() + timedelta(days=1), datetime.min.time(), timezone)
        return now.strftime("%Y-%m-%d"), max(1, math.ceil((tomorrow - now).total_seconds()))

    async def allow_chat_request(self, tenant_id: str, user_id: str) -> RateLimitDecision:
        settings = get_settings()
        date_key, daily_ttl = self._daily_window()
        keys = [
            f"rate-limit:chat:user:{tenant_id}:{user_id}",
            f"rate-limit:chat:tenant:{tenant_id}",
            f"quota:chat:user:{tenant_id}:{user_id}:{date_key}",
            f"quota:chat:tenant:{tenant_id}:{date_key}",
        ]
        try:
            evaluation = self.client.eval(
                CHAT_LIMIT_SCRIPT,
                len(keys),
                *keys,
                str(datetime.now(UTC).timestamp()),
                str(settings.chat_rate_limit_per_minute),
                str(settings.chat_rate_limit_per_tenant_per_minute),
                str(settings.chat_daily_limit_per_user),
                str(settings.chat_daily_limit_per_tenant),
                str(daily_ttl),
            )
            values = await cast(Awaitable[list[Any]], evaluation)
        except RedisError as exc:
            await logger.aexception("chat_rate_limit_redis_failed")
            if settings.rate_limit_fail_open:
                return RateLimitDecision(allowed=True)
            raise RuntimeError("rate limit service unavailable") from exc

        return RateLimitDecision(
            allowed=bool(int(values[0])),
            user_remaining=int(values[1]),
            tenant_remaining=int(values[2]),
            user_daily_used=int(values[3]),
            tenant_daily_used=int(values[4]),
            retry_after=int(values[5]),
        )

    async def allow_request(self, key: str, limit: int, window_seconds: int = 60) -> bool:
        """Backward-compatible fixed-window limiter for non-chat endpoints."""

        redis_key = f"rate-limit:{key}"
        async with self.client.pipeline(transaction=True) as pipe:
            pipe.incr(redis_key)
            pipe.expire(redis_key, window_seconds, nx=True)
            count, _ = await pipe.execute()
        return int(count) <= limit

    async def cache_history(self, conversation_id: str, messages: list[dict[str, Any]]) -> None:
        key = f"conversation:{conversation_id}:history"
        await self.client.set(key, json.dumps(messages, ensure_ascii=False), ex=self.session_ttl)

    async def get_cached_history(self, conversation_id: str) -> list[dict[str, Any]] | None:
        value = await self.client.get(f"conversation:{conversation_id}:history")
        return json.loads(value) if value else None


redis_service = RedisService()
