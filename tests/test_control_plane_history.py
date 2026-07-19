from typing import cast
from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import IngestionJob, KnowledgeBase
from app.main import app
from app.schemas.document import JobPage
from app.schemas.knowledge_base import KnowledgeBaseUpdate
from app.security.identity import RequestIdentity
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
    }
    assert expected <= paths.keys()
    assert "get" in paths["/api/v1/jobs"]
    assert "get" in paths["/api/v1/evaluations/runs"]
    assert "patch" in paths["/api/v1/knowledge-bases/{knowledge_base_id}"]
    assert "post" in paths["/api/v1/knowledge-bases/{knowledge_base_id}/archive"]
    assert "post" in paths["/api/v1/knowledge-bases/{knowledge_base_id}/restore"]
    assert "delete" in paths[
        "/api/v1/knowledge-bases/{knowledge_base_id}/members/{member_id}"
    ]


def test_ingestion_jobs_have_stable_knowledge_base_scope() -> None:
    assert "knowledge_base_id" in IngestionJob.__table__.columns
    assert "ix_ingestion_jobs_tenant_kb_created" in {
        index.name for index in IngestionJob.__table__.indexes
    }


def test_page_contract_enforces_bounded_limits() -> None:
    with pytest.raises(ValidationError):
        JobPage(items=[], total=0, limit=101, offset=0)


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
