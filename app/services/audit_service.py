from typing import Any

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AuditLog


def record_audit(
    db: AsyncSession,
    *,
    tenant_id: str,
    user_id: str | None,
    action: str,
    resource_type: str,
    resource_id: str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    context = structlog.contextvars.get_contextvars()
    db.add(
        AuditLog(
            tenant_id=tenant_id,
            user_id=user_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            request_id=str(context.get("request_id", "")) or None,
            details=details or {},
        )
    )
