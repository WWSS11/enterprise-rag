import re
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
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


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
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Accept",
        "Authorization",
        "Content-Type",
        "X-Identity-Secret",
        "X-Request-ID",
        "X-Tenant-ID",
        "X-User-ID",
    ],
    expose_headers=[
        "X-Request-ID",
        "X-RateLimit-Remaining",
        "X-RateLimit-Tenant-Remaining",
        "Retry-After",
    ],
)
app.middleware("http")(observe_request)
install_exception_handlers(app)


@app.middleware("http")
async def request_context(request: Request, call_next):
    supplied_request_id = request.headers.get("x-request-id", "")
    request_id = (
        supplied_request_id
        if REQUEST_ID_PATTERN.fullmatch(supplied_request_id)
        else str(uuid4())
    )
    request.state.request_id = request_id
    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(request_id=request_id, path=request.url.path)
    response = await call_next(request)
    response.headers["x-request-id"] = request_id
    if request.url.path in {"/docs", "/redoc"}:
        response.headers["Content-Security-Policy"] = (
            "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; "
            "form-action 'none'; connect-src 'self'; img-src data: https://fastapi.tiangolo.com; "
            "script-src https://cdn.jsdelivr.net; "
            "style-src https://cdn.jsdelivr.net 'unsafe-inline'"
        )
    else:
        response.headers["Content-Security-Policy"] = (
            "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
        )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = (
        "camera=(), geolocation=(), microphone=(), payment=(), usb=()"
    )
    if request.url.path.startswith(settings.api_v1_prefix):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


app.include_router(health_router)
app.include_router(metrics_router)
app.include_router(api_router, prefix=settings.api_v1_prefix)
