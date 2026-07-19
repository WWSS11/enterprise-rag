from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.models import ChatMessage, Conversation
from app.services.redis_service import redis_service


class ConversationService:
    async def get_or_create(
        self,
        db: AsyncSession,
        conversation_id: UUID | None,
        tenant_id: str,
        user_id: str,
        knowledge_base_id: UUID,
        question: str,
    ) -> Conversation:
        conversation = await db.get(Conversation, conversation_id) if conversation_id else None
        if conversation_id is not None and conversation is None:
            raise LookupError("conversation not found")
        if conversation is not None:
            if conversation.tenant_id != tenant_id or conversation.user_id != user_id:
                raise PermissionError("conversation does not belong to current tenant/user")
            if conversation.knowledge_base_id != knowledge_base_id:
                raise ValueError("a conversation cannot switch knowledge bases")
            if conversation.status != "active":
                raise ValueError("an archived conversation cannot accept new messages")
            return conversation

        conversation = Conversation(
            tenant_id=tenant_id,
            user_id=user_id,
            knowledge_base_id=knowledge_base_id,
            title=question[:80],
        )
        db.add(conversation)
        await db.flush()
        return conversation

    async def _history_from_db(
        self, db: AsyncSession, conversation_id: UUID
    ) -> list[dict[str, str]]:
        limit = get_settings().conversation_history_messages
        result = await db.execute(
            select(ChatMessage)
            .where(ChatMessage.conversation_id == conversation_id)
            .order_by(ChatMessage.created_at.desc())
            .limit(limit)
        )
        messages = list(result.scalars())
        messages.reverse()
        return [{"role": message.role, "content": message.content} for message in messages]

    async def history(self, db: AsyncSession, conversation_id: UUID) -> list[dict[str, str]]:
        cached = await redis_service.get_cached_history(str(conversation_id))
        if cached is not None:
            return cached

        history = await self._history_from_db(db, conversation_id)
        await redis_service.cache_history(str(conversation_id), history)
        return history

    async def append_exchange(
        self,
        db: AsyncSession,
        conversation: Conversation,
        question: str,
        answer: str,
        citations: list[dict[str, object]],
    ) -> None:
        now = datetime.now(UTC)
        conversation.updated_at = now
        db.add_all(
            [
                ChatMessage(
                    conversation_id=conversation.id,
                    role="user",
                    content=question,
                    created_at=now,
                ),
                ChatMessage(
                    conversation_id=conversation.id,
                    role="assistant",
                    content=answer,
                    citations=citations,
                    created_at=now + timedelta(microseconds=1),
                ),
            ]
        )
        await db.commit()
        history = await self._history_from_db(db, conversation.id)
        await redis_service.cache_history(str(conversation.id), history)


conversation_service = ConversationService()
