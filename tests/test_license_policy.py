from scripts.check_licenses import expression_ids, normalized_name, python_project_distributions


def test_license_expression_parser_keeps_only_spdx_identifiers() -> None:
    assert expression_ids("MPL-2.0 AND (Apache-2.0 OR MIT)") == {
        "MPL-2.0",
        "Apache-2.0",
        "MIT",
    }


def test_python_license_scope_uses_the_project_dependency_closure() -> None:
    names = {
        normalized_name(item.metadata.get("Name") or "")
        for item in python_project_distributions()
    }

    assert {"fastapi", "pytest", "packaging"}.issubset(names)
    assert "pip" not in names
