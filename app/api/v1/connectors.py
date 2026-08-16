from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import request_identity
from app.core.config import get_settings
from app.db.models import IngestionJob, KnowledgeBase
from app.db.session import get_db
from app.schemas.connector import (
    ConnectorCheckRead,
    FeishuConnectorStatusRead,
    FeishuDiagnosticRead,
)
from app.schemas.document import JobRead
from app.security.identity import RequestIdentity
from app.services.audit_service import record_audit
from app.services.feishu_service import FeishuAPIError, FeishuClient
from app.services.job_control_service import active_feishu_sync_job
from app.services.knowledge_base_service import knowledge_base_service
from app.workers.tasks import sync_feishu_task

router = APIRouter()


def _authorize_feishu_admin(identity: RequestIdentity) -> None:
    settings = get_settings()
    if not identity.is_admin:
        raise HTTPException(
            status_code=403,
            detail="Feishu connector management requires an administrator",
        )
    if identity.tenant_id != settings.feishu_tenant_id:
        raise HTTPException(status_code=404, detail="Feishu connector not found")


async def _configuration(
    db: AsyncSession,
) -> tuple[list[ConnectorCheckRead], KnowledgeBase | None]:
    settings = get_settings()
    checks: list[ConnectorCheckRead] = []
    checks.append(
        ConnectorCheckRead(
            key="enabled",
            status="passed" if settings.feishu_enabled else "failed",
            message=(
                "Feishu connector is enabled"
                if settings.feishu_enabled
                else "APP_FEISHU_ENABLED is false"
            ),
        )
    )
    credentials_ready = bool(
        settings.feishu_app_id and settings.feishu_app_secret.get_secret_value()
    )
    checks.append(
        ConnectorCheckRead(
            key="credentials",
            status="passed" if credentials_ready else "failed",
            message=(
                "App ID and App Secret are configured"
                if credentials_ready
                else "App ID or App Secret is missing"
            ),
        )
    )
    checks.append(
        ConnectorCheckRead(
            key="space",
            status="passed" if settings.feishu_space_id else "failed",
            message=(
                "Wiki space is configured"
                if settings.feishu_space_id
                else "Wiki space ID is missing"
            ),
        )
    )

    knowledge_base: KnowledgeBase | None = None
    try:
        configured_id = (
            UUID(settings.feishu_knowledge_base_id)
            if settings.feishu_knowledge_base_id
            else None
        )
        knowledge_base = await knowledge_base_service.authorize(
            db,
            settings.feishu_tenant_id,
            settings.feishu_run_as_user,
            configured_id,
            required_permission="editor",
        )
        checks.append(
            ConnectorCheckRead(
                key="knowledge_base",
                status="passed",
                message="Target knowledge base is active and writable",
            )
        )
    except (LookupError, PermissionError, ValueError):
        checks.append(
            ConnectorCheckRead(
                key="knowledge_base",
                status="failed",
                message=(
                    "Target knowledge base is missing, inactive, or not writable "
                    "by run-as user"
                ),
            )
        )
    return checks, knowledge_base


async def _status(db: AsyncSession) -> FeishuConnectorStatusRead:
    settings = get_settings()
    checks, knowledge_base = await _configuration(db)
    active_job = await active_feishu_sync_job(db, settings.feishu_tenant_id)
    latest_job = await db.scalar(
        select(IngestionJob)
        .where(
            IngestionJob.tenant_id == settings.feishu_tenant_id,
            IngestionJob.job_type == "feishu_sync",
        )
        .order_by(IngestionJob.created_at.desc(), IngestionJob.id.desc())
        .limit(1)
    )
    return FeishuConnectorStatusRead(
        enabled=settings.feishu_enabled,
        ready=all(check.status == "passed" for check in checks),
        tenant_id=settings.feishu_tenant_id,
        space_id=settings.feishu_space_id or None,
        run_as_user=settings.feishu_run_as_user,
        app_id_configured=bool(settings.feishu_app_id),
        app_secret_configured=bool(settings.feishu_app_secret.get_secret_value()),
        knowledge_base_id=knowledge_base.id if knowledge_base else None,
        knowledge_base_name=knowledge_base.name if knowledge_base else None,
        checks=checks,
        active_job=JobRead.model_validate(active_job) if active_job else None,
        latest_job=JobRead.model_validate(latest_job) if latest_job else None,
    )


@router.get("/feishu", response_model=FeishuConnectorStatusRead)
async def get_feishu_connector(
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> FeishuConnectorStatusRead:
    _authorize_feishu_admin(identity)
    result = await _status(db)
    await db.commit()
    return result


@router.post("/feishu/diagnose", response_model=FeishuDiagnosticRead)
async def diagnose_feishu_connector(
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> FeishuDiagnosticRead:
    _authorize_feishu_admin(identity)
    settings = get_settings()
    checks, _ = await _configuration(db)
    if all(check.status == "passed" for check in checks):
        try:
            details = await FeishuClient().diagnose_space(settings.feishu_space_id)
            checks.append(
                ConnectorCheckRead(
                    key="connectivity",
                    status="passed",
                    message="Credentials are valid and the Wiki space is readable",
                    details=details,
                )
            )
        except FeishuAPIError as exc:
            checks.append(
                ConnectorCheckRead(
                    key="connectivity",
                    status="failed",
                    message=str(exc),
                    error_code=exc.code,
                    log_id=exc.log_id,
                    details={"operation": exc.operation, "retryable": exc.retryable},
                )
            )
    else:
        checks.append(
            ConnectorCheckRead(
                key="connectivity",
                status="skipped",
                message="Connectivity check was skipped until configuration checks pass",
            )
        )
    passed = all(check.status == "passed" for check in checks)
    record_audit(
        db,
        tenant_id=identity.tenant_id,
        user_id=identity.user_id,
        action="connectors.feishu.diagnosed",
        resource_type="connector",
        resource_id="feishu",
        details={"passed": passed},
    )
    await db.commit()
    return FeishuDiagnosticRead(
        status="passed" if passed else "failed",
        checked_at=datetime.now(UTC),
        checks=checks,
    )


@router.post(
    "/feishu/sync",
    response_model=JobRead,
    status_code=status.HTTP_202_ACCEPTED,
)
async def start_feishu_sync(
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> IngestionJob:
    _authorize_feishu_admin(identity)
    settings = get_settings()
    checks, knowledge_base = await _configuration(db)
    if knowledge_base is None or any(check.status != "passed" for check in checks):
        raise HTTPException(
            status_code=409,
            detail="Feishu connector configuration is not ready",
        )
    active_job = await active_feishu_sync_job(db, identity.tenant_id)
    if active_job is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Feishu sync already queued or running: {active_job.id}",
        )

    task_id = str(uuid4())
    job = IngestionJob(
        tenant_id=identity.tenant_id,
        knowledge_base_id=knowledge_base.id,
        task_id=task_id,
        job_type="feishu_sync",
        status="queued",
        result={
            "trigger": "manual",
            "requested_by": identity.user_id,
            "space_id": settings.feishu_space_id,
        },
    )
    db.add(job)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Feishu sync is already queued or running",
        ) from exc
    record_audit(
        db,
        tenant_id=identity.tenant_id,
        user_id=identity.user_id,
        action="connectors.feishu.sync_requested",
        resource_type="connector",
        resource_id="feishu",
        details={"job_id": str(job.id), "knowledge_base_id": str(knowledge_base.id)},
    )
    await db.commit()
    await db.refresh(job)
    try:
        sync_feishu_task.apply_async(args=[str(job.id)], task_id=task_id)
    except Exception as exc:
        job.status = "failed"
        job.progress = 100
        job.error_message = "failed to dispatch Feishu sync task"
        job.result = {
            **job.result,
            "failure": {
                "category": "dispatch",
                "message": "Failed to dispatch Feishu sync task",
                "error_type": type(exc).__name__,
            },
        }
        await db.commit()
        raise HTTPException(
            status_code=503,
            detail="failed to dispatch Feishu sync task",
        ) from exc
    return job
