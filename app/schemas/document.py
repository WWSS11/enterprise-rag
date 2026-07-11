from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class DocumentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: str
    knowledge_base_id: UUID
    name: str
    source_type: str
    source_key: str | None
    source_uri: str | None
    source_updated_at: datetime | None
    content_type: str | None
    size_bytes: int
    status: str
    chunk_count: int
    index_version: str | None
    indexed_at: datetime | None
    error_message: str | None
    extra_metadata: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class DocumentUploadAccepted(BaseModel):
    document: DocumentRead
    job_id: UUID
    task_id: str


class LocalScanRequest(BaseModel):
    root_alias: str = Field(default="default", min_length=1, max_length=64)
    knowledge_base_id: UUID | None = None


class JobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    document_id: UUID | None
    task_id: str | None
    job_type: str
    status: str
    progress: int = Field(ge=0, le=100)
    result: dict[str, Any]
    error_message: str | None
    created_at: datetime
    updated_at: datetime
