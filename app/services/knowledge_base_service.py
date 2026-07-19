from uuid import UUID, uuid4

from sqlalchemy import and_, exists, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.models import KnowledgeBase, KnowledgeBaseMember
from app.security.identity import RequestIdentity

PERMISSION_RANK = {"reader": 10, "editor": 20, "owner": 30}


class KnowledgeBaseService:
    async def effective_permission(
        self,
        db: AsyncSession,
        identity: RequestIdentity,
        knowledge_base: KnowledgeBase,
    ) -> tuple[str, str]:
        if identity.is_admin:
            return "owner", "admin"
        if knowledge_base.created_by == identity.user_id:
            return "owner", "creator"
        if knowledge_base.access_mode == "tenant":
            return "editor", "tenant"

        principal_filters = [
            and_(
                KnowledgeBaseMember.principal_type == "user",
                KnowledgeBaseMember.principal_id == identity.user_id,
            )
        ]
        if identity.groups:
            principal_filters.append(
                and_(
                    KnowledgeBaseMember.principal_type == "group",
                    KnowledgeBaseMember.principal_id.in_(identity.groups),
                )
            )
        permissions = list(
            (
                await db.execute(
                    select(KnowledgeBaseMember.permission).where(
                        KnowledgeBaseMember.knowledge_base_id == knowledge_base.id,
                        or_(*principal_filters),
                    )
                )
            ).scalars()
        )
        if not permissions:
            raise PermissionError("insufficient knowledge-base permission")
        permission = max(permissions, key=lambda item: PERMISSION_RANK.get(item, 0))
        return permission, "membership"

    async def authorize_identity(
        self,
        db: AsyncSession,
        identity: RequestIdentity,
        knowledge_base_id: UUID | None,
        required_permission: str = "reader",
    ) -> KnowledgeBase:
        return await self.authorize(
            db,
            identity.tenant_id,
            identity.user_id,
            knowledge_base_id,
            required_permission,
            groups=identity.groups,
            is_admin=identity.is_admin,
        )

    async def list_accessible_identity(
        self,
        db: AsyncSession,
        identity: RequestIdentity,
        *,
        include_archived: bool = False,
    ) -> list[KnowledgeBase]:
        return await self.list_accessible(
            db,
            identity.tenant_id,
            identity.user_id,
            groups=identity.groups,
            is_admin=identity.is_admin,
            include_archived=include_archived,
        )

    async def get_or_create_default(
        self, db: AsyncSession, tenant_id: str, user_id: str
    ) -> KnowledgeBase:
        await db.execute(
            insert(KnowledgeBase)
            .values(
                id=uuid4(),
                tenant_id=tenant_id,
                slug="default",
                name="默认知识库",
                description="租户默认知识库",
                access_mode="tenant",
                status="active",
                is_default=True,
                created_by=user_id,
            )
            .on_conflict_do_nothing(index_elements=["tenant_id", "slug"])
        )
        knowledge_base = await db.scalar(
            select(KnowledgeBase).where(
                KnowledgeBase.tenant_id == tenant_id,
                KnowledgeBase.slug == "default",
            )
        )
        if knowledge_base is None:
            raise RuntimeError("failed to initialize default knowledge base")
        return knowledge_base

    async def authorize(
        self,
        db: AsyncSession,
        tenant_id: str,
        user_id: str,
        knowledge_base_id: UUID | None,
        required_permission: str = "reader",
        *,
        groups: frozenset[str] | None = None,
        is_admin: bool | None = None,
    ) -> KnowledgeBase:
        knowledge_base = (
            await self.get_or_create_default(db, tenant_id, user_id)
            if knowledge_base_id is None
            else await db.get(KnowledgeBase, knowledge_base_id)
        )
        if (
            knowledge_base is None
            or knowledge_base.tenant_id != tenant_id
            or knowledge_base.status != "active"
        ):
            raise LookupError("knowledge base not found")

        if is_admin is True or (is_admin is None and user_id in get_settings().admin_user_ids):
            return knowledge_base
        if knowledge_base.access_mode == "tenant" and required_permission != "owner":
            return knowledge_base

        principal_filters = [
            and_(
                KnowledgeBaseMember.principal_type == "user",
                KnowledgeBaseMember.principal_id == user_id,
            )
        ]
        if groups:
            principal_filters.append(
                and_(
                    KnowledgeBaseMember.principal_type == "group",
                    KnowledgeBaseMember.principal_id.in_(groups),
                )
            )
        permissions = (
            await db.execute(
                select(KnowledgeBaseMember.permission).where(
                    KnowledgeBaseMember.knowledge_base_id == knowledge_base.id,
                    or_(*principal_filters),
                )
            )
        ).scalars()
        permission_rank = max((PERMISSION_RANK.get(item, 0) for item in permissions), default=0)
        if (
            required_permission == "owner"
            and knowledge_base.created_by == user_id
            and permission_rank == 0
        ):
            return knowledge_base
        if permission_rank < PERMISSION_RANK[required_permission]:
            raise PermissionError("insufficient knowledge-base permission")
        return knowledge_base

    async def list_accessible(
        self,
        db: AsyncSession,
        tenant_id: str,
        user_id: str,
        *,
        groups: frozenset[str] | None = None,
        is_admin: bool | None = None,
        include_archived: bool = False,
    ) -> list[KnowledgeBase]:
        await self.get_or_create_default(db, tenant_id, user_id)
        statuses = ["active", "archived"] if include_archived else ["active"]
        if is_admin is True or (is_admin is None and user_id in get_settings().admin_user_ids):
            result = await db.execute(
                select(KnowledgeBase)
                .where(
                    KnowledgeBase.tenant_id == tenant_id,
                    KnowledgeBase.status.in_(statuses),
                )
                .order_by(KnowledgeBase.is_default.desc(), KnowledgeBase.name.asc())
            )
            return list(result.scalars())

        principal_filters = [
            and_(
                KnowledgeBaseMember.principal_type == "user",
                KnowledgeBaseMember.principal_id == user_id,
            )
        ]
        if groups:
            principal_filters.append(
                and_(
                    KnowledgeBaseMember.principal_type == "group",
                    KnowledgeBaseMember.principal_id.in_(groups),
                )
            )
        membership = exists().where(
            KnowledgeBaseMember.knowledge_base_id == KnowledgeBase.id,
            or_(*principal_filters),
        )
        owner_membership = exists().where(
            KnowledgeBaseMember.knowledge_base_id == KnowledgeBase.id,
            KnowledgeBaseMember.permission == "owner",
            or_(*principal_filters),
        )
        visibility = and_(
            KnowledgeBase.status == "active",
            or_(KnowledgeBase.access_mode == "tenant", membership),
        )
        if include_archived:
            visibility = or_(
                visibility,
                and_(
                    KnowledgeBase.status == "archived",
                    or_(KnowledgeBase.created_by == user_id, owner_membership),
                ),
            )
        result = await db.execute(
            select(KnowledgeBase)
            .where(
                KnowledgeBase.tenant_id == tenant_id,
                visibility,
            )
            .order_by(KnowledgeBase.is_default.desc(), KnowledgeBase.name.asc())
        )
        return list(result.scalars())


knowledge_base_service = KnowledgeBaseService()
