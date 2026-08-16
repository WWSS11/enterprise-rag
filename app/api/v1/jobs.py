import asyncio
from datetime import UTC, datetime
from uuid import UUID, uuid4

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import request_identity
from app.core.config import get_settings
from app.db.models import Document, IngestionJob
from app.db.session import get_db
from app.schemas.document import JobPage, JobRead
from app.security.identity import RequestIdentity
from app.services.audit_service import record_audit
from app.services.job_control_service import (
    active_document_job,
    active_feishu_sync_job,
    active_rebuild_job,
)
from app.services.knowledge_base_service import knowledge_base_service
from app.services.source_path_service import resolve_source_uri
from app.workers.celery_app import celery_app
from app.workers.tasks import (
    delete_document_task,
    ingest_document_task,
    rebuild_index_task,
    scan_local_documents_task,
    sync_feishu_task,
)

router = APIRouter()
logger = structlog.get_logger(__name__)


async def _authorize_job_control(
    db: AsyncSession,
    identity: RequestIdentity,
    job: IngestionJob,
) -> None:
    if job.tenant_id != identity.tenant_id:
        raise HTTPException(status_code=404, detail="job not found")
    if job.job_type in {"vector_index_rebuild", "feishu_sync"}:
        if not identity.is_admin:
            raise HTTPException(status_code=403, detail="job control requires an administrator")
        return
    if job.knowledge_base_id is None:
        if not identity.is_admin:
            raise HTTPException(status_code=404, detail="job not found")
        return
    try:
        await knowledge_base_service.authorize_identity(
            db,
            identity,
            job.knowledge_base_id,
            required_permission="editor",
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="job not found") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


async def _restore_cancelled_document(db: AsyncSession, job: IngestionJob) -> None:
    if job.document_id is None:
        return
    document = await db.scalar(
        select(Document).where(Document.id == job.document_id).with_for_update()
    )
    if document is None:
        return
    document.status = "ready" if document.index_version else "pending"
    document.error_message = None


async def _dispatch_retry(job: IngestionJob, *, source_path: str | None = None) -> None:
    if job.job_type in {"document_ingestion", "document_reindex"}:
        if job.document_id is None or source_path is None:
            raise RuntimeError("document retry is missing its source")
        ingest_document_task.apply_async(
            args=[str(job.document_id), str(job.id), source_path], task_id=job.task_id
        )
        return
    if job.job_type == "document_deletion":
        if job.document_id is None:
            raise RuntimeError("document deletion retry is missing its document")
        delete_document_task.apply_async(
            args=[str(job.document_id), str(job.id)], task_id=job.task_id
        )
        return
    if job.job_type == "local_document_scan":
        root_alias = str(job.result.get("root_alias", ""))
        if job.knowledge_base_id is None or not root_alias:
            raise RuntimeError("local scan retry is missing its original parameters")
        scan_local_documents_task.apply_async(
            args=[
                job.tenant_id,
                str(job.knowledge_base_id),
                root_alias,
                str(job.id),
            ],
            task_id=job.task_id,
        )
        return
    if job.job_type == "vector_index_rebuild":
        rebuild_index_task.apply_async(args=[str(job.id)], task_id=job.task_id)
        return
    if job.job_type == "feishu_sync":
        sync_feishu_task.apply_async(args=[str(job.id)], task_id=job.task_id)
        return
    raise RuntimeError(f"unsupported retry job type: {job.job_type}")


@router.get("", response_model=JobPage)
async def list_jobs(
    job_status: str | None = Query(default=None, alias="status", max_length=32),
    job_type: str | None = Query(default=None, max_length=64),
    knowledge_base_id: UUID | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> JobPage:
    conditions = [IngestionJob.tenant_id == identity.tenant_id]
    if job_status:
        conditions.append(IngestionJob.status == job_status)
    if job_type:
        conditions.append(IngestionJob.job_type == job_type)

    if knowledge_base_id is not None:
        try:
            knowledge_base = await knowledge_base_service.authorize_identity(
                db, identity, knowledge_base_id
            )
        except (LookupError, PermissionError) as exc:
            raise HTTPException(status_code=404, detail="knowledge base not found") from exc
        conditions.append(IngestionJob.knowledge_base_id == knowledge_base.id)
    elif not identity.is_admin:
        accessible = await knowledge_base_service.list_accessible_identity(db, identity)
        conditions.append(IngestionJob.knowledge_base_id.in_([item.id for item in accessible]))

    total = int(
        await db.scalar(select(func.count()).select_from(IngestionJob).where(*conditions)) or 0
    )
    items = list(
        (
            await db.execute(
                select(IngestionJob)
                .where(*conditions)
                .order_by(IngestionJob.created_at.desc(), IngestionJob.id.desc())
                .limit(limit)
                .offset(offset)
            )
        ).scalars()
    )
    await db.commit()
    return JobPage(items=items, total=total, limit=limit, offset=offset)


@router.post("/rebuild-index", response_model=JobRead, status_code=status.HTTP_202_ACCEPTED)
async def rebuild_index(
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> IngestionJob:
    tenant_id = identity.tenant_id
    user_id = identity.user_id
    if not identity.is_admin:
        raise HTTPException(status_code=403, detail="index rebuild requires an administrator")
    active_job = await active_rebuild_job(db)
    if active_job is not None:
        raise HTTPException(
            status_code=409,
            detail=f"index rebuild already queued or running: {active_job.id}",
        )
    task_id = str(uuid4())
    job = IngestionJob(
        tenant_id=tenant_id,
        task_id=task_id,
        job_type="vector_index_rebuild",
        status="queued",
    )
    db.add(job)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409, detail="index rebuild already queued or running"
        ) from exc
    record_audit(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="vector_index.rebuild_requested",
        resource_type="vector_index",
        resource_id=None,
        details={"job_id": str(job.id)},
    )
    await db.commit()
    await db.refresh(job)
    rebuild_index_task.apply_async(args=[str(job.id)], task_id=task_id)
    return job


@router.get("/{job_id}", response_model=JobRead)
async def get_job(
    job_id: UUID,
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> IngestionJob:
    tenant_id = identity.tenant_id
    job = await db.get(IngestionJob, job_id)
    if job is None or job.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="job not found")
    if not identity.is_admin:
        if job.knowledge_base_id is None:
            raise HTTPException(status_code=404, detail="job not found")
        try:
            await knowledge_base_service.authorize_identity(
                db, identity, job.knowledge_base_id
            )
        except (LookupError, PermissionError) as exc:
            raise HTTPException(status_code=404, detail="job not found") from exc
    return job


@router.post("/{job_id}/cancel", response_model=JobRead)
async def cancel_job(
    job_id: UUID,
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> IngestionJob:
    job = await db.scalar(
        select(IngestionJob).where(IngestionJob.id == job_id).with_for_update()
    )
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    await _authorize_job_control(db, identity, job)
    if job.status != "queued":
        raise HTTPException(
            status_code=409,
            detail="only queued jobs can be cancelled",
        )

    job.status = "cancelled"
    job.cancelled_at = datetime.now(UTC)
    job.cancelled_by = identity.user_id
    job.error_message = None
    await _restore_cancelled_document(db, job)
    record_audit(
        db,
        tenant_id=identity.tenant_id,
        user_id=identity.user_id,
        action="jobs.cancelled",
        resource_type="ingestion_job",
        resource_id=str(job.id),
        details={"job_type": job.job_type, "task_id": job.task_id},
    )
    await db.commit()
    await db.refresh(job)
    if job.task_id:
        try:
            celery_app.control.revoke(job.task_id, terminate=False)
        except Exception as exc:
            await logger.awarning(
                "job_cancel_revoke_broadcast_failed",
                job_id=str(job.id),
                error_type=type(exc).__name__,
            )
    return job


@router.post(
    "/{job_id}/retry",
    response_model=JobRead,
    status_code=status.HTTP_202_ACCEPTED,
)
async def retry_job(
    job_id: UUID,
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> IngestionJob:
    original = await db.scalar(
        select(IngestionJob).where(IngestionJob.id == job_id).with_for_update()
    )
    if original is None:
        raise HTTPException(status_code=404, detail="job not found")
    await _authorize_job_control(db, identity, original)
    if original.status not in {"failed", "cancelled"}:
        raise HTTPException(
            status_code=409,
            detail="only failed or cancelled jobs can be retried",
        )

    document: Document | None = None
    resolved_source_path: str | None = None
    if original.document_id is not None:
        document = await db.scalar(
            select(Document).where(Document.id == original.document_id).with_for_update()
        )
        if document is None:
            raise HTTPException(status_code=409, detail="job document is no longer available")

    if original.job_type in {"document_ingestion", "document_reindex"}:
        if document is None or not document.source_uri:
            raise HTTPException(status_code=409, detail="document source file is unavailable")
        source_path = resolve_source_uri(document.source_uri)
        if not await asyncio.to_thread(source_path.is_file):
            raise HTTPException(status_code=409, detail="document source file is unavailable")
        resolved_source_path = str(await asyncio.to_thread(source_path.resolve))
    elif original.job_type == "local_document_scan":
        root_alias = str(original.result.get("root_alias", ""))
        if root_alias not in get_settings().scan_roots:
            raise HTTPException(status_code=409, detail="scan root alias is unavailable")
    elif original.job_type == "feishu_sync":
        settings = get_settings()
        if (
            not settings.feishu_enabled
            or original.tenant_id != settings.feishu_tenant_id
            or original.knowledge_base_id is None
        ):
            raise HTTPException(
                status_code=409,
                detail="Feishu connector configuration is unavailable",
            )
        active_job = await active_feishu_sync_job(db, original.tenant_id)
        if active_job is not None:
            raise HTTPException(
                status_code=409,
                detail=f"Feishu sync already queued or running: {active_job.id}",
            )
    elif original.job_type not in {"document_deletion", "vector_index_rebuild"}:
        raise HTTPException(status_code=409, detail="job type cannot be retried")

    if document is not None:
        active_job = await active_document_job(db, document.id)
        if active_job is not None:
            raise HTTPException(
                status_code=409,
                detail=f"document already has active job: {active_job.id}",
            )
    if original.job_type == "vector_index_rebuild":
        active_job = await active_rebuild_job(db)
        if active_job is not None:
            raise HTTPException(
                status_code=409,
                detail=f"index rebuild already queued or running: {active_job.id}",
            )

    task_id = str(uuid4())
    retry = IngestionJob(
        tenant_id=original.tenant_id,
        knowledge_base_id=original.knowledge_base_id,
        document_id=original.document_id,
        retry_of_job_id=original.id,
        task_id=task_id,
        job_type=original.job_type,
        status="queued",
        result=(
            dict(original.result)
            if original.job_type == "local_document_scan"
            else {
                "trigger": "retry",
                "retry_of_job_id": str(original.id),
                "space_id": get_settings().feishu_space_id,
            }
            if original.job_type == "feishu_sync"
            else {}
        ),
    )
    if document is not None:
        if original.job_type == "document_deletion":
            document.status = "deleting"
        else:
            document.status = "reindexing" if document.index_version else "queued"
        document.error_message = None
    db.add(retry)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="a conflicting job is already active") from exc
    record_audit(
        db,
        tenant_id=identity.tenant_id,
        user_id=identity.user_id,
        action="jobs.retry_requested",
        resource_type="ingestion_job",
        resource_id=str(retry.id),
        details={
            "retry_of_job_id": str(original.id),
            "job_type": retry.job_type,
            "document_id": str(retry.document_id) if retry.document_id else None,
        },
    )
    await db.commit()
    await db.refresh(retry)
    try:
        await _dispatch_retry(retry, source_path=resolved_source_path)
    except Exception as exc:
        retry.status = "failed"
        retry.progress = 100
        retry.error_message = f"failed to dispatch retry task: {exc}"[:4_000]
        if document is not None:
            document.status = "ready" if document.index_version else "failed"
            document.error_message = retry.error_message
        await db.commit()
        raise HTTPException(status_code=503, detail="failed to dispatch retry task") from exc
    return retry
