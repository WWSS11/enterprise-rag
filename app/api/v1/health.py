import asyncio

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.db.session import engine
from app.schemas.common import HealthResponse
from app.services.milvus_service import milvus_service
from app.services.redis_service import redis_service

router = APIRouter()
DEPENDENCY_CHECK_TIMEOUT_SECONDS = 5.0


@router.get("/health/live", response_model=HealthResponse)
async def liveness() -> HealthResponse:
    return HealthResponse(status="ok", service="rag-api", version="0.1.0")


@router.get("/health/ready", response_model=HealthResponse)
async def readiness() -> HealthResponse | JSONResponse:
    dependencies: dict[str, str] = {}

    async def check_postgres() -> None:
        async with engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
        dependencies["postgres"] = "ok"

    async def check_redis() -> None:
        dependencies["redis"] = "ok" if await redis_service.ping() else "error"

    async def check_milvus() -> None:
        dependencies["milvus"] = "ok" if await milvus_service.ping() else "error"

    results = await asyncio.gather(
        *(
            asyncio.wait_for(check(), timeout=DEPENDENCY_CHECK_TIMEOUT_SECONDS)
            for check in (check_postgres, check_redis, check_milvus)
        ),
        return_exceptions=True,
    )
    for name, result in zip(("postgres", "redis", "milvus"), results, strict=True):
        if isinstance(result, Exception):
            dependencies[name] = f"error: {type(result).__name__}"

    response = HealthResponse(
        status="ok" if all(value == "ok" for value in dependencies.values()) else "degraded",
        service="rag-api",
        version="0.1.0",
        dependencies=dependencies,
    )
    if response.status != "ok":
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content=response.model_dump(),
        )
    return response
