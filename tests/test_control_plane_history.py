from typing import cast
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.conversations import _message_window
from app.db.models import Conversation, IngestionJob, KnowledgeBase
from app.main import app
from app.schemas.conversation import ConversationUpdate
from app.schemas.document import JobPage
from app.schemas.knowledge_base import KnowledgeBaseUpdate
from app.security.identity import RequestIdentity
from app.services.conversation_service import conversation_service
from app.services.knowledge_base_service import knowledge_base_service


def test_control_plane_history_routes_are_published() -> None:
    paths = app.openapi()["paths"]
    expected = {
        "/api/v1/jobs",
        "/api/v1/evaluations/runs",
        "/api/v1/conversations",
        "/api/v1/conversations/{conversation_id}/messages",
        "/api/v1/knowledge-bases/{knowledge_base_id}/members",
        "/api/v1/knowledge-bases/{knowledge_base_id}/permissions/me",
        "/api/v1/audit-logs",
        "/api/v1/jobs/{job_id}/cancel",
        "/api/v1/jobs/{job_id}/retry",
        "/api/v1/evaluations/runs/{run_id}/cancel",
        "/api/v1/evaluations/runs/{run_id}/retry",
        "/api/v1/knowledge-bases/{knowledge_base_id}/directory-principals",
    }
    assert expected <= paths.keys()
    assert "get" in paths["/api/v1/jobs"]
    assert "get" in paths["/api/v1/evaluations/runs"]
    assert "patch" in paths["/api/v1/conversations/{conversation_id}"]
    assert "post" in paths["/api/v1/conversations/{conversation_id}/archive"]
    assert "post" in paths["/api/v1/conversations/{conversation_id}/restore"]
    assert "patch" in paths["/api/v1/knowledge-bases/{knowledge_base_id}"]
    assert "post" in paths["/api/v1/knowledge-bases/{knowledge_base_id}/archive"]
    assert "post" in paths["/api/v1/knowledge-bases/{knowledge_base_id}/restore"]
    assert "delete" in paths[
        "/api/v1/knowledge-bases/{knowledge_base_id}/members/{member_id}"
    ]
    directory_parameters = {
        parameter["name"]
        for parameter in paths[
            "/api/v1/knowledge-bases/{knowledge_base_id}/directory-principals"
        ]["get"]["parameters"]
    }
    assert {"type", "q", "limit", "offset"} <= directory_parameters

    for path in [
        "/api/v1/knowledge-bases",
        "/api/v1/documents",
        "/api/v1/evaluations/datasets",
        "/api/v1/knowledge-bases/{knowledge_base_id}/members",
    ]:
        parameters = {
            parameter["name"] for parameter in paths[path]["get"]["parameters"]
        }
        assert {"q", "limit", "offset"} <= parameters


def test_ingestion_jobs_have_stable_knowledge_base_scope() -> None:
    assert "knowledge_base_id" in IngestionJob.__table__.columns
    assert "ix_ingestion_jobs_tenant_kb_created" in {
        index.name for index in IngestionJob.__table__.indexes
    }


def test_page_contract_enforces_bounded_limits() -> None:
    with pytest.raises(ValidationError):
        JobPage(items=[], total=0, limit=101, offset=0)


def test_e06_collection_limits_remain_bounded_in_openapi() -> None:
    paths = app.openapi()["paths"]
    expected_limits = {
        "/api/v1/knowledge-bases": (100, 100),
        "/api/v1/documents": (100, 100),
        "/api/v1/knowledge-bases/{knowledge_base_id}/members": (100, 100),
        "/api/v1/evaluations/datasets": (100, 100),
        "/api/v1/jobs": (50, 100),
        "/api/v1/conversations": (50, 100),
        "/api/v1/conversations/{conversation_id}/messages": (100, 200),
        "/api/v1/audit-logs": (50, 100),
        "/api/v1/evaluations/datasets/{dataset_id}/cases": (20, 100),
        "/api/v1/evaluations/runs": (50, 100),
    }
    for path, (default, maximum) in expected_limits.items():
        parameters = {
            parameter["name"]: parameter["schema"]
            for parameter in paths[path]["get"]["parameters"]
        }
        assert parameters["limit"]["default"] == default
        assert parameters["limit"]["maximum"] == maximum
        assert parameters["offset"]["minimum"] == 0

    for path in [
        "/api/v1/knowledge-bases",
        "/api/v1/documents",
        "/api/v1/knowledge-bases/{knowledge_base_id}/members",
        "/api/v1/evaluations/datasets",
        "/api/v1/evaluations/datasets/{dataset_id}/cases",
    ]:
        parameter_names = {
            parameter["name"] for parameter in paths[path]["get"]["parameters"]
        }
        assert "q" in parameter_names


def test_knowledge_base_update_requires_an_explicit_change() -> None:
    with pytest.raises(ValidationError):
        KnowledgeBaseUpdate()
    with pytest.raises(ValidationError):
        KnowledgeBaseUpdate(name=None)
    with pytest.raises(ValidationError):
        KnowledgeBaseUpdate(access_mode=None)
    assert KnowledgeBaseUpdate(description=None).model_dump(exclude_unset=True) == {
        "description": None
    }


def test_conversation_update_requires_a_nonempty_bounded_title() -> None:
    with pytest.raises(ValidationError):
        ConversationUpdate(title="")
    with pytest.raises(ValidationError):
        ConversationUpdate(title="   ")
    with pytest.raises(ValidationError):
        ConversationUpdate(title="x" * 256)
    assert ConversationUpdate(title="Security review").title == "Security review"


def test_latest_message_windows_do_not_overlap() -> None:
    assert _message_window(total=120, limit=50, offset=0, from_latest=True) == (70, 50)
    assert _message_window(total=120, limit=50, offset=50, from_latest=True) == (20, 50)
    assert _message_window(total=120, limit=50, offset=100, from_latest=True) == (0, 20)
    assert _message_window(total=120, limit=50, offset=120, from_latest=True) == (0, 0)
    assert _message_window(total=120, limit=50, offset=30, from_latest=False) == (30, 50)


@pytest.mark.asyncio
async def test_archived_conversation_cannot_accept_new_messages() -> None:
    conversation = Conversation(
        id=uuid4(),
        tenant_id="tenant-a",
        knowledge_base_id=uuid4(),
        user_id="user-a",
        title="Archived",
        status="archived",
    )
    db = AsyncMock(spec=AsyncSession)
    db.get.return_value = conversation

    with pytest.raises(ValueError, match="archived conversation"):
        await conversation_service.get_or_create(
            db,
            conversation.id,
            "tenant-a",
            "user-a",
            conversation.knowledge_base_id,
            "Can this continue?",
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("identity", "knowledge_base", "expected"),
    [
        (
            RequestIdentity(tenant_id="tenant-a", user_id="admin", is_admin=True),
            KnowledgeBase(
                id=uuid4(),
                tenant_id="tenant-a",
                slug="restricted",
                name="Restricted",
                access_mode="restricted",
                status="active",
                created_by="owner",
            ),
            ("owner", "admin"),
        ),
        (
            RequestIdentity(tenant_id="tenant-a", user_id="owner"),
            KnowledgeBase(
                id=uuid4(),
                tenant_id="tenant-a",
                slug="creator",
                name="Creator",
                access_mode="restricted",
                status="active",
                created_by="owner",
            ),
            ("owner", "creator"),
        ),
        (
            RequestIdentity(tenant_id="tenant-a", user_id="tenant-user"),
            KnowledgeBase(
                id=uuid4(),
                tenant_id="tenant-a",
                slug="tenant",
                name="Tenant",
                access_mode="tenant",
                status="active",
                created_by="owner",
            ),
            ("editor", "tenant"),
        ),
    ],
)
async def test_effective_permission_has_explicit_sources(
    identity: RequestIdentity,
    knowledge_base: KnowledgeBase,
    expected: tuple[str, str],
) -> None:
    unused_db = cast(AsyncSession, object())
    assert (
        await knowledge_base_service.effective_permission(
            unused_db, identity, knowledge_base
        )
        == expected
    )


@pytest.mark.asyncio
async def test_cross_tenant_admin_cannot_authorize_foreign_knowledge_base() -> None:
    foreign = KnowledgeBase(
        id=uuid4(),
        tenant_id="tenant-b",
        slug="foreign",
        name="Foreign",
        access_mode="tenant",
        status="active",
        created_by="owner-b",
    )
    db = AsyncMock(spec=AsyncSession)
    db.get.return_value = foreign

    with pytest.raises(LookupError, match="not found"):
        await knowledge_base_service.authorize_identity(
            db,
            RequestIdentity(tenant_id="tenant-a", user_id="admin-a", is_admin=True),
            foreign.id,
            required_permission="owner",
        )
