from fastapi import APIRouter

from app.api.v1 import chat, documents, health, jobs, knowledge_bases

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(chat.router, prefix="/chat", tags=["chat"])
api_router.include_router(documents.router, prefix="/documents", tags=["documents"])
api_router.include_router(jobs.router, prefix="/jobs", tags=["jobs"])
api_router.include_router(
    knowledge_bases.router, prefix="/knowledge-bases", tags=["knowledge-bases"]
)
