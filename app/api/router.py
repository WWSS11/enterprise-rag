from fastapi import APIRouter

from app.api.v1 import (
    audit_logs,
    auth,
    chat,
    conversations,
    documents,
    evaluations,
    health,
    jobs,
    knowledge_bases,
)

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(chat.router, prefix="/chat", tags=["chat"])
api_router.include_router(
    conversations.router, prefix="/conversations", tags=["conversations"]
)
api_router.include_router(documents.router, prefix="/documents", tags=["documents"])
api_router.include_router(jobs.router, prefix="/jobs", tags=["jobs"])
api_router.include_router(evaluations.router, prefix="/evaluations", tags=["evaluations"])
api_router.include_router(
    knowledge_bases.router, prefix="/knowledge-bases", tags=["knowledge-bases"]
)
api_router.include_router(audit_logs.router, prefix="/audit-logs", tags=["audit"])
