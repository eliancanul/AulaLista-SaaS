"""Strict file validation, magic-byte sniffing, and zip-bomb defense for teacher documents."""

from __future__ import annotations

import hashlib
import io
import re
import zipfile
from dataclasses import dataclass

MAX_DOCUMENT_BYTES = 10 * 1024 * 1024  # 10 MB hard upload ceiling
MAX_DOCX_ENTRIES = 200
MAX_DOCX_UNCOMPRESSED_BYTES = 25 * 1024 * 1024  # 25 MB zip-bomb ceiling

ALLOWED_MIMES = frozenset(
    {
        "application/pdf",
        "image/png",
        "image/jpeg",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }
)

_FILENAME_SAFE_RE = re.compile(r"[^A-Za-z0-9._\-\sáéíóúÁÉÍÓÚñÑüÜ]")


class DocumentValidationError(Exception):
    def __init__(self, code: str, status: int = 422) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


@dataclass(frozen=True)
class ValidatedDocumentBytes:
    filename: str
    detected_mime: str
    size_bytes: int
    sha256: str
    raw_bytes: bytes


def sanitize_filename(raw: str) -> str:
    base = raw.replace("\\", "/").split("/")[-1].strip()
    cleaned = _FILENAME_SAFE_RE.sub("_", base).strip(". ")
    if not cleaned:
        cleaned = "documento"
    return cleaned[:160]


def _validate_docx_archive(raw: bytes) -> None:
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            infos = zf.infolist()
            if len(infos) > MAX_DOCX_ENTRIES:
                raise DocumentValidationError("docx_too_many_entries", status=422)
            total_uncompressed = 0
            has_document_xml = False
            for info in infos:
                name = info.filename
                if name.startswith("/") or ".." in name.split("/"):
                    raise DocumentValidationError("docx_unsafe_path", status=422)
                total_uncompressed += max(0, info.file_size)
                if total_uncompressed > MAX_DOCX_UNCOMPRESSED_BYTES:
                    raise DocumentValidationError("docx_zip_bomb_rejected", status=422)
                if name == "word/document.xml":
                    has_document_xml = True
            if not has_document_xml:
                raise DocumentValidationError("unsupported_file_type", status=422)
    except DocumentValidationError:
        raise
    except zipfile.BadZipFile:
        raise DocumentValidationError("corrupted_docx", status=422) from None


def sniff_and_validate_document(*, filename: str, raw: bytes) -> ValidatedDocumentBytes:
    if not raw:
        raise DocumentValidationError("empty_file", status=422)
    if len(raw) > MAX_DOCUMENT_BYTES:
        raise DocumentValidationError("file_too_large", status=413)

    detected_mime: str | None = None
    if raw.startswith(b"%PDF-"):
        detected_mime = "application/pdf"
    elif raw.startswith(b"\x89PNG\r\n\x1a\n"):
        detected_mime = "image/png"
    elif raw.startswith(b"\xff\xd8\xff"):
        detected_mime = "image/jpeg"
    elif raw.startswith(b"PK\x03\x04"):
        _validate_docx_archive(raw)
        detected_mime = (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )
    else:
        raise DocumentValidationError("unsupported_file_type", status=422)

    if detected_mime not in ALLOWED_MIMES:
        raise DocumentValidationError("unsupported_file_type", status=422)

    return ValidatedDocumentBytes(
        filename=sanitize_filename(filename),
        detected_mime=detected_mime,
        size_bytes=len(raw),
        sha256=hashlib.sha256(raw).hexdigest(),
        raw_bytes=raw,
    )
