from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.api.v1 import evaluations as evaluations_api
from app.db.models import AuditLog, EvaluationCase, EvaluationDataset
from app.schemas.evaluation import EvaluationDatasetCopy, EvaluationDatasetUpdate
from app.security.identity import RequestIdentity


def dataset() -> EvaluationDataset:
    return EvaluationDataset(
        id=uuid4(),
        tenant_id="tenant-a",
        knowledge_base_id=uuid4(),
        name="Release gate",
        description="Original",
        status="active",
        created_by="owner-a",
    )


def identity() -> RequestIdentity:
    return RequestIdentity(tenant_id="tenant-a", user_id="editor-a")


def test_dataset_lifecycle_names_are_trimmed_and_cannot_be_blank() -> None:
    payload = EvaluationDatasetUpdate(name="  Release gate v2  ", description="  Notes  ")
    assert payload.name == "Release gate v2"
    assert payload.description == "Notes"
    with pytest.raises(ValidationError):
        EvaluationDatasetCopy(name="   ")


@pytest.mark.asyncio
async def test_update_dataset_changes_metadata_and_audits(monkeypatch: pytest.MonkeyPatch) -> None:
    item = dataset()
    db = AsyncMock()
    db.add = lambda value: None
    monkeypatch.setattr(
        evaluations_api,
        "_authorize_dataset",
        AsyncMock(return_value=item),
    )

    result = await evaluations_api.update_dataset(
        item.id,
        EvaluationDatasetUpdate(name="Release gate v2", description=None),
        identity(),
        db,
    )

    assert result is item
    assert item.name == "Release gate v2"
    assert item.description is None
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_archive_dataset_rejects_active_run(monkeypatch: pytest.MonkeyPatch) -> None:
    item = dataset()
    db = AsyncMock()
    db.scalar.return_value = 1
    monkeypatch.setattr(
        evaluations_api,
        "_authorize_dataset",
        AsyncMock(return_value=item),
    )

    with pytest.raises(HTTPException, match="queued or running") as exc_info:
        await evaluations_api.archive_dataset(item.id, identity(), db)

    assert exc_info.value.status_code == 409
    assert item.status == "active"
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_archive_dataset_marks_inactive_and_audits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    item = dataset()
    added: list[object] = []
    db = AsyncMock()
    db.scalar.return_value = 0
    db.add = added.append
    monkeypatch.setattr(
        evaluations_api,
        "_authorize_dataset",
        AsyncMock(return_value=item),
    )

    result = await evaluations_api.archive_dataset(item.id, identity(), db)

    assert result.status == "archived"
    assert any(
        isinstance(value, AuditLog) and value.action == "evaluations.dataset_archived"
        for value in added
    )
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_archived_dataset_remains_readable_for_historical_reports(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    item = dataset()
    item.status = "archived"
    db = AsyncMock()
    db.get.return_value = item
    authorize = AsyncMock()
    monkeypatch.setattr(
        evaluations_api.knowledge_base_service,
        "authorize_identity",
        authorize,
    )

    result = await evaluations_api._authorize_dataset(
        db,
        item.id,
        identity(),
        require_active=False,
    )

    assert result is item
    authorize.assert_awaited_once()

    with pytest.raises(HTTPException) as exc_info:
        await evaluations_api._authorize_dataset(db, item.id, identity())
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_copy_dataset_clones_cases_without_runs(monkeypatch: pytest.MonkeyPatch) -> None:
    source = dataset()
    source_case = EvaluationCase(
        id=uuid4(),
        dataset_id=source.id,
        question="What is required?",
        reference_answer="Approval.",
        expected_document_ids=[str(uuid4())],
        acceptable_citation_document_ids=[str(uuid4())],
        required_key_points=["Approval"],
        required_key_point_groups=[["Approval", "Approved"]],
        should_refuse=False,
        tags=["policy"],
    )
    added: list[object] = []
    copied_cases: list[EvaluationCase] = []
    db = AsyncMock()
    db.add = added.append
    db.add_all = copied_cases.extend
    db.execute.return_value = SimpleNamespace(scalars=lambda: [source_case])

    async def assign_id() -> None:
        copied = next(value for value in added if isinstance(value, EvaluationDataset))
        copied.id = uuid4()

    db.flush.side_effect = assign_id
    monkeypatch.setattr(
        evaluations_api,
        "_authorize_dataset",
        AsyncMock(return_value=source),
    )

    copied = await evaluations_api.copy_dataset(
        source.id,
        EvaluationDatasetCopy(name="Release gate copy", description="Editable copy"),
        identity(),
        db,
    )

    assert copied.id != source.id
    assert copied.knowledge_base_id == source.knowledge_base_id
    assert copied.created_by == "editor-a"
    assert len(copied_cases) == 1
    assert copied_cases[0].dataset_id == copied.id
    assert copied_cases[0].question == source_case.question
    assert copied_cases[0].required_key_point_groups == [["Approval", "Approved"]]
    assert copied_cases[0].required_key_point_groups is not source_case.required_key_point_groups
    assert any(
        isinstance(value, AuditLog) and value.action == "evaluations.dataset_copied"
        for value in added
    )
    db.commit.assert_awaited_once()


def test_dataset_lifecycle_routes_are_exposed() -> None:
    paths = evaluations_api.router.routes
    route_paths = {route.path for route in paths}
    assert "/datasets/{dataset_id}/archive" in route_paths
    assert "/datasets/{dataset_id}/copy" in route_paths
