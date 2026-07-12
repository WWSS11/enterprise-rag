import asyncio
import hashlib
import re
from pathlib import Path
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import request_identity
from app.core.config import get_settings
from app.db.models import Document, IngestionJob
from app.db.session import get_db
from app.schemas.document import (
    DocumentRead,
    DocumentUploadAccepted,
    JobRead,
    LocalScanRequest,
)
from app.services.audit_service import record_audit
from app.services.job_control_service import active_document_job
from app.services.knowledge_base_service import knowledge_base_service
from app.services.source_path_service import portable_source_uri, resolve_source_uri
from app.workers.tasks import (
    delete_document_task,
    ingest_document_task,
    scan_local_documents_task,
)

router = APIRouter()
SAFE_FILENAME = re.compile(r"[^A-Za-z0-9._\-\u4e00-\u9fff]+")


@router.post("/scan", response_model=JobRead, status_code=status.HTTP_202_ACCEPTED)
async def scan_local_documents(
    payload: LocalScanRequest,
    identity: tuple[str, str] = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> IngestionJob:
    tenant_id, user_id = identity
    if payload.root_alias not in get_settings().scan_roots:
        raise HTTPException(status_code=404, detail="scan root alias not found")
    try:
        knowledge_base = await knowledge_base_service.authorize(
            db,
            tenant_id,
            user_id,
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
    identity: tuple[str, str] = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> DocumentUploadAccepted:
    settings = get_settings()
    tenant_id, user_id = identity
    try:
        knowledge_base = await knowledge_base_service.authorize(
            db,
            tenant_id,
            user_id,
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
    identity: tuple[str, str] = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> list[Document]:
    tenant_id, user_id = identity
    if knowledge_base_id is not None:
        try:
            knowledge_base = await knowledge_base_service.authorize(
                db, tenant_id, user_id, knowledge_base_id
            )
        except (LookupError, PermissionError) as exc:
            raise HTTPException(status_code=404, detail="knowledge base not found") from exc
        knowledge_base_ids = [knowledge_base.id]
    else:
        knowledge_base_ids = [
            item.id for item in await knowledge_base_service.list_accessible(db, tenant_id, user_id)
        ]
    if not knowledge_base_ids:
        return []
    result = await db.execute(
        select(Document)
        .where(Document.knowledge_base_id.in_(knowledge_base_ids))
        .order_by(Document.created_at.desc())
    )
    return list(result.scalars())


@router.post(
    "/{document_id}/reindex", response_model=JobRead, status_code=status.HTTP_202_ACCEPTED
)
async def reindex_document(
    document_id: UUID,
    identity: tuple[str, str] = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> IngestionJob:
    tenant_id, user_id = identity
    document = await db.scalar(
        select(Document).where(Document.id == document_id).with_for_update()
    )
    if document is None or document.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="document not found")
    try:
        await knowledge_base_service.authorize(
            db,
            tenant_id,
            user_id,
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
    identity: tuple[str, str] = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> IngestionJob:
    tenant_id, user_id = identity
    document = await db.scalar(
        select(Document).where(Document.id == document_id).with_for_update()
    )
    if document is None or document.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="document not found")
    try:
        await knowledge_base_service.authorize(
            db,
            tenant_id,
            user_id,
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
