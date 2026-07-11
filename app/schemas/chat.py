from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=8_000)
    conversation_id: UUID | None = None
    knowledge_base_id: UUID | None = None


class Citation(BaseModel):
    document_id: str
    document_name: str
    chunk_id: str
    score: float
    content_preview: str


class ChatResponse(BaseModel):
    conversation_id: UUID
    answer: str
    rewritten_query: str
    citations: list[Citation] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
