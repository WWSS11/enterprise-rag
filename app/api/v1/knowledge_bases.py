from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import request_identity
from app.db.models import KnowledgeBase, KnowledgeBaseMember
from app.db.session import get_db
from app.schemas.knowledge_base import (
    KnowledgeBaseCreate,
    KnowledgeBaseMemberRead,
    KnowledgeBaseMemberUpsert,
    KnowledgeBaseRead,
)
from app.services.audit_service import record_audit
from app.services.knowledge_base_service import knowledge_base_service

router = APIRouter()


@router.post("", response_model=KnowledgeBaseRead, status_code=status.HTTP_201_CREATED)
async def create_knowledge_base(
    payload: KnowledgeBaseCreate,
    identity: tuple[str, str] = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> KnowledgeBase:
    tenant_id, user_id = identity
    knowledge_base = KnowledgeBase(
        tenant_id=tenant_id,
        slug=payload.slug,
        name=payload.name,
        description=payload.description,
        access_mode=payload.access_mode,
        status="active",
        is_default=False,
        created_by=user_id,
    )
    db.add(knowledge_base)
    await db.flush()
    db.add(
        KnowledgeBaseMember(
            tenant_id=tenant_id,
            knowledge_base_id=knowledge_base.id,
            principal_type="user",
            principal_id=user_id,
            permission="owner",
        )
    )
    record_audit(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="knowledge_bases.created",
        resource_type="knowledge_base",
        resource_id=str(knowledge_base.id),
        details={"slug": knowledge_base.slug, "access_mode": knowledge_base.access_mode},
    )
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="knowledge-base slug already exists") from exc
    await db.refresh(knowledge_base)
    return knowledge_base


@router.get("", response_model=list[KnowledgeBaseRead])
async def list_knowledge_bases(
    identity: tuple[str, str] = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> list[KnowledgeBase]:
    knowledge_bases = await knowledge_base_service.list_accessible(db, *identity)
    await db.commit()
    return knowledge_bases


@router.put("/{knowledge_base_id}/members", response_model=KnowledgeBaseMemberRead)
async def upsert_member(
    knowledge_base_id: UUID,
    payload: KnowledgeBaseMemberUpsert,
    identity: tuple[str, str] = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> KnowledgeBaseMember:
    tenant_id, user_id = identity
    try:
        await knowledge_base_service.authorize(
            db, tenant_id, user_id, knowledge_base_id, required_permission="owner"
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    member_id = uuid4()
    await db.execute(
        insert(KnowledgeBaseMember)
        .values(
            id=member_id,
            tenant_id=tenant_id,
            knowledge_base_id=knowledge_base_id,
            principal_type="user",
            principal_id=payload.user_id,
            permission=payload.permission,
        )
        .on_conflict_do_update(
            constraint="uq_kb_members_principal",
            set_={"permission": payload.permission},
        )
    )
    record_audit(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="knowledge_bases.member_upserted",
        resource_type="knowledge_base",
        resource_id=str(knowledge_base_id),
        details={"member_user_id": payload.user_id, "permission": payload.permission},
    )
    await db.commit()
    member = await db.scalar(
        select(KnowledgeBaseMember).where(
            KnowledgeBaseMember.knowledge_base_id == knowledge_base_id,
            KnowledgeBaseMember.principal_type == "user",
            KnowledgeBaseMember.principal_id == payload.user_id,
        )
    )
    if member is None:
        raise RuntimeError("member upsert did not return a row")
    return member
