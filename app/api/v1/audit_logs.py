from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import request_identity
from app.db.models import AuditLog
from app.db.session import get_db
from app.schemas.audit import AuditLogPage
from app.security.identity import RequestIdentity

router = APIRouter()


@router.get("", response_model=AuditLogPage)
async def list_audit_logs(
    action: str | None = Query(default=None, max_length=128),
    resource_type: str | None = Query(default=None, max_length=64),
    resource_id: str | None = Query(default=None, max_length=128),
    user_id: str | None = Query(default=None, max_length=128),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> AuditLogPage:
    if not identity.is_admin:
        raise HTTPException(status_code=403, detail="audit logs require an administrator")
    conditions = [AuditLog.tenant_id == identity.tenant_id]
    if action:
        conditions.append(AuditLog.action == action)
    if resource_type:
        conditions.append(AuditLog.resource_type == resource_type)
    if resource_id:
        conditions.append(AuditLog.resource_id == resource_id)
    if user_id:
        conditions.append(AuditLog.user_id == user_id)

    total = int(
        await db.scalar(select(func.count()).select_from(AuditLog).where(*conditions)) or 0
    )
    items = list(
        (
            await db.execute(
                select(AuditLog)
                .where(*conditions)
                .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
                .limit(limit)
                .offset(offset)
            )
        ).scalars()
    )
    return AuditLogPage(items=items, total=total, limit=limit, offset=offset)
