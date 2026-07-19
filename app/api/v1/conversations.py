from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import request_identity
from app.db.models import ChatMessage, Conversation
from app.db.session import get_db
from app.schemas.conversation import (
    ChatMessagePage,
    ConversationPage,
    ConversationRead,
    ConversationUpdate,
)
from app.security.identity import RequestIdentity
from app.services.audit_service import record_audit
from app.services.knowledge_base_service import knowledge_base_service

router = APIRouter()


def _message_window(
    *, total: int, limit: int, offset: int, from_latest: bool
) -> tuple[int, int]:
    if not from_latest:
        return offset, limit
    page_end = max(total - offset, 0)
    query_offset = max(page_end - limit, 0)
    return query_offset, page_end - query_offset


async def _owned_conversation(
    db: AsyncSession, conversation_id: UUID, identity: RequestIdentity
) -> Conversation:
    conversation = await db.get(Conversation, conversation_id)
    if (
        conversation is None
        or conversation.tenant_id != identity.tenant_id
        or conversation.user_id != identity.user_id
    ):
        raise HTTPException(status_code=404, detail="conversation not found")
    try:
        await knowledge_base_service.authorize_identity(
            db, identity, conversation.knowledge_base_id
        )
    except (LookupError, PermissionError) as exc:
        raise HTTPException(status_code=404, detail="conversation not found") from exc
    return conversation


@router.get("", response_model=ConversationPage)
async def list_conversations(
    knowledge_base_id: UUID | None = None,
    conversation_status: str | None = Query(default="active", alias="status", max_length=32),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> ConversationPage:
    conditions = [
        Conversation.tenant_id == identity.tenant_id,
        Conversation.user_id == identity.user_id,
    ]
    if conversation_status:
        conditions.append(Conversation.status == conversation_status)
    if knowledge_base_id is not None:
        try:
            knowledge_base = await knowledge_base_service.authorize_identity(
                db, identity, knowledge_base_id
            )
        except (LookupError, PermissionError) as exc:
            raise HTTPException(status_code=404, detail="knowledge base not found") from exc
        conditions.append(Conversation.knowledge_base_id == knowledge_base.id)
    else:
        accessible = await knowledge_base_service.list_accessible_identity(db, identity)
        conditions.append(Conversation.knowledge_base_id.in_([item.id for item in accessible]))

    total = int(
        await db.scalar(select(func.count()).select_from(Conversation).where(*conditions)) or 0
    )
    items = list(
        (
            await db.execute(
                select(Conversation)
                .where(*conditions)
                .order_by(Conversation.updated_at.desc(), Conversation.id.desc())
                .limit(limit)
                .offset(offset)
            )
        ).scalars()
    )
    await db.commit()
    return ConversationPage(items=items, total=total, limit=limit, offset=offset)


@router.patch("/{conversation_id}", response_model=ConversationRead)
async def update_conversation(
    conversation_id: UUID,
    payload: ConversationUpdate,
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> Conversation:
    conversation = await _owned_conversation(db, conversation_id, identity)
    conversation.title = payload.title
    record_audit(
        db,
        tenant_id=identity.tenant_id,
        user_id=identity.user_id,
        action="conversations.updated",
        resource_type="conversation",
        resource_id=str(conversation.id),
        details={"fields": ["title"]},
    )
    await db.commit()
    await db.refresh(conversation)
    return conversation


@router.post("/{conversation_id}/archive", response_model=ConversationRead)
async def archive_conversation(
    conversation_id: UUID,
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> Conversation:
    conversation = await _owned_conversation(db, conversation_id, identity)
    if conversation.status != "active":
        raise HTTPException(status_code=409, detail="conversation is not active")
    conversation.status = "archived"
    record_audit(
        db,
        tenant_id=identity.tenant_id,
        user_id=identity.user_id,
        action="conversations.archived",
        resource_type="conversation",
        resource_id=str(conversation.id),
    )
    await db.commit()
    await db.refresh(conversation)
    return conversation


@router.post("/{conversation_id}/restore", response_model=ConversationRead)
async def restore_conversation(
    conversation_id: UUID,
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> Conversation:
    conversation = await _owned_conversation(db, conversation_id, identity)
    if conversation.status != "archived":
        raise HTTPException(status_code=409, detail="conversation is not archived")
    conversation.status = "active"
    record_audit(
        db,
        tenant_id=identity.tenant_id,
        user_id=identity.user_id,
        action="conversations.restored",
        resource_type="conversation",
        resource_id=str(conversation.id),
    )
    await db.commit()
    await db.refresh(conversation)
    return conversation


@router.get("/{conversation_id}/messages", response_model=ChatMessagePage)
async def list_conversation_messages(
    conversation_id: UUID,
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    from_latest: bool = Query(default=True),
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> ChatMessagePage:
    await _owned_conversation(db, conversation_id, identity)
    conditions = [ChatMessage.conversation_id == conversation_id]
    total = int(
        await db.scalar(select(func.count()).select_from(ChatMessage).where(*conditions)) or 0
    )
    query_offset, query_limit = _message_window(
        total=total,
        limit=limit,
        offset=offset,
        from_latest=from_latest,
    )
    items = list(
        (
            await db.execute(
                select(ChatMessage)
                .where(*conditions)
                .order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc())
                .limit(query_limit)
                .offset(query_offset)
            )
        ).scalars()
    )
    return ChatMessagePage(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        has_more=offset + len(items) < total,
    )
