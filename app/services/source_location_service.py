from __future__ import annotations

from collections.abc import Sequence
from typing import Any


def _positive_int(value: Any) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _safe_text(value: Any, *, maximum: int = 255) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text[:maximum] if text else None


def source_location(
    metadata: dict[str, Any] | None,
    *,
    heading_path: Sequence[str] = (),
    section_index: int | None = None,
) -> dict[str, object] | None:
    """Project parser metadata into a stable, non-sensitive citation locator."""

    metadata = metadata or {}
    page = _positive_int(metadata.get("page"))
    slide = _positive_int(metadata.get("slide"))
    paragraph_start = _positive_int(
        metadata.get("paragraph_start", metadata.get("paragraph"))
    )
    paragraph_end = _positive_int(
        metadata.get("paragraph_end", metadata.get("paragraph"))
    )
    sheet = _safe_text(metadata.get("sheet"))
    table = _safe_text(metadata.get("table"))
    cell_range = _safe_text(metadata.get("cell_range"), maximum=64)
    safe_headings = [str(item)[:255] for item in heading_path if str(item).strip()]

    if cell_range:
        kind = "cell_range"
    elif page:
        kind = "page"
    elif slide:
        kind = "slide"
    elif paragraph_start:
        kind = "paragraph"
    elif safe_headings or section_index is not None:
        kind = "section"
    else:
        return None

    return {
        "kind": kind,
        "page": page,
        "slide": slide,
        "paragraph_start": paragraph_start,
        "paragraph_end": paragraph_end or paragraph_start,
        "sheet": sheet,
        "table": table,
        "cell_range": cell_range,
        "section_index": section_index,
        "heading_path": safe_headings,
    }
