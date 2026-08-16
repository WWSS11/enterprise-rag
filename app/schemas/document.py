from datetime import datetime
from typing import Any, Literal
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
    source_available: bool
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


class SourceLocationRead(BaseModel):
    kind: Literal["page", "slide", "paragraph", "cell_range", "section"]
    page: int | None = Field(default=None, ge=1)
    slide: int | None = Field(default=None, ge=1)
    paragraph_start: int | None = Field(default=None, ge=1)
    paragraph_end: int | None = Field(default=None, ge=1)
    sheet: str | None = Field(default=None, max_length=255)
    table: str | None = Field(default=None, max_length=255)
    cell_range: str | None = Field(default=None, max_length=64)
    section_index: int | None = Field(default=None, ge=0)
    heading_path: list[str] = Field(default_factory=list)


class DocumentPreviewSectionRead(BaseModel):
    section_index: int = Field(ge=0)
    title: str | None
    heading_path: list[str]
    content: str
    location: SourceLocationRead | None
    is_target: bool = False


class DocumentPreviewRead(BaseModel):
    document_id: UUID
    name: str
    content_type: str | None
    source_type: str
    target_chunk_id: UUID | None = None
    target_location: SourceLocationRead | None = None
    sections: list[DocumentPreviewSectionRead]
    truncated: bool
    download_available: bool


class LocalScanRequest(BaseModel):
    root_alias: str = Field(default="default", min_length=1, max_length=64)
    knowledge_base_id: UUID | None = None


class JobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    knowledge_base_id: UUID | None
    document_id: UUID | None
    retry_of_job_id: UUID | None
    task_id: str | None
    job_type: str
    status: str
    progress: int = Field(ge=0, le=100)
    result: dict[str, Any]
    error_message: str | None
    cancelled_at: datetime | None
    cancelled_by: str | None
    created_at: datetime
    updated_at: datetime


class JobPage(BaseModel):
    items: list[JobRead]
    total: int = Field(ge=0)
    limit: int = Field(ge=1, le=100)
    offset: int = Field(ge=0)
