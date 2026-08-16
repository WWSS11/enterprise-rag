from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.document import JobRead


class ConnectorCheckRead(BaseModel):
    key: str = Field(min_length=1, max_length=64)
    status: Literal["passed", "failed", "warning", "skipped"]
    message: str = Field(min_length=1, max_length=500)
    error_code: int | None = None
    log_id: str | None = Field(default=None, max_length=255)
    details: dict[str, object] = Field(default_factory=dict)


class FeishuConnectorStatusRead(BaseModel):
    provider: Literal["feishu"] = "feishu"
    enabled: bool
    ready: bool
    tenant_id: str
    space_id: str | None
    run_as_user: str
    app_id_configured: bool
    app_secret_configured: bool
    knowledge_base_id: UUID | None
    knowledge_base_name: str | None
    checks: list[ConnectorCheckRead]
    active_job: JobRead | None
    latest_job: JobRead | None


class FeishuDiagnosticRead(BaseModel):
    provider: Literal["feishu"] = "feishu"
    status: Literal["passed", "failed"]
    checked_at: datetime
    checks: list[ConnectorCheckRead]
