from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import request_identity
from app.db.models import EvaluationRun, IngestionJob, KnowledgeBase, KnowledgeBaseMember
from app.db.session import get_db
from app.schemas.knowledge_base import (
    DirectoryPrincipalRead,
    KnowledgeBaseCreate,
    KnowledgeBaseMemberRead,
    KnowledgeBaseMemberUpsert,
    KnowledgeBasePermissionRead,
    KnowledgeBaseRead,
    KnowledgeBaseUpdate,
)
from app.security.identity import RequestIdentity
from app.services.audit_service import record_audit
from app.services.enterprise_directory_service import (
    EnterpriseDirectoryError,
    EnterpriseDirectoryNotConfigured,
    EnterpriseDirectoryTenantMismatch,
    KeycloakDirectoryService,
    get_enterprise_directory_service,
)
from app.services.knowledge_base_service import knowledge_base_service

router = APIRouter()


async def _owner_knowledge_base(
    db: AsyncSession,
    identity: RequestIdentity,
    knowledge_base_id: UUID,
    *,
    allow_archived: bool = False,
) -> KnowledgeBase:
    knowledge_base = await db.get(KnowledgeBase, knowledge_base_id)
    allowed_statuses = {"active", "archived"} if allow_archived else {"active"}
    if (
        knowledge_base is None
        or knowledge_base.tenant_id != identity.tenant_id
        or knowledge_base.status not in allowed_statuses
    ):
        raise HTTPException(status_code=404, detail="knowledge base not found")
    try:
        permission, _ = await knowledge_base_service.effective_permission(
            db, identity, knowledge_base
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if permission != "owner":
        raise HTTPException(status_code=403, detail="knowledge-base owner permission required")
    return knowledge_base


@router.post("", response_model=KnowledgeBaseRead, status_code=status.HTTP_201_CREATED)
async def create_knowledge_base(
    payload: KnowledgeBaseCreate,
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> KnowledgeBase:
    tenant_id = identity.tenant_id
    user_id = identity.user_id
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
    include_archived: bool = Query(default=False),
    query: str | None = Query(default=None, alias="q", max_length=200),
    limit: int = Query(default=100, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> list[KnowledgeBase]:
    knowledge_bases = await knowledge_base_service.list_accessible_identity(
        db,
        identity,
        include_archived=include_archived,
        query=query,
        limit=limit,
        offset=offset,
    )
    await db.commit()
    return knowledge_bases


@router.get("/{knowledge_base_id}", response_model=KnowledgeBaseRead)
async def get_knowledge_base(
    knowledge_base_id: UUID,
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> KnowledgeBase:
    knowledge_base = await db.get(KnowledgeBase, knowledge_base_id)
    if knowledge_base is None or knowledge_base.tenant_id != identity.tenant_id:
        raise HTTPException(status_code=404, detail="knowledge base not found")
    if knowledge_base.status == "archived":
        return await _owner_knowledge_base(
            db, identity, knowledge_base_id, allow_archived=True
        )
    try:
        return await knowledge_base_service.authorize_identity(
            db, identity, knowledge_base_id
        )
    except (LookupError, PermissionError) as exc:
        raise HTTPException(status_code=404, detail="knowledge base not found") from exc


@router.patch("/{knowledge_base_id}", response_model=KnowledgeBaseRead)
async def update_knowledge_base(
    knowledge_base_id: UUID,
    payload: KnowledgeBaseUpdate,
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> KnowledgeBase:
    knowledge_base = await _owner_knowledge_base(db, identity, knowledge_base_id)
    changes = payload.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(knowledge_base, key, value)
    record_audit(
        db,
        tenant_id=identity.tenant_id,
        user_id=identity.user_id,
        action="knowledge_bases.updated",
        resource_type="knowledge_base",
        resource_id=str(knowledge_base.id),
        details={"fields": sorted(changes)},
    )
    await db.commit()
    await db.refresh(knowledge_base)
    return knowledge_base


@router.post("/{knowledge_base_id}/archive", response_model=KnowledgeBaseRead)
async def archive_knowledge_base(
    knowledge_base_id: UUID,
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> KnowledgeBase:
    knowledge_base = await _owner_knowledge_base(db, identity, knowledge_base_id)
    if knowledge_base.is_default:
        raise HTTPException(status_code=409, detail="the default knowledge base cannot be archived")
    active_work = int(
        await db.scalar(
            select(func.count())
            .select_from(IngestionJob)
            .where(
                IngestionJob.knowledge_base_id == knowledge_base.id,
                IngestionJob.status.in_(["queued", "running"]),
            )
        )
        or 0
    ) + int(
        await db.scalar(
            select(func.count())
            .select_from(EvaluationRun)
            .where(
                EvaluationRun.knowledge_base_id == knowledge_base.id,
                EvaluationRun.status.in_(["queued", "running"]),
            )
        )
        or 0
    )
    if active_work:
        raise HTTPException(
            status_code=409,
            detail="knowledge base has queued or running work",
        )
    knowledge_base.status = "archived"
    record_audit(
        db,
        tenant_id=identity.tenant_id,
        user_id=identity.user_id,
        action="knowledge_bases.archived",
        resource_type="knowledge_base",
        resource_id=str(knowledge_base.id),
    )
    await db.commit()
    await db.refresh(knowledge_base)
    return knowledge_base


@router.post("/{knowledge_base_id}/restore", response_model=KnowledgeBaseRead)
async def restore_knowledge_base(
    knowledge_base_id: UUID,
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> KnowledgeBase:
    knowledge_base = await _owner_knowledge_base(
        db, identity, knowledge_base_id, allow_archived=True
    )
    if knowledge_base.status != "archived":
        raise HTTPException(status_code=409, detail="knowledge base is not archived")
    knowledge_base.status = "active"
    record_audit(
        db,
        tenant_id=identity.tenant_id,
        user_id=identity.user_id,
        action="knowledge_bases.restored",
        resource_type="knowledge_base",
        resource_id=str(knowledge_base.id),
    )
    await db.commit()
    await db.refresh(knowledge_base)
    return knowledge_base


@router.get(
    "/{knowledge_base_id}/directory-principals",
    response_model=list[DirectoryPrincipalRead],
)
async def search_directory_principals(
    knowledge_base_id: UUID,
    principal_type: Literal["user", "group"] = Query(alias="type"),
    query: str = Query(alias="q", min_length=2, max_length=200),
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
    directory_service: KeycloakDirectoryService = Depends(
        get_enterprise_directory_service
    ),
) -> list[DirectoryPrincipalRead]:
    clean_query = query.strip()
    if len(clean_query) < 2:
        raise HTTPException(
            status_code=422,
            detail="directory query must contain at least two non-space characters",
        )
    try:
        await knowledge_base_service.authorize_identity(
            db, identity, knowledge_base_id, required_permission="owner"
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    try:
        return await directory_service.search(
            tenant_id=identity.tenant_id,
            principal_type=principal_type,
            query=clean_query,
            limit=limit,
            offset=offset,
        )
    except (
        EnterpriseDirectoryNotConfigured,
        EnterpriseDirectoryTenantMismatch,
    ) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except EnterpriseDirectoryError as exc:
        raise HTTPException(
            status_code=503,
            detail="enterprise directory is temporarily unavailable",
        ) from exc


@router.get(
    "/{knowledge_base_id}/members", response_model=list[KnowledgeBaseMemberRead]
)
async def list_members(
    knowledge_base_id: UUID,
    query: str | None = Query(default=None, alias="q", max_length=200),
    limit: int = Query(default=100, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> list[KnowledgeBaseMember]:
    try:
        await knowledge_base_service.authorize_identity(
            db, identity, knowledge_base_id, required_permission="owner"
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    statement = select(KnowledgeBaseMember).where(
        KnowledgeBaseMember.knowledge_base_id == knowledge_base_id
    )
    if query:
        statement = statement.where(KnowledgeBaseMember.principal_id.ilike(f"%{query}%"))
    return list(
        (
            await db.execute(
                statement.order_by(
                    KnowledgeBaseMember.principal_type,
                    KnowledgeBaseMember.principal_id,
                )
                .limit(limit)
                .offset(offset)
            )
        ).scalars()
    )


@router.get(
    "/{knowledge_base_id}/permissions/me", response_model=KnowledgeBasePermissionRead
)
async def get_current_permission(
    knowledge_base_id: UUID,
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> KnowledgeBasePermissionRead:
    try:
        knowledge_base = await db.get(KnowledgeBase, knowledge_base_id)
        if knowledge_base is not None and knowledge_base.status == "archived":
            knowledge_base = await _owner_knowledge_base(
                db, identity, knowledge_base_id, allow_archived=True
            )
        else:
            knowledge_base = await knowledge_base_service.authorize_identity(
                db, identity, knowledge_base_id
            )
    except (LookupError, PermissionError) as exc:
        raise HTTPException(status_code=404, detail="knowledge base not found") from exc
    permission, source = await knowledge_base_service.effective_permission(
        db, identity, knowledge_base
    )
    return KnowledgeBasePermissionRead(
        knowledge_base_id=knowledge_base.id,
        permission=permission,
        source=source,
    )


@router.put("/{knowledge_base_id}/members", response_model=KnowledgeBaseMemberRead)
async def upsert_member(
    knowledge_base_id: UUID,
    payload: KnowledgeBaseMemberUpsert,
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> KnowledgeBaseMember:
    tenant_id = identity.tenant_id
    user_id = identity.user_id
    knowledge_base = await _owner_knowledge_base(db, identity, knowledge_base_id)
    if (
        payload.principal_type == "user"
        and payload.principal_id == knowledge_base.created_by
        and payload.permission != "owner"
    ):
        raise HTTPException(status_code=409, detail="the creator must retain owner permission")

    member_id = uuid4()
    await db.execute(
        insert(KnowledgeBaseMember)
        .values(
            id=member_id,
            tenant_id=tenant_id,
            knowledge_base_id=knowledge_base_id,
            principal_type=payload.principal_type,
            principal_id=payload.principal_id,
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
        details={
            "principal_type": payload.principal_type,
            "principal_id": payload.principal_id,
            "permission": payload.permission,
        },
    )
    await db.commit()
    member = await db.scalar(
        select(KnowledgeBaseMember).where(
            KnowledgeBaseMember.knowledge_base_id == knowledge_base_id,
            KnowledgeBaseMember.principal_type == payload.principal_type,
            KnowledgeBaseMember.principal_id == payload.principal_id,
        )
    )
    if member is None:
        raise RuntimeError("member upsert did not return a row")
    return member


@router.delete(
    "/{knowledge_base_id}/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_member(
    knowledge_base_id: UUID,
    member_id: UUID,
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> Response:
    knowledge_base = await _owner_knowledge_base(db, identity, knowledge_base_id)
    member = await db.get(KnowledgeBaseMember, member_id)
    if (
        member is None
        or member.tenant_id != identity.tenant_id
        or member.knowledge_base_id != knowledge_base.id
    ):
        raise HTTPException(status_code=404, detail="knowledge-base member not found")
    if member.principal_type == "user" and member.principal_id == knowledge_base.created_by:
        raise HTTPException(status_code=409, detail="the creator owner grant cannot be removed")
    if member.permission == "owner":
        owner_count = int(
            await db.scalar(
                select(func.count())
                .select_from(KnowledgeBaseMember)
                .where(
                    KnowledgeBaseMember.knowledge_base_id == knowledge_base.id,
                    KnowledgeBaseMember.permission == "owner",
                )
            )
            or 0
        )
        if owner_count <= 1:
            raise HTTPException(status_code=409, detail="the last owner grant cannot be removed")
    details = {
        "principal_type": member.principal_type,
        "principal_id": member.principal_id,
        "permission": member.permission,
    }
    await db.delete(member)
    record_audit(
        db,
        tenant_id=identity.tenant_id,
        user_id=identity.user_id,
        action="knowledge_bases.member_removed",
        resource_type="knowledge_base",
        resource_id=str(knowledge_base.id),
        details=details,
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
