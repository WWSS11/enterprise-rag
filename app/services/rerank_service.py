import asyncio
from time import perf_counter
from typing import Any

import httpx
import structlog

from app.core.config import get_settings
from app.core.metrics import RERANK_ATTEMPTS, RERANK_LATENCY, RERANK_REQUESTS

logger = structlog.get_logger(__name__)


def _failure_reason(exc: Exception) -> str:
    if isinstance(exc, httpx.TimeoutException):
        return "timeout"
    if isinstance(exc, httpx.HTTPStatusError):
        status_code = exc.response.status_code
        if status_code == 429:
            return "http_429"
        if status_code >= 500:
            return "http_5xx"
        return "http_4xx"
    if isinstance(exc, httpx.RequestError):
        return "transport"
    return "invalid_response"


def _is_retryable(exc: Exception) -> bool:
    if isinstance(exc, (httpx.TimeoutException, httpx.RequestError)):
        return True
    return isinstance(exc, httpx.HTTPStatusError) and (
        exc.response.status_code == 429 or exc.response.status_code >= 500
    )


def _annotate(
    documents: list[dict[str, Any]],
    *,
    status: str,
    attempts: int,
    reason: str | None = None,
) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for document in documents:
        item = dict(document)
        item["rerank_status"] = status
        item["rerank_attempts"] = attempts
        if reason:
            item["rerank_fallback_reason"] = reason
        output.append(item)
    return output


class RerankService:
    async def rerank(
        self, query: str, documents: list[dict[str, Any]], top_k: int
    ) -> list[dict[str, Any]]:
        settings = get_settings()
        if not documents:
            return []
        if not settings.rerank_enabled or not settings.rerank_api_key:
            RERANK_REQUESTS.labels("disabled", "configuration").inc()
            return _annotate(
                documents[:top_k], status="disabled", attempts=0, reason="configuration"
            )

        payload = {
            "model": settings.rerank_model,
            "query": query,
            "documents": [
                item.get("embedding_content", item["content"]) for item in documents
            ],
            "top_n": top_k,
            "return_documents": False,
        }
        headers = {"Authorization": f"Bearer {settings.rerank_api_key}"}
        started = perf_counter()
        attempts = 0
        failure: Exception | None = None
        results: list[dict[str, Any]] | None = None

        async with httpx.AsyncClient(timeout=settings.rerank_timeout_seconds) as client:
            for attempt in range(1, settings.rerank_max_attempts + 1):
                attempts = attempt
                try:
                    response = await client.post(
                        f"{settings.rerank_base_url.rstrip('/')}/rerank",
                        json=payload,
                        headers=headers,
                    )
                    response.raise_for_status()
                    raw_results = response.json().get("results")
                    if not isinstance(raw_results, list) or not raw_results:
                        raise ValueError("rerank provider returned no results")
                    results = raw_results
                    RERANK_ATTEMPTS.labels("success").inc()
                    break
                except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
                    failure = exc
                    RERANK_ATTEMPTS.labels("failure").inc()
                    if attempt >= settings.rerank_max_attempts or not _is_retryable(exc):
                        break
                    delay = settings.rerank_retry_base_seconds * (2 ** (attempt - 1))
                    await logger.awarning(
                        "rerank_attempt_failed_retrying",
                        attempt=attempt,
                        delay_seconds=delay,
                        reason=_failure_reason(exc),
                    )
                    if delay:
                        await asyncio.sleep(delay)

        if results is None:
            reason = _failure_reason(failure or ValueError("unknown rerank failure"))
            RERANK_REQUESTS.labels("fallback", reason).inc()
            RERANK_LATENCY.labels("fallback").observe(perf_counter() - started)
            await logger.awarning(
                "rerank_failed_using_hybrid_order",
                attempts=attempts,
                reason=reason,
                error=str(failure or "unknown rerank failure"),
            )
            return _annotate(
                documents[:top_k], status="fallback", attempts=attempts, reason=reason
            )

        reranked: list[dict[str, Any]] = []
        try:
            for result in results:
                index = int(result["index"])
                item = dict(documents[index])
                item["rerank_score"] = float(result.get("relevance_score", 0.0))
                item["rerank_status"] = "success"
                item["rerank_attempts"] = attempts
                reranked.append(item)
        except (IndexError, KeyError, TypeError, ValueError) as exc:
            reason = "invalid_response"
            RERANK_REQUESTS.labels("fallback", reason).inc()
            RERANK_LATENCY.labels("fallback").observe(perf_counter() - started)
            await logger.awarning(
                "rerank_response_invalid_using_hybrid_order", error=str(exc)
            )
            return _annotate(
                documents[:top_k], status="fallback", attempts=attempts, reason=reason
            )

        RERANK_REQUESTS.labels("success", "none").inc()
        RERANK_LATENCY.labels("success").observe(perf_counter() - started)
        return reranked


rerank_service = RerankService()
