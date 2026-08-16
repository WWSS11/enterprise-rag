from __future__ import annotations

import argparse
import asyncio
import json
from dataclasses import asdict, dataclass
from urllib.parse import urlsplit

import httpx


@dataclass(frozen=True, slots=True)
class Check:
    name: str
    passed: bool
    evidence: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run non-destructive API DAST smoke checks")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    return parser.parse_args()


def validate_base_url(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise SystemExit("--base-url must be an absolute HTTP(S) URL")
    if parsed.username is not None or parsed.password is not None:
        raise SystemExit("--base-url must not contain credentials")
    return value.rstrip("/")


async def run(base_url: str) -> list[Check]:
    async with httpx.AsyncClient(base_url=base_url, timeout=10, follow_redirects=False) as client:
        live = await client.get("/health/live")
        evil_cors = await client.options(
            "/api/v1/auth/me",
            headers={
                "Origin": "https://attacker.invalid",
                "Access-Control-Request-Method": "GET",
            },
        )
        missing_auth = await client.get("/api/v1/auth/me")
        malformed_auth = await client.get(
            "/api/v1/auth/me",
            headers={"Authorization": "Bearer malformed"},
        )
        traversal = await client.get("/api/v1/documents/%2e%2e/%2e%2e/etc/passwd")
        trace = await client.request("TRACE", "/api/v1/auth/me")
        openapi = await client.get("/openapi.json")

    headers = live.headers
    openapi_text = openapi.text.casefold()
    secret_names = ("chat_api_key", "embedding_api_key", "rerank_api_key", "identity_header_secret")
    return [
        Check("liveness", live.status_code == 200, f"HTTP {live.status_code}"),
        Check(
            "security_headers",
            headers.get("x-content-type-options") == "nosniff"
            and headers.get("x-frame-options") == "DENY"
            and "frame-ancestors 'none'" in headers.get("content-security-policy", ""),
            "nosniff, DENY and frame-ancestors required",
        ),
        Check(
            "cors_origin_rejected",
            evil_cors.status_code == 400
            and "access-control-allow-origin" not in evil_cors.headers,
            f"HTTP {evil_cors.status_code}",
        ),
        Check(
            "authentication_required",
            missing_auth.status_code == 401,
            f"HTTP {missing_auth.status_code}",
        ),
        Check(
            "malformed_bearer_rejected",
            malformed_auth.status_code == 401,
            f"HTTP {malformed_auth.status_code}",
        ),
        Check(
            "path_traversal_not_routed",
            traversal.status_code in {404, 405, 422},
            f"HTTP {traversal.status_code}",
        ),
        Check("trace_disabled", trace.status_code == 405, f"HTTP {trace.status_code}"),
        Check(
            "openapi_has_no_secret_fields",
            openapi.status_code == 200 and not any(name in openapi_text for name in secret_names),
            f"HTTP {openapi.status_code}",
        ),
    ]


def main() -> None:
    base_url = validate_base_url(parse_args().base_url)
    checks = asyncio.run(run(base_url))
    payload = {
        "base_url": base_url,
        "passed": all(check.passed for check in checks),
        "checks": [asdict(check) for check in checks],
    }
    print(json.dumps(payload, ensure_ascii=False, sort_keys=True))
    if not payload["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
