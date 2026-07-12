from pathlib import Path

from app.services.source_path_service import portable_source_uri, resolve_source_uri


def test_project_file_uses_portable_relative_uri(tmp_path) -> None:
    path = tmp_path / "data" / "uploads" / "document.md"
    path.parent.mkdir(parents=True)
    path.write_text("content", encoding="utf-8")

    uri = portable_source_uri(path, tmp_path)

    assert uri == "data/uploads/document.md"
    assert resolve_source_uri(uri, tmp_path) == path.resolve()


def test_legacy_container_data_path_maps_to_local_project(tmp_path) -> None:
    expected = tmp_path / "data" / "uploads" / "default" / "document.md"

    resolved = resolve_source_uri(
        "/app/data/uploads/default/document.md", project_root=tmp_path
    )

    assert resolved == expected.resolve()


def test_external_absolute_path_is_preserved(tmp_path) -> None:
    external = Path("Z:/shared/knowledge/document.pdf")

    assert resolve_source_uri(str(external), tmp_path) == external
