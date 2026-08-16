import asyncio
import hashlib
import mimetypes
import re
from pathlib import Path
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import request_identity
from app.core.config import get_settings
from app.db.models import Document, DocumentChunk, DocumentSection, IngestionJob
from app.db.session import get_db
from app.schemas.document import (
    DocumentPreviewRead,
    DocumentPreviewSectionRead,
    DocumentRead,
    DocumentUploadAccepted,
    JobRead,
    LocalScanRequest,
)
from app.security.identity import RequestIdentity
from app.services.audit_service import record_audit
from app.services.job_control_service import active_document_job
from app.services.knowledge_base_service import knowledge_base_service
from app.services.source_location_service import source_location
from app.services.source_path_service import portable_source_uri, resolve_source_uri
from app.services.upload_security_service import (
    UploadValidationError,
    validate_upload_content,
)
from app.workers.tasks import (
    delete_document_task,
    ingest_document_task,
    scan_local_documents_task,
)

router = APIRouter()
SAFE_FILENAME = re.compile(r"[^A-Za-z0-9._\-\u4e00-\u9fff]+")
PREVIEW_SECTION_LIMIT = 20
PREVIEW_CHARACTER_LIMIT = 50_000


async def _authorized_document(
    db: AsyncSession,
    identity: RequestIdentity,
    document_id: UUID,
) -> Document:
    document = await db.get(Document, document_id)
    if document is None or document.tenant_id != identity.tenant_id:
        raise HTTPException(status_code=404, detail="document not found")
    try:
        await knowledge_base_service.authorize_identity(
            db,
            identity,
            document.knowledge_base_id,
            required_permission="reader",
        )
    except (LookupError, PermissionError) as exc:
        raise HTTPException(status_code=404, detail="document not found") from exc
    return document


async def _source_file(document: Document) -> Path | None:
    if not document.source_uri:
        return None
    path = resolve_source_uri(document.source_uri)
    return path if await asyncio.to_thread(path.is_file) else None


@router.post("/scan", response_model=JobRead, status_code=status.HTTP_202_ACCEPTED)
async def scan_local_documents(
    payload: LocalScanRequest,
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> IngestionJob:
    tenant_id = identity.tenant_id
    user_id = identity.user_id
    if payload.root_alias not in get_settings().scan_roots:
        raise HTTPException(status_code=404, detail="scan root alias not found")
    try:
        knowledge_base = await knowledge_base_service.authorize_identity(
            db,
            identity,
            payload.knowledge_base_id,
            required_permission="editor",
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    task_id = str(uuid4())
    job = IngestionJob(
        tenant_id=tenant_id,
        knowledge_base_id=knowledge_base.id,
        task_id=task_id,
        job_type="local_document_scan",
        status="queued",
        result={"root_alias": payload.root_alias, "knowledge_base_id": str(knowledge_base.id)},
    )
    db.add(job)
    await db.flush()
    record_audit(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="documents.scan_requested",
        resource_type="knowledge_base",
        resource_id=str(knowledge_base.id),
        details={"root_alias": payload.root_alias, "job_id": str(job.id)},
    )
    await db.commit()
    await db.refresh(job)
    scan_local_documents_task.apply_async(
        args=[tenant_id, str(knowledge_base.id), payload.root_alias, str(job.id)],
        task_id=task_id,
    )
    return job


@router.post("", response_model=DocumentUploadAccepted, status_code=status.HTTP_202_ACCEPTED)
async def upload_document(
    file: Annotated[UploadFile, File()],
    knowledge_base_id: Annotated[UUID | None, Form()] = None,
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> DocumentUploadAccepted:
    settings = get_settings()
    tenant_id = identity.tenant_id
    user_id = identity.user_id
    try:
        knowledge_base = await knowledge_base_service.authorize_identity(
            db,
            identity,
            knowledge_base_id,
            required_permission="editor",
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    original_name = file.filename or "upload.bin"
    suffix = Path(original_name).suffix.lower()
    if suffix not in settings.supported_document_extensions:
        raise HTTPException(
            status_code=415,
            detail=f"unsupported document type: {suffix or '<none>'}",
        )

    content = await file.read(settings.max_upload_mb * 1024 * 1024 + 1)
    if not content:
        raise HTTPException(status_code=400, detail="empty file")
    if len(content) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"file exceeds {settings.max_upload_mb} MB")
    try:
        validate_upload_content(
            filename=original_name,
            declared_content_type=file.content_type,
            content=content,
            max_upload_bytes=settings.max_upload_mb * 1024 * 1024,
        )
    except UploadValidationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    checksum = hashlib.sha256(content).hexdigest()
    existing = await db.scalar(
        select(Document).where(
            Document.knowledge_base_id == knowledge_base.id,
            Document.checksum == checksum,
        )
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail=f"duplicate document: {existing.id}")

    safe_name = SAFE_FILENAME.sub("_", Path(original_name).name).strip("._") or f"upload{suffix}"
    document = Document(
        tenant_id=tenant_id,
        knowledge_base_id=knowledge_base.id,
        name=original_name,
        source_type="upload",
        content_type=file.content_type,
        checksum=checksum,
        size_bytes=len(content),
        status="queued",
    )
    db.add(document)
    await db.flush()

    upload_dir = settings.upload_dir / tenant_id / str(document.id)
    path = upload_dir / safe_name
    await asyncio.to_thread(upload_dir.mkdir, parents=True, exist_ok=True)
    await asyncio.to_thread(path.write_bytes, content)
    document.source_uri = portable_source_uri(path)

    task_id = str(uuid4())
    job = IngestionJob(
        tenant_id=tenant_id,
        knowledge_base_id=knowledge_base.id,
        document_id=document.id,
        task_id=task_id,
        job_type="document_ingestion",
        status="queued",
    )
    db.add(job)
    await db.flush()
    record_audit(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="documents.uploaded",
        resource_type="document",
        resource_id=str(document.id),
        details={
            "knowledge_base_id": str(knowledge_base.id),
            "filename": original_name,
            "size_bytes": len(content),
            "job_id": str(job.id),
        },
    )
    await db.commit()
    await db.refresh(document)
    await db.refresh(job)

    ingest_document_task.apply_async(
        args=[str(document.id), str(job.id), str(path.resolve())], task_id=task_id
    )
    return DocumentUploadAccepted(document=document, job_id=job.id, task_id=task_id)


@router.get("", response_model=list[DocumentRead])
async def list_documents(
    knowledge_base_id: UUID | None = None,
    query: str | None = Query(default=None, alias="q", max_length=200),
    limit: int = Query(default=100, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> list[Document]:
    if knowledge_base_id is not None:
        try:
            knowledge_base = await knowledge_base_service.authorize_identity(
                db, identity, knowledge_base_id
            )
        except (LookupError, PermissionError) as exc:
            raise HTTPException(status_code=404, detail="knowledge base not found") from exc
        knowledge_base_ids = [knowledge_base.id]
    else:
        knowledge_base_ids = [
            item.id for item in await knowledge_base_service.list_accessible_identity(db, identity)
        ]
    if not knowledge_base_ids:
        return []
    statement = select(Document).where(Document.knowledge_base_id.in_(knowledge_base_ids))
    if query:
        statement = statement.where(Document.name.ilike(f"%{query}%"))
    result = await db.execute(
        statement.order_by(Document.created_at.desc()).limit(limit).offset(offset)
    )
    return list(result.scalars())


@router.get("/{document_id}/preview", response_model=DocumentPreviewRead)
async def preview_document(
    document_id: UUID,
    chunk_id: UUID | None = None,
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> DocumentPreviewRead:
    document = await _authorized_document(db, identity, document_id)
    if document.index_version is None:
        raise HTTPException(
            status_code=409,
            detail="document preview is unavailable until indexing completes",
        )

    target_chunk: DocumentChunk | None = None
    target_section: DocumentSection | None = None
    if chunk_id is not None:
        target_chunk = await db.scalar(
            select(DocumentChunk).where(
                DocumentChunk.id == chunk_id,
                DocumentChunk.document_id == document.id,
                DocumentChunk.index_version == document.index_version,
            )
        )
        if target_chunk is None:
            raise HTTPException(status_code=404, detail="document chunk not found")
        if target_chunk.parent_section_id is not None:
            target_section = await db.get(DocumentSection, target_chunk.parent_section_id)

    if target_section is not None:
        section_result = await db.execute(
            select(DocumentSection)
            .where(
                DocumentSection.document_id == document.id,
                DocumentSection.index_version == document.index_version,
                DocumentSection.section_index.between(
                    max(0, target_section.section_index - 1),
                    target_section.section_index + 1,
                ),
            )
            .order_by(DocumentSection.section_index)
        )
    else:
        section_result = await db.execute(
            select(DocumentSection)
            .where(
                DocumentSection.document_id == document.id,
                DocumentSection.index_version == document.index_version,
            )
            .order_by(DocumentSection.section_index)
            .limit(PREVIEW_SECTION_LIMIT + 1)
        )
    section_models = list(section_result.scalars())
    has_more_sections = len(section_models) > PREVIEW_SECTION_LIMIT
    section_models = section_models[:PREVIEW_SECTION_LIMIT]

    preview_sections: list[DocumentPreviewSectionRead] = []
    used_characters = 0
    content_truncated = False
    for section in section_models:
        remaining = PREVIEW_CHARACTER_LIMIT - used_characters
        if remaining <= 0:
            content_truncated = True
            break
        content = section.content
        if len(content) > remaining:
            content = content[:remaining].rstrip()
            content_truncated = True
        used_characters += len(content)
        location = source_location(
            section.source_metadata,
            heading_path=section.heading_path,
            section_index=section.section_index,
        )
        preview_sections.append(
            DocumentPreviewSectionRead(
                section_index=section.section_index,
                title=section.title,
                heading_path=section.heading_path,
                content=content,
                location=location,
                is_target=(
                    target_section is not None and section.id == target_section.id
                ),
            )
        )

    if not preview_sections and target_chunk is not None:
        location = source_location(
            target_chunk.source_metadata,
            heading_path=target_chunk.heading_path,
            section_index=target_chunk.chunk_index,
        )
        preview_sections.append(
            DocumentPreviewSectionRead(
                section_index=target_chunk.chunk_index,
                title=None,
                heading_path=target_chunk.heading_path,
                content=target_chunk.content[:PREVIEW_CHARACTER_LIMIT],
                location=location,
                is_target=True,
            )
        )
        content_truncated = len(target_chunk.content) > PREVIEW_CHARACTER_LIMIT
    if not preview_sections:
        raise HTTPException(status_code=409, detail="document has no indexed preview content")

    target_location = None
    if target_chunk is not None:
        target_location = source_location(
            target_chunk.source_metadata,
            heading_path=target_chunk.heading_path,
            section_index=(
                target_section.section_index
                if target_section is not None
                else target_chunk.chunk_index
            ),
        )
    source_file = await _source_file(document)
    record_audit(
        db,
        tenant_id=identity.tenant_id,
        user_id=identity.user_id,
        action="documents.previewed",
        resource_type="document",
        resource_id=str(document.id),
        details={"chunk_id": str(chunk_id) if chunk_id else None},
    )
    await db.commit()
    return DocumentPreviewRead(
        document_id=document.id,
        name=document.name,
        content_type=document.content_type,
        source_type=document.source_type,
        target_chunk_id=target_chunk.id if target_chunk is not None else None,
        target_location=target_location,
        sections=preview_sections,
        truncated=has_more_sections or content_truncated,
        download_available=source_file is not None,
    )


@router.get("/{document_id}/download", response_class=FileResponse)
async def download_document(
    document_id: UUID,
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
    document = await _authorized_document(db, identity, document_id)
    source_file = await _source_file(document)
    if source_file is None:
        raise HTTPException(status_code=404, detail="document source file is unavailable")
    filename = Path(document.name.replace("\r", "").replace("\n", "")).name or "document"
    media_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    record_audit(
        db,
        tenant_id=identity.tenant_id,
        user_id=identity.user_id,
        action="documents.downloaded",
        resource_type="document",
        resource_id=str(document.id),
        details={"filename": filename},
    )
    await db.commit()
    return FileResponse(
        path=source_file,
        filename=filename,
        media_type=media_type,
        content_disposition_type="attachment",
        headers={"Cache-Control": "private, no-store"},
    )


@router.post("/{document_id}/reindex", response_model=JobRead, status_code=status.HTTP_202_ACCEPTED)
async def reindex_document(
    document_id: UUID,
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> IngestionJob:
    tenant_id = identity.tenant_id
    user_id = identity.user_id
    document = await db.scalar(select(Document).where(Document.id == document_id).with_for_update())
    if document is None or document.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="document not found")
    try:
        await knowledge_base_service.authorize_identity(
            db,
            identity,
            document.knowledge_base_id,
            required_permission="editor",
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not document.source_uri:
        raise HTTPException(status_code=409, detail="document has no reusable source file")
    source_path = resolve_source_uri(document.source_uri)
    if not await asyncio.to_thread(source_path.is_file):
        raise HTTPException(status_code=409, detail="document source file is unavailable")
    active_job = await active_document_job(db, document.id)
    if active_job is not None:
        raise HTTPException(
            status_code=409,
            detail=f"document already has active job: {active_job.id}",
        )

    task_id = str(uuid4())
    job = IngestionJob(
        tenant_id=tenant_id,
        knowledge_base_id=document.knowledge_base_id,
        document_id=document.id,
        task_id=task_id,
        job_type="document_reindex",
        status="queued",
    )
    document.status = "reindexing" if document.index_version else "queued"
    db.add(job)
    await db.flush()
    record_audit(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="documents.reindex_requested",
        resource_type="document",
        resource_id=str(document.id),
        details={"knowledge_base_id": str(document.knowledge_base_id), "job_id": str(job.id)},
    )
    await db.commit()
    await db.refresh(job)
    resolved_source_path = await asyncio.to_thread(source_path.resolve)
    ingest_document_task.apply_async(
        args=[str(document.id), str(job.id), str(resolved_source_path)], task_id=task_id
    )
    return job


@router.delete("/{document_id}", response_model=JobRead, status_code=status.HTTP_202_ACCEPTED)
async def delete_document(
    document_id: UUID,
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> IngestionJob:
    tenant_id = identity.tenant_id
    user_id = identity.user_id
    document = await db.scalar(select(Document).where(Document.id == document_id).with_for_update())
    if document is None or document.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="document not found")
    try:
        await knowledge_base_service.authorize_identity(
            db,
            identity,
            document.knowledge_base_id,
            required_permission="editor",
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    active_job = await active_document_job(db, document.id)
    if active_job is not None:
        raise HTTPException(
            status_code=409,
            detail=f"document already has active job: {active_job.id}",
        )
    document.status = "deleting"
    task_id = str(uuid4())
    job = IngestionJob(
        tenant_id=tenant_id,
        knowledge_base_id=document.knowledge_base_id,
        document_id=document.id,
        task_id=task_id,
        job_type="document_deletion",
        status="queued",
    )
    db.add(job)
    await db.flush()
    record_audit(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="documents.delete_requested",
        resource_type="document",
        resource_id=str(document.id),
        details={"knowledge_base_id": str(document.knowledge_base_id), "job_id": str(job.id)},
    )
    await db.commit()
    await db.refresh(job)
    delete_document_task.apply_async(args=[str(document.id), str(job.id)], task_id=task_id)
    return job
