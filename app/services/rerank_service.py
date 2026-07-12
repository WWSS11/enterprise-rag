from typing import Any

import httpx
import structlog

from app.core.config import get_settings

logger = structlog.get_logger(__name__)


class RerankService:
    async def rerank(
        self, query: str, documents: list[dict[str, Any]], top_k: int
    ) -> list[dict[str, Any]]:
        settings = get_settings()
        if not settings.rerank_enabled or not settings.rerank_api_key or not documents:
            return documents[:top_k]

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
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                response = await client.post(
                    f"{settings.rerank_base_url.rstrip('/')}/rerank",
                    json=payload,
                    headers=headers,
                )
                response.raise_for_status()
                results = response.json().get("results", [])
        except (httpx.HTTPError, KeyError, ValueError) as exc:
            await logger.awarning("rerank_failed_using_vector_order", error=str(exc))
            return documents[:top_k]

        reranked: list[dict[str, Any]] = []
        for result in results:
            index = int(result["index"])
            item = dict(documents[index])
            item["rerank_score"] = float(result.get("relevance_score", 0.0))
            reranked.append(item)
        return reranked


rerank_service = RerankService()
