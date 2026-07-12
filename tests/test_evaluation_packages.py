import json
from pathlib import Path


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
        assert expected.issubset(upload_names)
        assert acceptable.issubset(upload_names)
        if case["should_refuse"]:
            assert not expected
        else:
            assert expected
