from typing import Any, TypedDict


class RagState(TypedDict, total=False):
    question: str
    tenant_id: str
    knowledge_base_id: str
    user_id: str
    history: list[dict[str, str]]
    rewritten_query: str
    retrieved: list[dict[str, Any]]
    reranked: list[dict[str, Any]]
    answer: str
    citations: list[dict[str, Any]]
