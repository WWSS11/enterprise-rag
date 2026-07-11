from uuid import UUID, uuid4

from sqlalchemy import exists, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.models import KnowledgeBase, KnowledgeBaseMember

PERMISSION_RANK = {"reader": 10, "editor": 20, "owner": 30}


class KnowledgeBaseService:
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

        if user_id in get_settings().admin_user_ids:
            return knowledge_base
        if knowledge_base.access_mode == "tenant" and required_permission != "owner":
            return knowledge_base

        permission = await db.scalar(
            select(KnowledgeBaseMember.permission).where(
                KnowledgeBaseMember.knowledge_base_id == knowledge_base.id,
                KnowledgeBaseMember.principal_type == "user",
                KnowledgeBaseMember.principal_id == user_id,
            )
        )
        if (
            required_permission == "owner"
            and knowledge_base.created_by == user_id
            and permission is None
        ):
            return knowledge_base
        if PERMISSION_RANK.get(permission or "", 0) < PERMISSION_RANK[required_permission]:
            raise PermissionError("insufficient knowledge-base permission")
        return knowledge_base

    async def list_accessible(
        self, db: AsyncSession, tenant_id: str, user_id: str
    ) -> list[KnowledgeBase]:
        await self.get_or_create_default(db, tenant_id, user_id)
        membership = exists().where(
            KnowledgeBaseMember.knowledge_base_id == KnowledgeBase.id,
            KnowledgeBaseMember.principal_type == "user",
            KnowledgeBaseMember.principal_id == user_id,
        )
        result = await db.execute(
            select(KnowledgeBase)
            .where(
                KnowledgeBase.tenant_id == tenant_id,
                KnowledgeBase.status == "active",
                or_(KnowledgeBase.access_mode == "tenant", membership),
            )
            .order_by(KnowledgeBase.is_default.desc(), KnowledgeBase.name.asc())
        )
        return list(result.scalars())


knowledge_base_service = KnowledgeBaseService()
