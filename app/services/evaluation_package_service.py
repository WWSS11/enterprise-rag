from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path

from app.schemas.evaluation_package import EvaluationPackage


@dataclass(frozen=True)
class EvaluationPackageSummary:
    name: str
    profile: str
    document_count: int
    case_count: int
    answerable_count: int
    refusal_count: int


def load_evaluation_package(path: Path) -> EvaluationPackage:
    return EvaluationPackage.model_validate_json(path.read_text(encoding="utf-8"))


def validate_evaluation_package_sources(
    package: EvaluationPackage,
    *,
    repository_root: Path,
) -> None:
    root = repository_root.resolve()
    for document in package.documents:
        source_path = (root / document.source_path).resolve()
        if not source_path.is_relative_to(root):
            raise ValueError(f"document source escapes repository root: {document.source_path}")
        if not source_path.is_file():
            raise ValueError(f"document source does not exist: {document.source_path}")
        if document.sha256:
            digest = hashlib.sha256(source_path.read_bytes()).hexdigest()
            if digest != document.sha256:
                raise ValueError(f"document checksum mismatch: {document.source_path}")


def require_t13_business_baseline(package: EvaluationPackage) -> None:
    if package.profile != "business-baseline":
        raise ValueError("T13 requires a business-baseline evaluation package")
    if not 10 <= len(package.documents) <= 50:
        raise ValueError("T13 requires 10 to 50 documents")
    if not 20 <= len(package.cases) <= 50:
        raise ValueError("T13 requires 20 to 50 evaluation cases")

    refusal_count = sum(case.should_refuse for case in package.cases)
    if not 5 <= refusal_count <= 10:
        raise ValueError("T13 requires 5 to 10 refusal cases")

    safety = package.safety
    if safety is None:
        raise ValueError("T13 requires an explicit data safety declaration")
    if safety.data_classification == "synthetic":
        raise ValueError("T13 business baselines cannot use only synthetic data")
    if not safety.approved_for_external_models:
        raise ValueError("T13 data must be approved for external model processing")
    if not safety.provider_training_use_reviewed:
        raise ValueError("T13 requires a provider training-use review")
    if not safety.provider_retention_reviewed:
        raise ValueError("T13 requires a provider retention review")
    if safety.provider_review_outcome == "blocked":
        raise ValueError("T13 data is blocked by the provider review")
    if (
        safety.provider_review_outcome == "public-data-exception"
        and safety.data_classification != "public"
    ):
        raise ValueError("provider review exceptions are limited to public data")


def summarize_evaluation_package(package: EvaluationPackage) -> EvaluationPackageSummary:
    refusal_count = sum(case.should_refuse for case in package.cases)
    return EvaluationPackageSummary(
        name=package.name,
        profile=package.profile,
        document_count=len(package.documents),
        case_count=len(package.cases),
        answerable_count=len(package.cases) - refusal_count,
        refusal_count=refusal_count,
    )


def summary_as_json(summary: EvaluationPackageSummary) -> str:
    return json.dumps(asdict(summary), ensure_ascii=False, sort_keys=True)
