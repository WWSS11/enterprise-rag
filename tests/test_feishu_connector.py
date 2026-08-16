from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import SecretStr
from sqlalchemy import Table
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1 import connectors
from app.db.models import IngestionJob, KnowledgeBase
from app.schemas.connector import ConnectorCheckRead
from app.security.identity import RequestIdentity
from app.services.feishu_service import FeishuAPIError


def connector_settings() -> SimpleNamespace:
    return SimpleNamespace(
        feishu_enabled=True,
        feishu_app_id="app-id",
        feishu_app_secret=SecretStr("test-secret"),
        feishu_space_id="space-1",
        feishu_tenant_id="tenant-a",
        feishu_run_as_user="feishu-sync",
        feishu_knowledge_base_id="",
    )


def passing_checks() -> list[ConnectorCheckRead]:
    return [
        ConnectorCheckRead(key=key, status="passed", message="ok")
        for key in ("enabled", "credentials", "space", "knowledge_base")
    ]


@pytest.mark.asyncio
async def test_configuration_reports_target_permission_without_secret(monkeypatch) -> None:
    settings = connector_settings()
    knowledge_base = KnowledgeBase(
        id=uuid4(),
        tenant_id="tenant-a",
        slug="feishu",
        name="Feishu KB",
        access_mode="restricted",
        status="active",
        created_by="owner-a",
    )
    authorize = AsyncMock(return_value=knowledge_base)
    monkeypatch.setattr(connectors, "get_settings", lambda: settings)
    monkeypatch.setattr(connectors.knowledge_base_service, "authorize", authorize)
    db = AsyncMock(spec=AsyncSession)

    checks, target = await connectors._configuration(db)

    assert target is knowledge_base
    assert all(check.status == "passed" for check in checks)
    authorize.assert_awaited_once_with(
        db,
        "tenant-a",
        "feishu-sync",
        None,
        required_permission="editor",
    )
    assert "test-secret" not in " ".join(check.message for check in checks)


@pytest.mark.asyncio
async def test_diagnosis_preserves_feishu_code_and_log_id(monkeypatch) -> None:
    settings = connector_settings()
    monkeypatch.setattr(connectors, "get_settings", lambda: settings)
    monkeypatch.setattr(
        connectors,
        "_configuration",
        AsyncMock(return_value=(passing_checks(), Mock(spec=KnowledgeBase))),
    )
    client = AsyncMock()
    client.diagnose_space.side_effect = FeishuAPIError(
        "permission denied",
        operation="wiki/v2/spaces/space-1/nodes",
        code=131006,
        log_id="trace-1",
    )
    monkeypatch.setattr(connectors, "FeishuClient", lambda: client)
    identity = RequestIdentity(
        tenant_id="tenant-a", user_id="admin-a", is_admin=True
    )
    db = AsyncMock(spec=AsyncSession)

    report = await connectors.diagnose_feishu_connector(identity=identity, db=db)

    assert report.status == "failed"
    failure = report.checks[-1]
    assert failure.key == "connectivity"
    assert failure.error_code == 131006
    assert failure.log_id == "trace-1"
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_manual_sync_creates_persisted_parent_job_and_audit(monkeypatch) -> None:
    settings = connector_settings()
    knowledge_base = KnowledgeBase(
        id=uuid4(),
        tenant_id="tenant-a",
        slug="feishu",
        name="Feishu KB",
        access_mode="restricted",
        status="active",
        created_by="owner-a",
    )
    monkeypatch.setattr(connectors, "get_settings", lambda: settings)
    monkeypatch.setattr(
        connectors,
        "_configuration",
        AsyncMock(return_value=(passing_checks(), knowledge_base)),
    )
    monkeypatch.setattr(connectors, "active_feishu_sync_job", AsyncMock(return_value=None))
    dispatch = Mock()
    monkeypatch.setattr(connectors.sync_feishu_task, "apply_async", dispatch)
    identity = RequestIdentity(
        tenant_id="tenant-a", user_id="admin-a", is_admin=True
    )

    class FakeSession:
        def __init__(self) -> None:
            self.added: list[object] = []

        def add(self, item: object) -> None:
            self.added.append(item)

        async def flush(self) -> None:
            job = self.added[0]
            if isinstance(job, IngestionJob) and job.id is None:
                job.id = uuid4()

        async def commit(self) -> None:
            return None

        async def rollback(self) -> None:
            return None

        async def refresh(self, _item: object) -> None:
            return None

    db = FakeSession()
    job = await connectors.start_feishu_sync(identity=identity, db=db)  # type: ignore[arg-type]

    assert job.job_type == "feishu_sync"
    assert job.status == "queued"
    assert job.knowledge_base_id == knowledge_base.id
    assert job.result["trigger"] == "manual"
    dispatch.assert_called_once_with(args=[str(job.id)], task_id=job.task_id)
    assert len(db.added) == 2


@pytest.mark.asyncio
async def test_connector_management_is_admin_and_tenant_scoped(monkeypatch) -> None:
    monkeypatch.setattr(connectors, "get_settings", connector_settings)
    db = AsyncMock(spec=AsyncSession)
    with pytest.raises(HTTPException) as non_admin:
        await connectors.get_feishu_connector(
            identity=RequestIdentity(tenant_id="tenant-a", user_id="user-a"),
            db=db,
        )
    assert non_admin.value.status_code == 403

    with pytest.raises(HTTPException) as cross_tenant:
        await connectors.get_feishu_connector(
            identity=RequestIdentity(
                tenant_id="tenant-b", user_id="admin-b", is_admin=True
            ),
            db=db,
        )
    assert cross_tenant.value.status_code == 404


def test_feishu_parent_job_model_and_routes_are_published() -> None:
    from app.main import app

    paths = app.openapi()["paths"]
    assert "get" in paths["/api/v1/connectors/feishu"]
    assert "post" in paths["/api/v1/connectors/feishu/diagnose"]
    assert "post" in paths["/api/v1/connectors/feishu/sync"]
    table = cast(Table, IngestionJob.__table__)
    assert "uq_ingestion_jobs_active_feishu_sync" in {
        index.name for index in table.indexes
    }
