from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.schemas.evaluation_package import EvaluationPackage
from app.services.evaluation_package_service import (
    load_evaluation_package,
    require_t13_business_baseline,
    summarize_evaluation_package,
    validate_evaluation_package_sources,
)
from scripts.import_evaluation_package import build_case_payloads
from scripts.import_evaluation_package import main as import_main


def business_package(tmp_path: Path) -> dict[str, object]:
    documents = []
    for index in range(10):
        source = tmp_path / f"document-{index}.md"
        source.write_text(f"approved business fact {index}", encoding="utf-8")
        documents.append(
            {"source_path": source.name, "upload_name": f"business-{index}.md"}
        )

    cases = [
        {
            "question": f"What is approved fact {index}?",
            "reference_answer": f"The approved fact is {index}.",
            "expected_document_names": [f"business-{index % 10}.md"],
            "required_key_points": [str(index)],
            "should_refuse": False,
            "tags": ["business"],
        }
        for index in range(20)
    ]
    cases.extend(
        {
            "question": f"What is the unavailable private value {index}?",
            "reference_answer": "The approved documents do not contain that value.",
            "should_refuse": True,
            "tags": ["refusal"],
        }
        for index in range(5)
    )
    return {
        "schema_version": "1.0",
        "profile": "business-baseline",
        "name": "Approved business baseline",
        "description": "A sanitized package approved for a real T13 evaluation.",
        "knowledge_base": {
            "slug": "approved-business-baseline",
            "name": "Approved business baseline",
            "description": "T13 test data",
            "access_mode": "restricted",
        },
        "safety": {
            "data_classification": "internal-sanitized",
            "approved_for_external_models": True,
            "provider_training_use_reviewed": True,
            "provider_retention_reviewed": True,
            "approval_reference": "approval-test-001",
        },
        "documents": documents,
        "cases": cases,
    }


def test_t13_business_package_is_validated_without_uploading_data(tmp_path: Path) -> None:
    payload = business_package(tmp_path)
    path = tmp_path / "baseline.json"
    path.write_text(json.dumps(payload), encoding="utf-8")

    package = load_evaluation_package(path)
    validate_evaluation_package_sources(package, repository_root=tmp_path)
    require_t13_business_baseline(package)

    summary = summarize_evaluation_package(package)
    assert summary.document_count == 10
    assert summary.case_count == 25
    assert summary.answerable_count == 20
    assert summary.refusal_count == 5


def test_t13_rejects_data_without_provider_review(tmp_path: Path) -> None:
    payload = business_package(tmp_path)
    safety = payload["safety"]
    assert isinstance(safety, dict)
    safety["provider_retention_reviewed"] = False
    package = EvaluationPackage.model_validate(payload)

    with pytest.raises(ValueError, match="provider retention review"):
        require_t13_business_baseline(package)


def test_t13_provider_exception_is_limited_to_public_data(tmp_path: Path) -> None:
    payload = business_package(tmp_path)
    safety = payload["safety"]
    assert isinstance(safety, dict)
    safety["provider_review_outcome"] = "public-data-exception"
    package = EvaluationPackage.model_validate(payload)

    with pytest.raises(ValueError, match="limited to public data"):
        require_t13_business_baseline(package)

    safety["data_classification"] = "public"
    package = EvaluationPackage.model_validate(payload)
    require_t13_business_baseline(package)


def test_package_rejects_unknown_document_references(tmp_path: Path) -> None:
    payload = business_package(tmp_path)
    cases = payload["cases"]
    assert isinstance(cases, list)
    first_case = cases[0]
    assert isinstance(first_case, dict)
    first_case["expected_document_names"] = ["missing.md"]

    with pytest.raises(ValidationError, match="unknown documents: missing.md"):
        EvaluationPackage.model_validate(payload)


def test_package_rejects_key_point_group_with_multiple_anchors(tmp_path: Path) -> None:
    payload = business_package(tmp_path)
    cases = payload["cases"]
    assert isinstance(cases, list)
    first_case = cases[0]
    assert isinstance(first_case, dict)
    first_case["required_key_points"] = ["approved", "fact"]
    first_case["required_key_point_groups"] = [["approved", "fact"]]

    with pytest.raises(ValidationError, match="exactly one required key point"):
        EvaluationPackage.model_validate(payload)


def test_package_sources_cannot_escape_repository_root(tmp_path: Path) -> None:
    root = tmp_path / "root"
    root.mkdir()
    outside = tmp_path / "outside.md"
    outside.write_text("not approved", encoding="utf-8")
    payload = business_package(root)
    documents = payload["documents"]
    assert isinstance(documents, list)
    first_document = documents[0]
    assert isinstance(first_document, dict)
    first_document["source_path"] = "../outside.md"
    package = EvaluationPackage.model_validate(payload)

    with pytest.raises(ValueError, match="escapes repository root"):
        validate_evaluation_package_sources(package, repository_root=root)


def test_import_payload_maps_document_names_to_uploaded_ids(tmp_path: Path) -> None:
    package = EvaluationPackage.model_validate(business_package(tmp_path))
    document_ids = {
        document.upload_name: f"document-id-{index}"
        for index, document in enumerate(package.documents)
    }

    payloads = build_case_payloads(package, document_ids)

    assert payloads[0]["expected_document_ids"] == ["document-id-0"]
    assert payloads[0]["acceptable_citation_document_ids"] == ["document-id-0"]
    assert payloads[-1]["should_refuse"] is True
    assert payloads[-1]["expected_document_ids"] == []


def test_import_command_is_validation_only_without_apply(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    package_path = tmp_path / "baseline.json"
    package_path.write_text(json.dumps(business_package(tmp_path)), encoding="utf-8")
    monkeypatch.setattr(
        "sys.argv",
        [
            "import_evaluation_package.py",
            str(package_path),
            "--repository-root",
            str(tmp_path),
        ],
    )

    assert import_main() == 0
    output = json.loads(capsys.readouterr().out)
    assert output["validated"] is True
    assert output["applied"] is False
    assert output["document_count"] == 10
