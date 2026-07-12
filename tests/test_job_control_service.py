from pathlib import Path
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from app.db.models import Document, IngestionJob
from app.services import ingestion_service, job_control_service
from app.services.ingestion_service import DocumentJobClaim
from app.services.job_control_service import (
    INDEX_MAINTENANCE_LOCK,
    INDEX_REBUILD_LOCK,
    AdvisoryLock,
    advisory_locks,
)


class FakeSession:
    def __init__(self, scalar_results: list[object]) -> None:
        self.scalar_results = scalar_results
        self.committed = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback) -> None:
        return None

    async def scalar(self, statement):
        return self.scalar_results.pop(0)

    async def commit(self) -> None:
        self.committed = True


def make_document(document_id, *, index_version: str | None) -> Document:
    return Document(
        id=document_id,
        tenant_id="tenant",
        knowledge_base_id=uuid4(),
        name="architecture.md",
        source_type="upload",
        checksum="a" * 64,
        size_bytes=1,
        status="reindexing" if index_version else "queued",
        chunk_count=3,
        index_version=index_version,
        extra_metadata={},
    )


@pytest.mark.asyncio
async def test_claim_resumes_already_published_ingestion(monkeypatch) -> None:
    document_id = uuid4()
    job_id = uuid4()
    target_version = "target-version"
    document = make_document(document_id, index_version=target_version)
    job = IngestionJob(
        id=job_id,
        tenant_id="tenant",
        document_id=document_id,
        task_id=str(uuid4()),
        job_type="document_reindex",
        status="running",
        progress=82,
        result={
            "previous_index_version": "old-version",
            "target_index_version": target_version,
        },
    )
    session = FakeSession([job, document])
    monkeypatch.setattr(ingestion_service, "AsyncSessionFactory", lambda: session)

    claim = await ingestion_service._claim_document_ingestion(document_id, job_id)

    assert claim.should_run is False
    assert claim.already_published is True
    assert claim.target_index_version == target_version
    assert job.status == "succeeded"
    assert document.status == "ready"
    assert session.committed is True


@pytest.mark.asyncio
async def test_claim_reuses_target_version_after_worker_redelivery(monkeypatch) -> None:
    document_id = uuid4()
    job_id = uuid4()
    document = make_document(document_id, index_version="old-version")
    job = IngestionJob(
        id=job_id,
        tenant_id="tenant",
        document_id=document_id,
        task_id=str(uuid4()),
        job_type="document_reindex",
        status="running",
        progress=20,
        result={
            "previous_index_version": "old-version",
            "target_index_version": "stable-target",
        },
    )
    session = FakeSession([job, document])
    monkeypatch.setattr(ingestion_service, "AsyncSessionFactory", lambda: session)

    claim = await ingestion_service._claim_document_ingestion(document_id, job_id)

    assert claim.should_run is True
    assert claim.resumed is True
    assert claim.target_index_version == "stable-target"
    assert job.result["target_index_version"] == "stable-target"
    assert document.status == "reindexing"


@pytest.mark.asyncio
async def test_published_redelivery_cleans_only_previous_version(monkeypatch) -> None:
    document_id = uuid4()
    job_id = uuid4()
    claim = DocumentJobClaim(
        should_run=False,
        result={"document_id": str(document_id), "index_version": "new-version"},
        previous_index_version="old-version",
        target_index_version="new-version",
        resumed=True,
        already_published=True,
    )
    monkeypatch.setattr(
        ingestion_service,
        "_claim_document_ingestion",
        AsyncMock(return_value=claim),
    )
    delete_version = AsyncMock()
    monkeypatch.setattr(
        ingestion_service.milvus_service,
        "delete_document_version",
        delete_version,
    )

    result = await ingestion_service._ingest_document_locked(
        document_id, job_id, Path("unused")
    )

    assert result["index_version"] == "new-version"
    delete_version.assert_awaited_once_with(str(document_id), "old-version")


@pytest.mark.asyncio
async def test_advisory_locks_acquire_in_order_and_release_in_reverse(monkeypatch) -> None:
    statements: list[str] = []

    class FakeConnection:
        async def execute(self, statement, parameters) -> None:
            statements.append(str(statement))

    class ConnectionContext:
        async def __aenter__(self):
            return FakeConnection()

        async def __aexit__(self, exc_type, exc, traceback) -> None:
            return None

    class FakeEngine:
        def connect(self):
            return ConnectionContext()

    monkeypatch.setattr(job_control_service, "engine", FakeEngine())
    shared = AdvisoryLock("index", "global", shared=True)
    exclusive = AdvisoryLock("document", "123")

    async with advisory_locks([shared, exclusive]):
        statements.append("protected")

    assert statements == [
        "SELECT pg_advisory_lock_shared(:lock_key)",
        "SELECT pg_advisory_lock(:lock_key)",
        "protected",
        "SELECT pg_advisory_unlock(:lock_key)",
        "SELECT pg_advisory_unlock_shared(:lock_key)",
    ]


def test_active_job_partial_indexes_are_declared() -> None:
    indexes = {item.name: item for item in IngestionJob.__table__.indexes}

    assert indexes["uq_ingestion_jobs_active_document"].unique is True
    assert indexes["uq_ingestion_jobs_active_rebuild"].unique is True
    assert "queued" in str(
        indexes["uq_ingestion_jobs_active_document"].dialect_options["postgresql"]["where"]
    )


def test_shared_maintenance_and_exclusive_rebuild_use_same_lock_key() -> None:
    assert INDEX_MAINTENANCE_LOCK.shared is True
    assert INDEX_REBUILD_LOCK.shared is False
    assert INDEX_MAINTENANCE_LOCK.key == INDEX_REBUILD_LOCK.key
