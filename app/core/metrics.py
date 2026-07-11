from time import perf_counter

from fastapi import APIRouter, Request, Response
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest

HTTP_REQUESTS = Counter(
    "rag_http_requests_total",
    "Total HTTP requests",
    ["method", "route", "status"],
)
HTTP_LATENCY = Histogram(
    "rag_http_request_duration_seconds",
    "HTTP request latency",
    ["method", "route"],
)

router = APIRouter()


async def observe_request(request: Request, call_next):
    started = perf_counter()
    status_code = 500
    try:
        response = await call_next(request)
        status_code = response.status_code
        return response
    finally:
        route = request.scope.get("route")
        route_path = getattr(route, "path", request.url.path)
        HTTP_REQUESTS.labels(request.method, route_path, str(status_code)).inc()
        HTTP_LATENCY.labels(request.method, route_path).observe(perf_counter() - started)


@router.get("/metrics", include_in_schema=False)
async def metrics() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
