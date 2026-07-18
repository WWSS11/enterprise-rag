from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import request_identity
from app.db.models import IngestionJob
from app.db.session import get_db
from app.schemas.document import JobPage, JobRead
from app.security.identity import RequestIdentity
from app.services.audit_service import record_audit
from app.services.job_control_service import active_rebuild_job
from app.services.knowledge_base_service import knowledge_base_service
from app.workers.tasks import rebuild_index_task

router = APIRouter()


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
