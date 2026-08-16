from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

import pytest

from app.services.upload_security_service import (
    UploadValidationError,
    validate_upload_content,
)

MAX_UPLOAD_BYTES = 50 * 1024 * 1024


def office_archive(
    root_file: str,
    payload: bytes = b"document content",
    *,
    extra_entries: dict[str, bytes] | None = None,
) -> bytes:
    target = BytesIO()
    with ZipFile(target, "w", ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", b"<Types />")
        archive.writestr(root_file, payload)
        for name, value in (extra_entries or {}).items():
            archive.writestr(name, value)
    return target.getvalue()


@pytest.mark.parametrize(
    ("filename", "content_type", "content"),
    [
        ("policy.pdf", "application/pdf", b"%PDF-1.7\nvalid"),
        ("policy.json", "application/json", b'{"approved": true}'),
        (
            "policy.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            office_archive("word/document.xml"),
        ),
        (
            "policy.pptx",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            office_archive("ppt/presentation.xml"),
        ),
        (
            "policy.xlsx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            office_archive("xl/workbook.xml"),
        ),
    ],
)
def test_safe_upload_signatures_are_accepted(
    filename: str, content_type: str, content: bytes
) -> None:
    validate_upload_content(
        filename=filename,
        declared_content_type=content_type,
        content=content,
        max_upload_bytes=MAX_UPLOAD_BYTES,
    )


@pytest.mark.parametrize(
    ("filename", "content_type", "content", "message"),
    [
        ("fake.pdf", "application/pdf", b"not a pdf", "PDF signature"),
        ("fake.pdf", "text/html", b"%PDF-1.7", "content type"),
        ("binary.txt", "text/plain", b"text\x00binary", "NUL"),
        ("invalid.json", "application/json", b"not-json", "valid UTF-8 JSON"),
        ("fake.docx", "application/octet-stream", b"not-zip", "malformed"),
    ],
)
def test_spoofed_or_malformed_uploads_are_rejected(
    filename: str,
    content_type: str,
    content: bytes,
    message: str,
) -> None:
    with pytest.raises(UploadValidationError, match=message):
        validate_upload_content(
            filename=filename,
            declared_content_type=content_type,
            content=content,
            max_upload_bytes=MAX_UPLOAD_BYTES,
        )


def test_office_archives_reject_path_traversal_and_active_content() -> None:
    traversal = office_archive("word/document.xml", extra_entries={"../escape": b"x"})
    macro = office_archive(
        "word/document.xml",
        extra_entries={"word/vbaProject.bin": b"macro"},
    )

    for content, message in [(traversal, "unsafe path"), (macro, "active")]:
        with pytest.raises(UploadValidationError, match=message):
            validate_upload_content(
                filename="policy.docx",
                declared_content_type="application/octet-stream",
                content=content,
                max_upload_bytes=MAX_UPLOAD_BYTES,
            )


def test_office_archives_reject_symlinks_and_compression_bombs() -> None:
    symlink_target = BytesIO()
    with ZipFile(symlink_target, "w") as archive:
        archive.writestr("[Content_Types].xml", b"<Types />")
        archive.writestr("word/document.xml", b"safe")
        link = ZipInfo("word/link")
        link.external_attr = 0o120777 << 16
        archive.writestr(link, b"target")

    bomb = office_archive("word/document.xml", payload=b"0" * 1_000_000)
    for content, message in [
        (symlink_target.getvalue(), "symbolic link"),
        (bomb, "compression ratio"),
    ]:
        with pytest.raises(UploadValidationError, match=message):
            validate_upload_content(
                filename="policy.docx",
                declared_content_type="application/octet-stream",
                content=content,
                max_upload_bytes=MAX_UPLOAD_BYTES,
            )
