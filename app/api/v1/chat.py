import asyncio
from dataclasses import dataclass
from typing import Any

import orjson
import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import request_identity
from app.db.models import Conversation
from app.db.session import get_db
from app.rag.graph import get_rag_graph
from app.schemas.chat import ChatRequest, ChatResponse
from app.security.identity import RequestIdentity
from app.services.audit_service import record_audit
from app.services.conversation_service import conversation_service
from app.services.knowledge_base_service import knowledge_base_service
from app.services.model_provider import validate_rag_configuration
from app.services.redis_service import redis_service

router = APIRouter()
logger = structlog.get_logger(__name__)


@dataclass(slots=True)
class ChatContext:
    conversation: Conversation
    history: list[dict[str, str]]


def _sse(event: str, data: Any) -> str:
    payload = data if isinstance(data, str) else orjson.dumps(data).decode()
    return f"event: {event}\ndata: {payload}\n\n"


async def _prepare_chat(
    request: ChatRequest,
    db: AsyncSession,
    identity: RequestIdentity,
) -> ChatContext:
    tenant_id = identity.tenant_id
    user_id = identity.user_id
    decision = await redis_service.allow_chat_request(tenant_id, user_id)
    if not decision.allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="rate limit exceeded",
            headers={
                "Retry-After": str(max(1, decision.retry_after)),
                "X-RateLimit-User-Remaining": str(decision.user_remaining),
                "X-RateLimit-Tenant-Remaining": str(decision.tenant_remaining),
            },
        )

    try:
        knowledge_base = await knowledge_base_service.authorize_identity(
            db, identity, request.knowledge_base_id, required_permission="reader"
        )
        conversation = await conversation_service.get_or_create(
            db,
            request.conversation_id,
            tenant_id,
            user_id,
            knowledge_base.id,
            request.question,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return ChatContext(
        conversation=conversation,
        history=await conversation_service.history(db, conversation.id),
    )


def _graph_input(
    request: ChatRequest, tenant_id: str, user_id: str, context: ChatContext
) -> dict[str, Any]:
    return {
        "question": request.question,
        "tenant_id": tenant_id,
        "knowledge_base_id": str(context.conversation.knowledge_base_id),
        "user_id": user_id,
        "history": context.history,
    }


async def _run_chat(
    request: ChatRequest,
    db: AsyncSession,
    identity: RequestIdentity,
) -> ChatResponse:
    tenant_id = identity.tenant_id
    user_id = identity.user_id
    try:
        validate_rag_configuration()
        context = await _prepare_chat(request, db, identity)
        result = await get_rag_graph().ainvoke(_graph_input(request, tenant_id, user_id, context))
    except HTTPException:
        await db.rollback()
        raise
    except Exception as exc:
        await db.rollback()
        await logger.aexception("chat_request_failed")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="RAG model service is temporarily unavailable",
        ) from exc

    citations = result.get("citations", [])
    record_audit(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="chat.completed",
        resource_type="conversation",
        resource_id=str(context.conversation.id),
        details={
            "knowledge_base_id": str(context.conversation.knowledge_base_id),
            "retrieved_count": len(result.get("retrieved", [])),
            "reranked_count": len(result.get("reranked", [])),
            "citation_diagnostics": result.get("citation_diagnostics", {}),
        },
    )
    await conversation_service.append_exchange(
        db, context.conversation, request.question, result["answer"], citations
    )
    return ChatResponse(
        conversation_id=context.conversation.id,
        answer=result["answer"],
        rewritten_query=result.get("rewritten_query", request.question),
        citations=citations,
        metadata={
            "retrieved_count": len(result.get("retrieved", [])),
            "reranked_count": len(result.get("reranked", [])),
            "citation_diagnostics": result.get("citation_diagnostics", {}),
        },
    )


@router.post("", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> ChatResponse:
    return await _run_chat(request, db, identity)


@router.post("/stream")
async def chat_stream(
    request: ChatRequest,
    identity: RequestIdentity = Depends(request_identity),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    tenant_id = identity.tenant_id
    user_id = identity.user_id
    try:
        validate_rag_configuration()
        context = await _prepare_chat(request, db, identity)
    except RuntimeError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc

    async def events():
        final_state: dict[str, Any] = {}
        answer_parts: list[str] = []
        yield _sse("metadata", {"conversation_id": str(context.conversation.id)})
        try:
            async for mode, payload in get_rag_graph().astream(
                _graph_input(request, tenant_id, user_id, context),
                stream_mode=["custom", "updates"],
            ):
                if mode == "custom" and payload.get("type") == "token":
                    token = str(payload.get("token", ""))
                    if token:
                        answer_parts.append(token)
                        yield _sse("token", {"token": token})
                        await asyncio.sleep(0)
                    continue
                if mode != "updates":
                    continue
                for node_name, update in payload.items():
                    if isinstance(update, dict):
                        final_state.update(update)
                    if node_name != "generate":
                        yield _sse("stage", {"name": node_name, "status": "completed"})

            answer = str(final_state.get("answer", "")) or "".join(answer_parts)
            citations = final_state.get("citations", [])
            record_audit(
                db,
                tenant_id=tenant_id,
                user_id=user_id,
                action="chat.stream_completed",
                resource_type="conversation",
                resource_id=str(context.conversation.id),
                details={
                    "knowledge_base_id": str(context.conversation.knowledge_base_id),
                    "retrieved_count": len(final_state.get("retrieved", [])),
                    "reranked_count": len(final_state.get("reranked", [])),
                    "citation_diagnostics": final_state.get("citation_diagnostics", {}),
                },
            )
            await conversation_service.append_exchange(
                db, context.conversation, request.question, answer, citations
            )
            yield _sse(
                "metadata",
                {
                    "conversation_id": str(context.conversation.id),
                    "rewritten_query": final_state.get("rewritten_query", request.question),
                    "citations": citations,
                    "retrieved_count": len(final_state.get("retrieved", [])),
                    "reranked_count": len(final_state.get("reranked", [])),
                    "citation_diagnostics": final_state.get("citation_diagnostics", {}),
                },
            )
            yield _sse("done", {"status": "completed"})
        except asyncio.CancelledError:
            await db.rollback()
            await logger.ainfo(
                "chat_stream_disconnected", conversation_id=str(context.conversation.id)
            )
            raise
        except Exception:
            await db.rollback()
            await logger.aexception(
                "chat_stream_failed", conversation_id=str(context.conversation.id)
            )
            yield _sse(
                "error",
                {
                    "code": "rag_stream_failed",
                    "message": "RAG model service is temporarily unavailable",
                },
            )

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
