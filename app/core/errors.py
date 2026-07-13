from collections.abc import Sequence
from http import HTTPStatus
from typing import Any

import orjson
import structlog
from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import Response

logger = structlog.get_logger(__name__)


def _problem(
    request: Request,
    status_code: int,
    detail: str,
    *,
    problem_type: str = "about:blank",
    errors: Sequence[Any] | None = None,
) -> dict[str, Any]:
    try:
        title = HTTPStatus(status_code).phrase
    except ValueError:
        title = "Error"
    payload: dict[str, Any] = {
        "type": problem_type,
        "title": title,
        "status": status_code,
        "detail": detail,
        "instance": request.url.path,
        "request_id": getattr(request.state, "request_id", None),
    }
    if errors:
        payload["errors"] = errors
    return payload


def install_exception_handlers(app: FastAPI) -> None:
    def response(payload: dict[str, Any], status_code: int, headers=None) -> Response:
        return Response(
            content=orjson.dumps(jsonable_encoder(payload)),
            status_code=status_code,
            headers=headers,
            media_type="application/problem+json",
        )

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException) -> Response:
        detail = exc.detail if isinstance(exc.detail, str) else "request rejected"
        payload = _problem(request, exc.status_code, detail)
        if not isinstance(exc.detail, str):
            payload["data"] = exc.detail
        return response(
            payload,
            exc.status_code,
            exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        request: Request, exc: RequestValidationError
    ) -> Response:
        return response(
            _problem(
                request,
                422,
                "request validation failed",
                problem_type="urn:rag-study-helper:validation-error",
                errors=exc.errors(),
            ),
            422,
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> Response:
        await logger.aexception("unhandled_request_exception", path=request.url.path)
        return response(
            _problem(
                request,
                500,
                "an unexpected server error occurred",
                problem_type="urn:rag-study-helper:internal-error",
            ),
            500,
        )
