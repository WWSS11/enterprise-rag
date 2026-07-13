from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import request_identity
from app.db.models import IngestionJob
from app.db.session import get_db
from app.schemas.document import JobRead
from app.security.identity import RequestIdentity
from app.services.audit_service import record_audit
from app.services.job_control_service import active_rebuild_job
from app.workers.tasks import rebuild_index_task

router = APIRouter()


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
    return job
