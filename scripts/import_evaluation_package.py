from __future__ import annotations

import argparse
import json
import mimetypes
import os
import time
from pathlib import Path
from typing import Any

import httpx

from app.schemas.evaluation_package import EvaluationPackage
from app.services.evaluation_package_service import (
    load_evaluation_package,
    require_t13_business_baseline,
    summarize_evaluation_package,
    validate_evaluation_package_sources,
)

TERMINAL_STATUSES = {"succeeded", "failed"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Validate or import a T13 business evaluation package. "
            "Without --apply this command never calls the API."
        )
    )
    parser.add_argument("package", type=Path, help="Path to the evaluation package JSON")
    parser.add_argument(
        "--repository-root",
        type=Path,
        default=Path.cwd(),
        help="Root used to resolve document source_path values",
    )
    parser.add_argument(
        "--api-base-url",
        default=os.getenv("T13_API_BASE_URL", "http://127.0.0.1:8000"),
        help="Target API base URL (or set T13_API_BASE_URL)",
    )
    parser.add_argument(
        "--token-env",
        default="T13_ACCESS_TOKEN",
        help="Environment variable holding a short-lived bearer token",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Create the knowledge base, upload documents, and create the dataset",
    )
    parser.add_argument(
        "--start-run",
        action="store_true",
        help="Start the first baseline run after import (requires --apply)",
    )
    parser.add_argument(
        "--poll-timeout",
        type=float,
        default=900.0,
        help="Maximum seconds to wait for each ingestion job or evaluation run",
    )
    return parser.parse_args()


def build_case_payloads(
    package: EvaluationPackage,
    document_ids_by_name: dict[str, str],
) -> list[dict[str, Any]]:
    payloads: list[dict[str, Any]] = []
    for case in package.cases:
        payloads.append(
            {
                "question": case.question,
                "reference_answer": case.reference_answer,
                "expected_document_ids": [
                    document_ids_by_name[name] for name in case.expected_document_names
                ],
                "acceptable_citation_document_ids": [
                    document_ids_by_name[name]
                    for name in case.acceptable_citation_document_names or []
                ],
                "required_key_points": case.required_key_points,
                "required_key_point_groups": case.required_key_point_groups,
                "should_refuse": case.should_refuse,
                "tags": case.tags,
            }
        )
    return payloads


class EvaluationPackageImporter:
    def __init__(self, *, base_url: str, token: str, poll_timeout: float) -> None:
        self.client = httpx.Client(
            base_url=base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {token}"},
            timeout=httpx.Timeout(60.0),
        )
        self.poll_timeout = poll_timeout

    def __enter__(self) -> EvaluationPackageImporter:
        return self

    def __exit__(self, *_args: object) -> None:
        self.client.close()

    def request_json(
        self,
        method: str,
        path: str,
        *,
        expected_status: int,
        **kwargs: Any,
    ) -> dict[str, Any]:
        response = self.client.request(method, path, **kwargs)
        if response.status_code != expected_status:
            raise RuntimeError(
                f"API {method} {path} returned HTTP {response.status_code}; "
                "inspect the API audit log for details"
            )
        payload = response.json()
        if not isinstance(payload, dict):
            raise RuntimeError(f"API {method} {path} returned an unexpected response")
        return payload

    def wait_for_job(self, job_id: str) -> None:
        deadline = time.monotonic() + self.poll_timeout
        while time.monotonic() < deadline:
            job = self.request_json("GET", f"/api/v1/jobs/{job_id}", expected_status=200)
            status = str(job.get("status", "unknown"))
            if status in TERMINAL_STATUSES:
                if status != "succeeded":
                    raise RuntimeError(f"ingestion job {job_id} failed")
                return
            time.sleep(1.0)
        raise TimeoutError(f"ingestion job {job_id} did not finish before timeout")

    def wait_for_run(self, run_id: str) -> dict[str, Any]:
        deadline = time.monotonic() + self.poll_timeout
        while time.monotonic() < deadline:
            run = self.request_json(
                "GET", f"/api/v1/evaluations/runs/{run_id}", expected_status=200
            )
            status = str(run.get("status", "unknown"))
            if status in TERMINAL_STATUSES:
                if status != "succeeded":
                    raise RuntimeError(f"evaluation run {run_id} failed")
                return run
            time.sleep(2.5)
        raise TimeoutError(f"evaluation run {run_id} did not finish before timeout")

    def import_package(
        self,
        package: EvaluationPackage,
        *,
        repository_root: Path,
        start_run: bool,
    ) -> dict[str, Any]:
        knowledge_base = self.request_json(
            "POST",
            "/api/v1/knowledge-bases",
            expected_status=201,
            json=package.knowledge_base.model_dump(mode="json"),
        )
        knowledge_base_id = str(knowledge_base["id"])
        document_ids_by_name: dict[str, str] = {}

        for document in package.documents:
            source_path = (repository_root / document.source_path).resolve()
            media_type = mimetypes.guess_type(document.upload_name)[0] or "application/octet-stream"
            with source_path.open("rb") as source:
                accepted = self.request_json(
                    "POST",
                    "/api/v1/documents",
                    expected_status=202,
                    data={"knowledge_base_id": knowledge_base_id},
                    files={"file": (document.upload_name, source, media_type)},
                )
            uploaded = accepted.get("document")
            if not isinstance(uploaded, dict) or "id" not in uploaded or "job_id" not in accepted:
                raise RuntimeError("document upload returned an unexpected response")
            document_ids_by_name[document.upload_name] = str(uploaded["id"])
            self.wait_for_job(str(accepted["job_id"]))

        dataset = self.request_json(
            "POST",
            "/api/v1/evaluations/datasets",
            expected_status=201,
            json={
                "knowledge_base_id": knowledge_base_id,
                "name": package.name,
                "description": package.description,
            },
        )
        dataset_id = str(dataset["id"])
        cases = build_case_payloads(package, document_ids_by_name)
        bulk_response = self.client.post(
            f"/api/v1/evaluations/datasets/{dataset_id}/cases/bulk",
            json={"cases": cases},
        )
        if bulk_response.status_code != 201:
            raise RuntimeError(
                "API POST evaluation cases bulk endpoint returned "
                f"HTTP {bulk_response.status_code}; inspect the API audit log for details"
            )

        result: dict[str, Any] = {
            "knowledge_base_id": knowledge_base_id,
            "dataset_id": dataset_id,
            "document_count": len(document_ids_by_name),
            "case_count": len(cases),
        }
        if start_run:
            run = self.request_json(
                "POST",
                "/api/v1/evaluations/runs",
                expected_status=202,
                json={"dataset_id": dataset_id},
            )
            run_id = str(run["id"])
            completed = self.wait_for_run(run_id)
            result["baseline_run_id"] = run_id
            result["baseline_summary"] = completed.get("summary", {})
        return result


def main() -> int:
    args = parse_args()
    if args.start_run and not args.apply:
        raise SystemExit("--start-run requires --apply")
    if args.poll_timeout <= 0:
        raise SystemExit("--poll-timeout must be positive")

    package = load_evaluation_package(args.package)
    repository_root = args.repository_root.resolve()
    validate_evaluation_package_sources(package, repository_root=repository_root)
    require_t13_business_baseline(package)
    summary = summarize_evaluation_package(package)
    if not args.apply:
        print(
            json.dumps(
                {
                    **summary.__dict__,
                    "validated": True,
                    "applied": False,
                },
                ensure_ascii=False,
                sort_keys=True,
            )
        )
        return 0

    token = os.getenv(args.token_env, "").strip()
    if not token:
        raise SystemExit(f"{args.token_env} must contain a short-lived test access token")
    with EvaluationPackageImporter(
        base_url=args.api_base_url,
        token=token,
        poll_timeout=args.poll_timeout,
    ) as importer:
        result = importer.import_package(
            package,
            repository_root=repository_root,
            start_run=args.start_run,
        )
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
