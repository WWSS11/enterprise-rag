import json
from pathlib import Path

from app.services.evaluation_package_service import (
    load_evaluation_package,
    require_t13_business_baseline,
    validate_evaluation_package_sources,
)


def test_source_code_holdout_package_is_self_consistent() -> None:
    root = Path(__file__).resolve().parents[1]
    package_path = root / "docs/evaluation-datasets/source-code-holdout-v1.json"
    package = json.loads(package_path.read_text(encoding="utf-8"))

    documents = package["documents"]
    upload_names = {item["upload_name"] for item in documents}
    source_paths = [root / item["source_path"] for item in documents]
    cases = package["cases"]

    assert len(documents) == 10
    assert len(upload_names) == len(documents)
    assert all(path.is_file() for path in source_paths)
    assert len(cases) == 25
    assert sum(not item["should_refuse"] for item in cases) == 20
    assert sum(item["should_refuse"] for item in cases) == 5

    for case in cases:
        expected = set(case["expected_document_names"])
        acceptable = set(case.get("acceptable_citation_document_names", expected))
        groups = case.get("required_key_point_groups", [])
        assert expected.issubset(upload_names)
        assert acceptable.issubset(upload_names)
        assert all(group and all(alias.strip() for alias in group) for group in groups)
        if case["should_refuse"]:
            assert not expected
        else:
            assert expected


def test_public_compliance_package_meets_t13_gate_and_checksums() -> None:
    root = Path(__file__).resolve().parents[1]
    package = load_evaluation_package(
        root / "docs/evaluation-datasets/public-compliance-v1.json"
    )

    validate_evaluation_package_sources(package, repository_root=root)
    require_t13_business_baseline(package)

    assert len(package.documents) == 10
    assert len(package.cases) == 25
    assert sum(case.should_refuse for case in package.cases) == 5
    assert all(document.sha256 for document in package.documents)


def test_public_compliance_v2_freezes_real_answer_aliases() -> None:
    root = Path(__file__).resolve().parents[1]
    package = load_evaluation_package(
        root / "docs/evaluation-datasets/public-compliance-v2.json"
    )

    validate_evaluation_package_sources(package, repository_root=root)
    require_t13_business_baseline(package)
    groups = {
        alias
        for case in package.cases
        for group in case.required_key_point_groups
        for alias in group
    }

    assert package.name == "公开企业合规法规基线 v2"
    assert {"20%", "才可以上岗", "不得向劳动者收取押金", "合理方式提示"} <= groups
