from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1 import documents
from app.db.models import Document, DocumentChunk, DocumentSection
from app.schemas.document import DocumentRead
from app.security.identity import RequestIdentity
from app.services.source_location_service import source_location


def identity(tenant_id: str = "tenant-a") -> RequestIdentity:
    return RequestIdentity(tenant_id=tenant_id, user_id="reader-a")


class ScalarResult:
    def __init__(self, items: list[object]) -> None:
        self.items = items

    def scalars(self):
        return iter(self.items)


class PreviewSession:
    def __init__(self, chunk: DocumentChunk, section: DocumentSection) -> None:
        self.chunk = chunk
        self.section = section
        self.added: list[object] = []

    async def scalar(self, _statement):
        return self.chunk

    async def get(self, model, item_id):
        if model is DocumentSection and item_id == self.section.id:
            return self.section
        return None

    async def execute(self, _statement):
        return ScalarResult([self.section])

    def add(self, item: object) -> None:
        self.added.append(item)

    async def commit(self) -> None:
        return None


def document_record(source_uri: str | None = "source.pdf") -> Document:
    return Document(
        id=uuid4(),
        tenant_id="tenant-a",
        knowledge_base_id=uuid4(),
        name="访问控制.pdf",
        source_type="upload",
        source_uri=source_uri,
        content_type="application/pdf",
        checksum="a" * 64,
        size_bytes=100,
        status="ready",
        chunk_count=1,
        index_version="v1",
    )


def test_source_location_projects_only_stable_location_fields() -> None:
    location = source_location(
        {
            "sheet": "权限矩阵",
            "cell_range": "B2:D2",
            "source_uri": "/private/source.xlsx",
            "token": "must-not-leak",
        },
        heading_path=("权限",),
        section_index=3,
    )

    assert location == {
        "kind": "cell_range",
        "page": None,
        "slide": None,
        "paragraph_start": None,
        "paragraph_end": None,
        "sheet": "权限矩阵",
        "table": None,
        "cell_range": "B2:D2",
        "section_index": 3,
        "heading_path": ["权限"],
    }
    assert "source_uri" not in location
    assert "token" not in location


@pytest.mark.asyncio
async def test_preview_returns_cited_page_without_exposing_source_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    document = document_record()
    section = DocumentSection(
        id=uuid4(),
        tenant_id=document.tenant_id,
        knowledge_base_id=document.knowledge_base_id,
        document_id=document.id,
        index_version="v1",
        section_index=2,
        title="第 7 页",
        heading_path=["第 7 页"],
        content="最小权限原则。",
        token_count=8,
        source_metadata={"page": 7},
    )
    chunk = DocumentChunk(
        id=uuid4(),
        tenant_id=document.tenant_id,
        knowledge_base_id=document.knowledge_base_id,
        document_id=document.id,
        parent_section_id=section.id,
        vector_id=str(uuid4()),
        index_version="v1",
        chunk_index=4,
        content=section.content,
        embedding_content=section.content,
        heading_path=section.heading_path,
        token_count=8,
        source_metadata={"page": 7, "source_uri": "/private/source.pdf"},
    )
    db = PreviewSession(chunk, section)
    monkeypatch.setattr(
        documents,
        "_authorized_document",
        AsyncMock(return_value=document),
    )
    monkeypatch.setattr(
        documents,
        "_source_file",
        AsyncMock(return_value=Path("source.pdf")),
    )

    preview = await documents.preview_document(
        document.id,
        chunk.id,
        identity(),
        db,  # type: ignore[arg-type]
    )

    assert preview.target_location is not None
    assert preview.target_location.kind == "page"
    assert preview.target_location.page == 7
    assert preview.sections[0].is_target is True
    assert preview.download_available is True
    assert "/private/source.pdf" not in preview.model_dump_json()
    assert any(getattr(item, "action", None) == "documents.previewed" for item in db.added)


@pytest.mark.asyncio
async def test_download_is_attachment_and_audited(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = tmp_path / "source.pdf"
    source.write_bytes(b"%PDF-generated")
    document = document_record(str(source))
    db = PreviewSession(
        DocumentChunk(),
        DocumentSection(),
    )
    monkeypatch.setattr(
        documents,
        "_authorized_document",
        AsyncMock(return_value=document),
    )
    monkeypatch.setattr(documents, "_source_file", AsyncMock(return_value=source))

    response = await documents.download_document(
        document.id,
        identity(),
        db,  # type: ignore[arg-type]
    )

    assert Path(response.path) == source
    assert response.media_type == "application/pdf"
    assert response.headers["content-disposition"].startswith("attachment;")
    assert response.headers["cache-control"] == "private, no-store"
    assert any(getattr(item, "action", None) == "documents.downloaded" for item in db.added)


@pytest.mark.asyncio
async def test_direct_document_access_hides_cross_tenant_records() -> None:
    document = document_record()
    db = AsyncMock()
    db.get.return_value = document

    with pytest.raises(HTTPException) as error:
        await documents._authorized_document(db, identity("tenant-b"), document.id)

    assert error.value.status_code == 404


def test_document_read_exposes_availability_not_server_path() -> None:
    payload = SimpleNamespace(
        id=uuid4(),
        tenant_id="tenant-a",
        knowledge_base_id=uuid4(),
        name="policy.pdf",
        source_type="upload",
        source_key=None,
        source_uri="/private/uploads/policy.pdf",
        source_available=True,
        source_updated_at=None,
        content_type="application/pdf",
        size_bytes=100,
        status="ready",
        chunk_count=1,
        index_version="v1",
        indexed_at=None,
        error_message=None,
        extra_metadata={},
        created_at="2026-08-09T00:00:00Z",
        updated_at="2026-08-09T00:00:00Z",
    )

    serialized = DocumentRead.model_validate(payload).model_dump()

    assert serialized["source_available"] is True
    assert "source_uri" not in serialized
