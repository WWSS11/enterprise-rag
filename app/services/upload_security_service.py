from __future__ import annotations

import json
import stat
from io import BytesIO
from pathlib import Path, PurePosixPath
from zipfile import BadZipFile, ZipFile


class UploadValidationError(ValueError):
    def __init__(self, message: str, *, status_code: int = 422) -> None:
        super().__init__(message)
        self.status_code = status_code


ZIP_DOCUMENT_ROOTS = {
    ".docx": "word/",
    ".pptx": "ppt/",
    ".xlsx": "xl/",
}
DECLARED_CONTENT_TYPES = {
    ".txt": {"text/plain"},
    ".md": {"text/markdown", "text/plain"},
    ".csv": {"text/csv", "text/plain", "application/csv"},
    ".json": {"application/json", "text/json", "text/plain"},
    ".xml": {"application/xml", "text/xml", "text/plain"},
    ".pdf": {"application/pdf"},
    ".docx": {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    },
    ".pptx": {
        "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    },
    ".xlsx": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
    ".xls": {"application/vnd.ms-excel"},
    ".html": {"text/html", "application/xhtml+xml", "text/plain"},
    ".htm": {"text/html", "application/xhtml+xml", "text/plain"},
}
GENERIC_CONTENT_TYPES = {"", "application/octet-stream", "binary/octet-stream"}
OLE_SIGNATURE = bytes.fromhex("D0CF11E0A1B11AE1")
MAX_ARCHIVE_ENTRIES = 2_000
MAX_ARCHIVE_COMPRESSION_RATIO = 100


def _validate_declared_content_type(suffix: str, declared_content_type: str | None) -> None:
    normalized = (declared_content_type or "").partition(";")[0].strip().lower()
    if normalized in GENERIC_CONTENT_TYPES:
        return
    if normalized not in DECLARED_CONTENT_TYPES.get(suffix, set()):
        raise UploadValidationError(
            "declared content type does not match the file extension",
            status_code=415,
        )


def _validate_text_content(suffix: str, content: bytes) -> None:
    if b"\x00" in content:
        raise UploadValidationError("text document contains binary NUL bytes")
    prefix = content.lstrip()[:64].lower()
    if suffix == ".json":
        try:
            json.loads(content.decode("utf-8-sig"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise UploadValidationError("JSON document is not valid UTF-8 JSON") from exc
    if suffix == ".xml" and not prefix.startswith(b"<"):
        raise UploadValidationError("XML document does not have an XML signature")
    if suffix in {".html", ".htm"} and not prefix.startswith(b"<"):
        raise UploadValidationError("HTML document does not have an HTML signature")


def _validate_zip_document(suffix: str, content: bytes, max_upload_bytes: int) -> None:
    try:
        with ZipFile(BytesIO(content)) as archive:
            entries = archive.infolist()
            if not entries or len(entries) > MAX_ARCHIVE_ENTRIES:
                raise UploadValidationError("document archive has an unsafe entry count")
            names = {entry.filename for entry in entries}
            if "[Content_Types].xml" not in names or not any(
                name.startswith(ZIP_DOCUMENT_ROOTS[suffix]) for name in names
            ):
                raise UploadValidationError("document archive does not match its extension")

            total_uncompressed = 0
            total_compressed = 0
            for entry in entries:
                path = PurePosixPath(entry.filename.replace("\\", "/"))
                if path.is_absolute() or ".." in path.parts:
                    raise UploadValidationError("document archive contains an unsafe path")
                if entry.flag_bits & 0x1:
                    raise UploadValidationError("encrypted document archives are not supported")
                if stat.S_ISLNK(entry.external_attr >> 16):
                    raise UploadValidationError("document archive contains a symbolic link")
                total_uncompressed += entry.file_size
                total_compressed += entry.compress_size
                if (
                    entry.file_size > 0
                    and entry.file_size > max(entry.compress_size, 1)
                    * MAX_ARCHIVE_COMPRESSION_RATIO
                ):
                    raise UploadValidationError("document archive has an unsafe compression ratio")

            if total_uncompressed > max_upload_bytes * 4:
                raise UploadValidationError("document archive expands beyond the safe limit")
            if (
                total_uncompressed > 0
                and total_uncompressed
                > max(total_compressed, 1) * MAX_ARCHIVE_COMPRESSION_RATIO
            ):
                raise UploadValidationError("document archive has an unsafe compression ratio")

            lowered_names = {name.casefold() for name in names}
            if any(
                name.endswith("vbaproject.bin")
                or "/embeddings/" in f"/{name}"
                or "/activex/" in f"/{name}"
                for name in lowered_names
            ):
                raise UploadValidationError("document archive contains active or embedded content")
    except BadZipFile as exc:
        raise UploadValidationError("document archive is malformed", status_code=415) from exc


def validate_upload_content(
    *,
    filename: str,
    declared_content_type: str | None,
    content: bytes,
    max_upload_bytes: int,
) -> None:
    suffix = Path(filename).suffix.lower()
    _validate_declared_content_type(suffix, declared_content_type)

    if suffix == ".pdf" and not content.startswith(b"%PDF-"):
        raise UploadValidationError(
            "PDF signature does not match the file extension",
            status_code=415,
        )
    if suffix in ZIP_DOCUMENT_ROOTS:
        _validate_zip_document(suffix, content, max_upload_bytes)
    elif suffix == ".xls" and not content.startswith(OLE_SIGNATURE):
        raise UploadValidationError(
            "legacy Excel signature does not match the file extension",
            status_code=415,
        )
    elif suffix in {".txt", ".md", ".csv", ".json", ".xml", ".html", ".htm"}:
        _validate_text_content(suffix, content)
