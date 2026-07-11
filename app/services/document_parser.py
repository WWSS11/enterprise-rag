from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import xlrd
from bs4 import BeautifulSoup
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


class UnsupportedDocumentError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class ParsedSection:
    text: str
    metadata: dict[str, Any] = field(default_factory=dict)


def _clean(text: str) -> str:
    return text.replace("\x00", "").strip()


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def _parse_pdf(path: Path) -> list[ParsedSection]:
    reader = PdfReader(str(path))
    return [
        ParsedSection(text=text, metadata={"page": page_number})
        for page_number, page in enumerate(reader.pages, start=1)
        if (text := _clean(page.extract_text() or ""))
    ]


def _parse_docx(path: Path) -> list[ParsedSection]:
    document = WordDocument(str(path))
    lines = [_clean(paragraph.text) for paragraph in document.paragraphs]
    for table_number, table in enumerate(document.tables, start=1):
        lines.append(f"[表格 {table_number}]")
        for row in table.rows:
            values = [_clean(cell.text) for cell in row.cells]
            if any(values):
                lines.append("\t".join(values))
    text = _clean("\n".join(line for line in lines if line))
    return [ParsedSection(text=text)] if text else []


def _parse_pptx(path: Path) -> list[ParsedSection]:
    presentation = Presentation(str(path))
    sections: list[ParsedSection] = []
    for slide_number, slide in enumerate(presentation.slides, start=1):
        lines: list[str] = []
        for shape in slide.shapes:
            if getattr(shape, "has_text_frame", False):
                text = _clean(shape.text)
                if text:
                    lines.append(text)
            if getattr(shape, "has_table", False):
                for row in shape.table.rows:
                    values = [_clean(cell.text) for cell in row.cells]
                    if any(values):
                        lines.append("\t".join(values))
        text = _clean("\n".join(lines))
        if text:
            sections.append(ParsedSection(text=text, metadata={"slide": slide_number}))
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
                sections.append(ParsedSection(text=text, metadata={"sheet": sheet.title}))
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
                sections.append(ParsedSection(text=text, metadata={"sheet": sheet.name}))
        return sections
    finally:
        workbook.release_resources()


def _parse_html(path: Path) -> list[ParsedSection]:
    soup = BeautifulSoup(_read_text(path), "html.parser")
    for tag in soup(["script", "style", "noscript", "nav", "footer", "header"]):
        tag.decompose()
    text = _clean(soup.get_text("\n", strip=True))
    return [ParsedSection(text=text)] if text else []


def _parse_xml(path: Path) -> list[ParsedSection]:
    root = ElementTree.parse(path).getroot()
    text = _clean("\n".join(part.strip() for part in root.itertext() if part.strip()))
    return [ParsedSection(text=text)] if text else []


def parse_document_sections(path: Path) -> list[ParsedSection]:
    suffix = path.suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise UnsupportedDocumentError(f"unsupported document type: {suffix or '<none>'}")
    if suffix in {".txt", ".md", ".csv", ".json"}:
        text = _clean(_read_text(path))
        return [ParsedSection(text=text)] if text else []
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
