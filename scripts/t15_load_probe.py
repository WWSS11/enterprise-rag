from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
from collections import Counter
from dataclasses import dataclass
from time import perf_counter
from urllib.parse import urlsplit

import httpx


@dataclass(frozen=True, slots=True)
class Sample:
    status: int | None
    latency_ms: float
    response_bytes: int
    error: str | None = None


def percentile(values: list[float], quantile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = max(0, math.ceil(len(ordered) * quantile) - 1)
    return round(ordered[index], 3)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run bounded read-only T15 HTTP load probes")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--path", action="append", default=[])
    parser.add_argument("--requests", type=int, default=200)
    parser.add_argument("--concurrency", type=int, default=20)
    parser.add_argument("--token-env", default="T15_ACCESS_TOKEN")
    parser.add_argument("--timeout", type=float, default=10.0)
    return parser.parse_args()


def validate_args(args: argparse.Namespace) -> tuple[str, list[str]]:
    parsed = urlsplit(args.base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise SystemExit("--base-url must be an absolute HTTP(S) URL")
    if parsed.username is not None or parsed.password is not None:
        raise SystemExit("--base-url must not contain credentials")
    if not 1 <= args.requests <= 100_000:
        raise SystemExit("--requests must be between 1 and 100000")
    if not 1 <= args.concurrency <= 1_000:
        raise SystemExit("--concurrency must be between 1 and 1000")
    if not 0.1 <= args.timeout <= 120:
        raise SystemExit("--timeout must be between 0.1 and 120 seconds")
    paths = args.path or ["/health/live", "/health/ready"]
    if any(not path.startswith("/") or path.startswith("//") for path in paths):
        raise SystemExit("every --path must be an absolute-path reference")
    return args.base_url.rstrip("/"), paths


async def probe_path(
    client: httpx.AsyncClient,
    path: str,
    *,
    request_count: int,
    concurrency: int,
) -> tuple[list[Sample], float]:
    queue: asyncio.Queue[int] = asyncio.Queue()
    for index in range(request_count):
        queue.put_nowait(index)
    samples: list[Sample] = []

    async def worker() -> None:
        while not queue.empty():
            try:
                queue.get_nowait()
            except asyncio.QueueEmpty:
                return
            started = perf_counter()
            try:
                response = await client.get(path)
                samples.append(
                    Sample(
                        status=response.status_code,
                        latency_ms=(perf_counter() - started) * 1_000,
                        response_bytes=len(response.content),
                    )
                )
            except httpx.HTTPError as exc:
                samples.append(
                    Sample(
                        status=None,
                        latency_ms=(perf_counter() - started) * 1_000,
                        response_bytes=0,
                        error=type(exc).__name__,
                    )
                )
            finally:
                queue.task_done()

    started = perf_counter()
    await asyncio.gather(*(worker() for _ in range(min(concurrency, request_count))))
    return samples, perf_counter() - started


async def run(args: argparse.Namespace) -> dict[str, object]:
    base_url, paths = validate_args(args)
    token = os.getenv(args.token_env, "").strip()
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    limits = httpx.Limits(
        max_connections=args.concurrency,
        max_keepalive_connections=args.concurrency,
    )
    reports: dict[str, object] = {}
    async with httpx.AsyncClient(
        base_url=base_url,
        headers=headers,
        timeout=args.timeout,
        limits=limits,
        follow_redirects=False,
    ) as client:
        for path in paths:
            samples, elapsed = await probe_path(
                client,
                path,
                request_count=args.requests,
                concurrency=args.concurrency,
            )
            latencies = [sample.latency_ms for sample in samples]
            successes = sum(
                sample.status is not None and 200 <= sample.status < 400 for sample in samples
            )
            reports[path] = {
                "requests": len(samples),
                "concurrency": args.concurrency,
                "elapsed_seconds": round(elapsed, 3),
                "throughput_rps": round(len(samples) / elapsed, 3) if elapsed else 0.0,
                "success_rate": round(successes / len(samples), 6) if samples else 0.0,
                "error_rate": round((len(samples) - successes) / len(samples), 6)
                if samples
                else 0.0,
                "latency_ms": {
                    "p50": percentile(latencies, 0.50),
                    "p95": percentile(latencies, 0.95),
                    "p99": percentile(latencies, 0.99),
                    "max": round(max(latencies), 3) if latencies else 0.0,
                },
                "status_counts": dict(
                    sorted(Counter(str(sample.status) for sample in samples).items())
                ),
                "response_bytes_max": max(
                    (sample.response_bytes for sample in samples), default=0
                ),
                "errors": dict(
                    sorted(Counter(sample.error for sample in samples if sample.error).items())
                ),
            }
    return {
        "base_url": base_url,
        "authenticated": bool(token),
        "reports": reports,
    }


def main() -> None:
    args = parse_args()
    payload = asyncio.run(run(args))
    print(json.dumps(payload, ensure_ascii=False, sort_keys=True))
    reports = payload["reports"]
    if not isinstance(reports, dict):
        raise RuntimeError("load probe produced an invalid report")
    failed = any(
        float(report.get("error_rate", 1)) > 0
        for report in reports.values()
        if isinstance(report, dict)
    )
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
