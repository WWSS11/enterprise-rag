from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from uuid import uuid4

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.api.v1.health import router as health_router
from app.core.config import get_settings
from app.core.errors import install_exception_handlers
from app.core.logging import configure_logging
from app.core.metrics import observe_request
from app.core.metrics import router as metrics_router
from app.db.session import engine
from app.services.redis_service import redis_service

settings = get_settings()
configure_logging(settings.log_level)
logger = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    settings.connector_dir.mkdir(parents=True, exist_ok=True)
    for root in settings.scan_roots.values():
        root.mkdir(parents=True, exist_ok=True)
    await logger.ainfo("application_started", environment=settings.env)
    yield
    await redis_service.close()
    await engine.dispose()
    await logger.ainfo("application_stopped")


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="Enterprise RAG API with explicit LangGraph workflow and async ingestion.",
    debug=settings.debug,
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.middleware("http")(observe_request)
install_exception_handlers(app)


@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id = request.headers.get("x-request-id", str(uuid4()))
    request.state.request_id = request_id
    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(request_id=request_id, path=request.url.path)
    response = await call_next(request)
    response.headers["x-request-id"] = request_id
    return response


app.include_router(health_router)
app.include_router(metrics_router)
app.include_router(api_router, prefix=settings.api_v1_prefix)
