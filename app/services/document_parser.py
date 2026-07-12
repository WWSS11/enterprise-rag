from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import xlrd
from bs4 import BeautifulSoup, Tag
from defusedxml import ElementTree
from docx import Document as WordDocument
from openpyxl import load_workbook
from pptx import Presentation
from pypdf import PdfReader

SUPPORTED_EXTENSIONS = frozenset(
    {
        ".txt",
        ".md",
        ".csv",
        ".json",
        ".xml",
        ".pdf",
        ".docx",
        ".pptx",
        ".xlsx",
        ".xlsm",
        ".xls",
        ".html",
        ".htm",
    }
)

MARKDOWN_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
WORD_HEADING = re.compile(r"^Heading\s+([1-6])$", re.IGNORECASE)


class UnsupportedDocumentError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class ParsedSection:
    text: str
    title: str | None = None
    heading_path: tuple[str, ...] = ()
    section_type: str = "prose"
    metadata: dict[str, Any] = field(default_factory=dict)


def _clean(text: str) -> str:
    text = text.replace("\x00", "")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def _flat_section(text: str, *, section_type: str = "prose") -> list[ParsedSection]:
    cleaned = _clean(text)
    return [ParsedSection(text=cleaned, section_type=section_type)] if cleaned else []


def _parse_markdown(path: Path) -> list[ParsedSection]:
    sections: list[ParsedSection] = []
    heading_stack: list[str] = []
    title: str | None = None
    body: list[str] = []
    in_code_fence = False

    def flush() -> None:
        nonlocal body
        text = _clean("\n".join(body))
        if text:
            sections.append(
                ParsedSection(
                    text=text,
                    title=title,
                    heading_path=tuple(heading_stack),
                    section_type="prose",
                )
            )
        body = []

    for line in _read_text(path).splitlines():
        if line.lstrip().startswith("```") or line.lstrip().startswith("~~~"):
            in_code_fence = not in_code_fence
            body.append(line)
            continue
        match = None if in_code_fence else MARKDOWN_HEADING.match(line)
        if not match:
            body.append(line)
            continue
        flush()
        level = len(match.group(1))
        heading = _clean(match.group(2))
        heading_stack = heading_stack[: level - 1]
        heading_stack.append(heading)
        title = heading
    flush()
    return sections


def _parse_json(path: Path) -> list[ParsedSection]:
    try:
        value = json.loads(_read_text(path))
    except json.JSONDecodeError:
        return _flat_section(_read_text(path), section_type="structured")
    pretty = json.dumps(value, ensure_ascii=False, indent=2)
    return _flat_section(pretty, section_type="structured")


def _parse_pdf(path: Path) -> list[ParsedSection]:
    reader = PdfReader(str(path))
    sections: list[ParsedSection] = []
    for page_number, page in enumerate(reader.pages, start=1):
        text = _clean(page.extract_text() or "")
        if text:
            sections.append(
                ParsedSection(
                    text=text,
                    title=f"第 {page_number} 页",
                    heading_path=(f"第 {page_number} 页",),
                    metadata={"page": page_number},
                )
            )
    return sections


def _parse_docx(path: Path) -> list[ParsedSection]:
    document = WordDocument(str(path))
    sections: list[ParsedSection] = []
    heading_stack: list[str] = []
    title: str | None = None
    body: list[str] = []

    def flush() -> None:
        nonlocal body
        text = _clean("\n".join(body))
        if text:
            sections.append(
                ParsedSection(
                    text=text,
                    title=title,
                    heading_path=tuple(heading_stack),
                )
            )
        body = []

    for paragraph in document.paragraphs:
        text = _clean(paragraph.text)
        if not text:
            continue
        style_name = getattr(paragraph.style, "name", "") or ""
        match = WORD_HEADING.match(style_name)
        if match:
            flush()
            level = int(match.group(1))
            heading_stack = heading_stack[: level - 1]
            heading_stack.append(text)
            title = text
        else:
            body.append(text)
    flush()

    for table_number, table in enumerate(document.tables, start=1):
        rows = []
        for row in table.rows:
            values = [_clean(cell.text) for cell in row.cells]
            if any(values):
                rows.append("\t".join(values))
        text = _clean("\n".join(rows))
        if text:
            table_title = f"表格 {table_number}"
            sections.append(
                ParsedSection(
                    text=text,
                    title=table_title,
                    heading_path=(*heading_stack, table_title),
                    section_type="table",
                    metadata={"table": table_number},
                )
            )
    return sections


def _parse_pptx(path: Path) -> list[ParsedSection]:
    presentation = Presentation(str(path))
    sections: list[ParsedSection] = []
    for slide_number, slide in enumerate(presentation.slides, start=1):
        title = _clean(slide.shapes.title.text) if slide.shapes.title else ""
        lines: list[str] = []
        for shape in slide.shapes:
            if getattr(shape, "has_text_frame", False):
                text = _clean(shape.text)
                if text and text != title:
                    lines.append(text)
            if getattr(shape, "has_table", False):
                for row in shape.table.rows:
                    values = [_clean(cell.text) for cell in row.cells]
                    if any(values):
                        lines.append("\t".join(values))
        text = _clean("\n".join(([title] if title else []) + lines))
        if text or title:
            display_title = title or f"幻灯片 {slide_number}"
            sections.append(
                ParsedSection(
                    text=text or display_title,
                    title=display_title,
                    heading_path=(display_title,),
                    metadata={"slide": slide_number},
                )
            )
    return sections


def _parse_xlsx(path: Path) -> list[ParsedSection]:
    workbook = load_workbook(path, read_only=True, data_only=True)
    try:
        sections: list[ParsedSection] = []
        for sheet in workbook.worksheets:
            lines = [
                "\t".join("" if cell is None else str(cell) for cell in row).rstrip()
                for row in sheet.iter_rows(values_only=True)
            ]
            text = _clean("\n".join(line for line in lines if line))
            if text:
                sections.append(
                    ParsedSection(
                        text=text,
                        title=sheet.title,
                        heading_path=(sheet.title,),
                        section_type="table",
                        metadata={"sheet": sheet.title},
                    )
                )
        return sections
    finally:
        workbook.close()


def _parse_xls(path: Path) -> list[ParsedSection]:
    workbook = xlrd.open_workbook(str(path), on_demand=True)
    try:
        sections: list[ParsedSection] = []
        for sheet in workbook.sheets():
            lines = [
                "\t".join(
                    str(sheet.cell_value(row, column)) for column in range(sheet.ncols)
                ).rstrip()
                for row in range(sheet.nrows)
            ]
            text = _clean("\n".join(line for line in lines if line))
            if text:
                sections.append(
                    ParsedSection(
                        text=text,
                        title=sheet.name,
                        heading_path=(sheet.name,),
                        section_type="table",
                        metadata={"sheet": sheet.name},
                    )
                )
        return sections
    finally:
        workbook.release_resources()


def _parse_html(path: Path) -> list[ParsedSection]:
    soup = BeautifulSoup(_read_text(path), "html.parser")
    for tag in soup(["script", "style", "noscript", "nav", "footer", "header"]):
        tag.decompose()

    sections: list[ParsedSection] = []
    headings: list[str] = []
    current_title: str | None = None
    body: list[str] = []

    def flush() -> None:
        nonlocal body
        text = _clean("\n".join(body))
        if text:
            sections.append(
                ParsedSection(
                    text=text,
                    title=current_title,
                    heading_path=tuple(headings),
                )
            )
        body = []

    root = soup.body or soup
    for node in root.descendants:
        if not isinstance(node, Tag):
            continue
        if node.name in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            flush()
            level = int(node.name[1])
            current_title = _clean(node.get_text(" ", strip=True))
            headings = headings[: level - 1]
            headings.append(current_title)
        elif node.name in {"p", "li", "pre", "blockquote"}:
            text = _clean(node.get_text(" ", strip=True))
            if text:
                body.append(text)
        elif node.name == "table":
            rows = [
                "\t".join(
                    _clean(cell.get_text(" ", strip=True))
                    for cell in row.find_all(["th", "td"])
                )
                for row in node.find_all("tr")
            ]
            table_text = _clean("\n".join(row for row in rows if row))
            if table_text:
                body.append(table_text)
    flush()
    if sections:
        return sections
    return _flat_section(soup.get_text("\n", strip=True))


def _parse_xml(path: Path) -> list[ParsedSection]:
    root = ElementTree.parse(path).getroot()
    text = _clean("\n".join(part.strip() for part in root.itertext() if part.strip()))
    return _flat_section(text, section_type="structured")


def parse_document_sections(path: Path) -> list[ParsedSection]:
    suffix = path.suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise UnsupportedDocumentError(f"unsupported document type: {suffix or '<none>'}")
    if suffix == ".md":
        return _parse_markdown(path)
    if suffix in {".txt", ".csv"}:
        section_type = "table" if suffix == ".csv" else "prose"
        return _flat_section(_read_text(path), section_type=section_type)
    if suffix == ".json":
        return _parse_json(path)
    if suffix == ".xml":
        return _parse_xml(path)
    if suffix == ".pdf":
        return _parse_pdf(path)
    if suffix == ".docx":
        return _parse_docx(path)
    if suffix == ".pptx":
        return _parse_pptx(path)
    if suffix in {".xlsx", ".xlsm"}:
        return _parse_xlsx(path)
    if suffix == ".xls":
        return _parse_xls(path)
    return _parse_html(path)


def parse_document(path: Path) -> str:
    """Compatibility helper returning the complete plain text representation."""

    return "\n\n".join(section.text for section in parse_document_sections(path))
