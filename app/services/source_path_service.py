from __future__ import annotations

from pathlib import Path


def portable_source_uri(path: Path, project_root: Path | None = None) -> str:
    """Store project-managed files as relative URIs so host/container modes can switch."""

    root = (project_root or Path.cwd()).resolve()
    resolved = path.resolve()
    try:
        return resolved.relative_to(root).as_posix()
    except ValueError:
        return str(resolved)


def resolve_source_uri(source_uri: str, project_root: Path | None = None) -> Path:
    """Resolve relative, Windows-host, and legacy /app/data source locations."""

    root = (project_root or Path.cwd()).resolve()
    normalized = source_uri.replace("\\", "/")
    if normalized.lower().startswith("/app/data/"):
        return (root / Path(normalized.removeprefix("/app/"))).resolve()

    direct = Path(source_uri)
    if not direct.is_absolute():
        return (root / direct).resolve()
    if direct.is_file():
        return direct.resolve()

    marker = "/data/"
    marker_index = normalized.lower().find(marker)
    if marker_index >= 0:
        relative_data_path = normalized[marker_index + 1 :]
        return (root / Path(relative_data_path)).resolve()
    return direct
