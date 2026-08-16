from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1 import evaluations as evaluations_api
from app.api.v1 import jobs as jobs_api
from app.db.models import Document, EvaluationRun, IngestionJob
from app.security.identity import RequestIdentity
from app.services import evaluation_service, job_control_service


class FakeSession:
    def __init__(self, scalar_results: list[object] | None = None) -> None:
        self.scalar_results = list(scalar_results or [])
        self.added: list[object] = []
        self.commits = 0
        self.rolled_back = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, _exc_type, _exc, _traceback) -> None:
        return None

    async def scalar(self, _statement):
        return self.scalar_results.pop(0)

    def add(self, value: object) -> None:
        self.added.append(value)

    async def flush(self) -> None:
        for value in self.added:
            if hasattr(value, "id") and getattr(value, "id", None) is None:
                value.id = uuid4()

    async def commit(self) -> None:
        self.commits += 1

    async def rollback(self) -> None:
        self.rolled_back = True

    async def refresh(self, _value: object) -> None:
        return None


def identity(*, admin: bool = False) -> RequestIdentity:
    return RequestIdentity(
        tenant_id="tenant-a",
        user_id="operator-a",
        is_admin=admin,
    )


def document(*, source_uri: str, index_version: str | None = None) -> Document:
    return Document(
        id=uuid4(),
        tenant_id="tenant-a",
        knowledge_base_id=uuid4(),
        name="retry.md",
        source_type="upload",
        source_uri=source_uri,
        checksum="a" * 64,
        size_bytes=12,
        status="failed",
        chunk_count=1 if index_version else 0,
        index_version=index_version,
        extra_metadata={},
    )


@pytest.mark.asyncio
async def test_cancel_queued_job_restores_document_and_revokes_without_termination(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    item = document(source_uri="unused", index_version="stable")
    job = IngestionJob(
        id=uuid4(),
        tenant_id="tenant-a",
        knowledge_base_id=item.knowledge_base_id,
        document_id=item.id,
        task_id="task-cancel",
        job_type="document_reindex",
        status="queued",
        progress=0,
        result={},
    )
    db = FakeSession([job, item])
    monkeypatch.setattr(jobs_api, "_authorize_job_control", AsyncMock())
    revoke = MagicMock()
    monkeypatch.setattr(jobs_api.celery_app.control, "revoke", revoke)

    cancelled = await jobs_api.cancel_job(job.id, identity(), db)  # type: ignore[arg-type]

    assert cancelled.status == "cancelled"
    assert cancelled.cancelled_by == "operator-a"
    assert cancelled.cancelled_at is not None
    assert item.status == "ready"
    assert item.error_message is None
    revoke.assert_called_once_with("task-cancel", terminate=False)
    assert any(getattr(value, "action", None) == "jobs.cancelled" for value in db.added)


@pytest.mark.asyncio
async def test_running_job_is_not_force_cancelled(monkeypatch: pytest.MonkeyPatch) -> None:
    job = IngestionJob(
        id=uuid4(),
        tenant_id="tenant-a",
        task_id="task-running",
        job_type="vector_index_rebuild",
        status="running",
        progress=20,
        result={},
    )
    db = FakeSession([job])
    monkeypatch.setattr(jobs_api, "_authorize_job_control", AsyncMock())

    with pytest.raises(HTTPException) as caught:
        await jobs_api.cancel_job(job.id, identity(admin=True), db)  # type: ignore[arg-type]

    assert caught.value.status_code == 409
    assert job.status == "running"


@pytest.mark.asyncio
async def test_job_control_enforces_tenant_and_global_admin_boundaries() -> None:
    foreign = IngestionJob(
        id=uuid4(),
        tenant_id="tenant-b",
        task_id="foreign",
        job_type="document_ingestion",
        status="queued",
        result={},
    )
    with pytest.raises(HTTPException) as hidden:
        await jobs_api._authorize_job_control(  # type: ignore[arg-type]
            FakeSession(), identity(admin=True), foreign
        )
    assert hidden.value.status_code == 404

    rebuild = IngestionJob(
        id=uuid4(),
        tenant_id="tenant-a",
        task_id="rebuild",
        job_type="vector_index_rebuild",
        status="queued",
        result={},
    )
    with pytest.raises(HTTPException) as forbidden:
        await jobs_api._authorize_job_control(  # type: ignore[arg-type]
            FakeSession(), identity(), rebuild
        )
    assert forbidden.value.status_code == 403


@pytest.mark.asyncio
async def test_retry_failed_document_job_preserves_source_link_and_dispatches_new_task(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = tmp_path / "retry.md"
    source.write_text("approved synthetic retry", encoding="utf-8")
    item = document(source_uri=str(source))
    original = IngestionJob(
        id=uuid4(),
        tenant_id="tenant-a",
        knowledge_base_id=item.knowledge_base_id,
        document_id=item.id,
        task_id="task-failed",
        job_type="document_ingestion",
        status="failed",
        progress=100,
        result={},
        error_message="provider unavailable",
    )
    db = FakeSession([original, item])
    monkeypatch.setattr(jobs_api, "_authorize_job_control", AsyncMock())
    monkeypatch.setattr(jobs_api, "active_document_job", AsyncMock(return_value=None))
    dispatch = MagicMock()
    monkeypatch.setattr(jobs_api.ingest_document_task, "apply_async", dispatch)

    retried = await jobs_api.retry_job(original.id, identity(), db)  # type: ignore[arg-type]

    assert retried.id != original.id
    assert retried.retry_of_job_id == original.id
    assert retried.status == "queued"
    assert retried.task_id != original.task_id
    assert item.status == "queued"
    dispatch.assert_called_once_with(
        args=[str(item.id), str(retried.id), str(source.resolve())],
        task_id=retried.task_id,
    )
    assert any(
        getattr(value, "action", None) == "jobs.retry_requested" for value in db.added
    )


@pytest.mark.asyncio
async def test_cancel_and_retry_evaluation_run_keep_auditable_lineage(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset_id = uuid4()
    knowledge_base_id = uuid4()
    queued = EvaluationRun(
        id=uuid4(),
        tenant_id="tenant-a",
        knowledge_base_id=knowledge_base_id,
        dataset_id=dataset_id,
        created_by="owner",
        task_id="eval-queued",
        status="queued",
        progress=0,
        total_cases=3,
        config_snapshot={"retrieval_top_k": 10},
        summary={},
    )
    authorize = AsyncMock(return_value=SimpleNamespace(id=dataset_id))
    monkeypatch.setattr(evaluations_api, "_authorize_dataset", authorize)
    revoke = MagicMock()
    monkeypatch.setattr(evaluations_api.celery_app.control, "revoke", revoke)
    cancel_db = FakeSession([queued])

    cancelled = await evaluations_api.cancel_run(  # type: ignore[arg-type]
        queued.id, identity(), cancel_db
    )

    assert cancelled.status == "cancelled"
    assert cancelled.cancelled_by == "operator-a"
    assert cancelled.completed_at == cancelled.cancelled_at
    revoke.assert_called_once_with("eval-queued", terminate=False)

    retry_db = FakeSession([cancelled, 3])
    dispatch = MagicMock()
    monkeypatch.setattr(evaluations_api.run_evaluation_task, "apply_async", dispatch)
    monkeypatch.setattr(
        evaluations_api,
        "build_config_snapshot",
        lambda: {"retrieval_top_k": 10},
    )

    retried = await evaluations_api.retry_run(  # type: ignore[arg-type]
        cancelled.id, identity(), retry_db
    )

    assert retried.retry_of_run_id == cancelled.id
    assert retried.status == "queued"
    assert retried.config_snapshot == {"retrieval_top_k": 10}
    assert retried.created_by == "operator-a"
    dispatch.assert_called_once_with(args=[str(retried.id)], task_id=retried.task_id)
    assert any(
        getattr(value, "action", None) == "evaluations.run_retry_requested"
        for value in retry_db.added
    )


@pytest.mark.asyncio
async def test_evaluation_retry_rejects_a_changed_configuration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset_id = uuid4()
    failed = EvaluationRun(
        id=uuid4(),
        tenant_id="tenant-a",
        knowledge_base_id=uuid4(),
        dataset_id=dataset_id,
        created_by="operator-a",
        task_id="failed-evaluation",
        status="failed",
        progress=100,
        total_cases=2,
        config_snapshot={"retrieval_top_k": 8},
        summary={},
    )
    db = FakeSession([failed, 2])
    monkeypatch.setattr(
        evaluations_api,
        "_authorize_dataset",
        AsyncMock(return_value=SimpleNamespace(id=dataset_id)),
    )
    monkeypatch.setattr(
        evaluations_api,
        "build_config_snapshot",
        lambda: {"retrieval_top_k": 10},
    )

    with pytest.raises(HTTPException) as caught:
        await evaluations_api.retry_run(failed.id, identity(), db)  # type: ignore[arg-type]

    assert caught.value.status_code == 409
    assert "configuration changed" in str(caught.value.detail)
    assert not any(isinstance(value, EvaluationRun) for value in db.added)


def test_job_control_models_expose_lineage_and_cancellation_metadata() -> None:
    assert {"retry_of_job_id", "cancelled_at", "cancelled_by"} <= set(
        IngestionJob.__table__.columns.keys()
    )
    assert {"retry_of_run_id", "cancelled_at", "cancelled_by"} <= set(
        EvaluationRun.__table__.columns.keys()
    )
    assert EvaluationRun.__table__.indexes
    indexes = {index.name: index for index in EvaluationRun.__table__.indexes}
    assert indexes["uq_evaluation_runs_active_retry"].unique is True


def test_job_control_routes_are_published() -> None:
    paths = evaluations_api.router.routes + jobs_api.router.routes
    route_paths = {route.path for route in paths}
    assert "/{job_id}/cancel" in route_paths
    assert "/{job_id}/retry" in route_paths
    assert "/runs/{run_id}/cancel" in route_paths
    assert "/runs/{run_id}/retry" in route_paths


@pytest.mark.asyncio
async def test_cancelled_worker_claims_are_noops(monkeypatch: pytest.MonkeyPatch) -> None:
    ingestion = IngestionJob(
        id=uuid4(),
        tenant_id="tenant-a",
        task_id="cancelled-ingestion",
        job_type="local_document_scan",
        status="cancelled",
        progress=0,
        result={},
    )
    ingestion_db = FakeSession([ingestion])
    monkeypatch.setattr(
        job_control_service, "AsyncSessionFactory", lambda: ingestion_db
    )

    claimed = await job_control_service.claim_job_execution(
        ingestion.id,
        expected_type="local_document_scan",
        progress=10,
    )

    assert claimed is False
    assert ingestion.status == "cancelled"
    assert ingestion_db.commits == 0

    evaluation = EvaluationRun(
        id=uuid4(),
        tenant_id="tenant-a",
        knowledge_base_id=uuid4(),
        dataset_id=uuid4(),
        created_by="operator-a",
        task_id="cancelled-evaluation",
        status="cancelled",
        progress=0,
        total_cases=2,
        config_snapshot={},
        summary={},
    )
    evaluation_db = FakeSession([evaluation])
    monkeypatch.setattr(
        evaluation_service, "AsyncSessionFactory", lambda: evaluation_db
    )

    result = await evaluation_service.execute_evaluation_run(evaluation.id)

    assert result == {
        "status": "skipped",
        "reason": "evaluation run already cancelled",
    }
    assert evaluation.status == "cancelled"
