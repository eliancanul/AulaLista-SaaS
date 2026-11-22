"""Isolated subprocess worker for safe PDF, DOCX, and image OCR text extraction."""

from __future__ import annotations

import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass

MAX_EXTRACTED_CHARS = 60_000
MAX_PDF_PAGES = 40
WORKER_TIMEOUT_SECONDS = 12


@dataclass(frozen=True)
class ExtractionResult:
    ok: bool
    text: str
    page_count: int
    ocr_engine: str
    error_code: str | None = None


def _apply_posix_limits() -> None:
    try:
        import resource

        resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
    except Exception:
        pass


def _extract_pdf(path: str) -> dict:
    from pypdf import PdfReader

    reader = PdfReader(path)
    total_pages = len(reader.pages)
    chunks: list[str] = []
    for page in reader.pages[:MAX_PDF_PAGES]:
        extracted = (page.extract_text() or "").strip()
        if extracted:
            chunks.append(extracted)
    text = "\n\n".join(chunks)[:MAX_EXTRACTED_CHARS]
    return {
        "ok": True,
        "text": text,
        "page_count": total_pages,
        "ocr_engine": "pypdf-isolated",
        "error_code": None,
    }


def _extract_docx(path: str) -> dict:
    with zipfile.ZipFile(path) as zf:
        xml_bytes = zf.read("word/document.xml")
    if b"<!DOCTYPE" in xml_bytes or b"<!ENTITY" in xml_bytes:
        return {
            "ok": False,
            "text": "",
            "page_count": 0,
            "ocr_engine": "docx-xml-isolated",
            "error_code": "xml_entity_rejected",
        }
    root = ET.fromstring(xml_bytes)
    paragraphs: list[str] = []
    for p in root.iter():
        if p.tag.endswith("}p") or p.tag == "p":
            texts = [
                el.text
                for el in p.iter()
                if (el.tag.endswith("}t") or el.tag == "t") and el.text
            ]
            line = "".join(texts).strip()
            if line:
                paragraphs.append(line)
    text = "\n".join(paragraphs)[:MAX_EXTRACTED_CHARS]
    return {
        "ok": True,
        "text": text,
        "page_count": max(1, (len(text) // 2500) + 1),
        "ocr_engine": "docx-xml-isolated",
        "error_code": None,
    }


def _image_dimensions(raw: bytes, mime: str) -> tuple[int, int] | None:
    if mime == "image/png" and len(raw) >= 24:
        w, h = struct.unpack(">II", raw[16:24])
        return (w, h)
    return None


def _extract_image(path: str, mime: str) -> dict:
    tesseract_bin = shutil.which("tesseract")
    if tesseract_bin:
        proc = subprocess.run(
            [tesseract_bin, path, "stdout", "-l", "spa+eng"],
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
        if proc.returncode == 0 and proc.stdout.strip():
            return {
                "ok": True,
                "text": proc.stdout.strip()[:MAX_EXTRACTED_CHARS],
                "page_count": 1,
                "ocr_engine": "tesseract-isolated",
                "error_code": None,
            }
    with open(path, "rb") as fh:
        raw = fh.read()
    dims = _image_dimensions(raw, mime)
    dim_str = f" ({dims[0]}x{dims[1]} px)" if dims else ""
    return {
        "ok": True,
        "text": f"[Imagen adjunta {mime}{dim_str}. OCR local sin texto legible; edita o añade notas para generar tu ficha.]",
        "page_count": 1,
        "ocr_engine": "image-metadata-fallback",
        "error_code": None,
    }


def run_isolated_extraction(raw: bytes, mime: str) -> ExtractionResult:
    """Execute untrusted file parsing inside a short-lived isolated subprocess."""
    suffix = {
        "application/pdf": ".pdf",
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    }.get(mime, ".bin")

    with tempfile.NamedTemporaryFile(
        prefix="aulalista_doc_", suffix=suffix, delete=False
    ) as tmp:
        tmp.write(raw)
        tmp_path = tmp.name

    try:
        proc = subprocess.run(
            [
                sys.executable,
                "-m",
                "aulalista_api.document_worker",
                tmp_path,
                mime,
            ],
            capture_output=True,
            text=True,
            timeout=WORKER_TIMEOUT_SECONDS,
            check=False,
            env={
                "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
                "PYTHONPATH": os.environ.get("PYTHONPATH", ""),
            },
        )
        if proc.returncode != 0:
            return ExtractionResult(
                ok=False,
                text="",
                page_count=0,
                ocr_engine="isolated-worker",
                error_code="extraction_failed",
            )
        parsed = json.loads(proc.stdout)
        return ExtractionResult(
            ok=bool(parsed.get("ok")),
            text=str(parsed.get("text") or ""),
            page_count=int(parsed.get("page_count") or 0),
            ocr_engine=str(parsed.get("ocr_engine") or "isolated-worker"),
            error_code=parsed.get("error_code"),
        )
    except subprocess.TimeoutExpired:
        return ExtractionResult(
            ok=False,
            text="",
            page_count=0,
            ocr_engine="isolated-worker",
            error_code="extraction_timeout",
        )
    except Exception:
        return ExtractionResult(
            ok=False,
            text="",
            page_count=0,
            ocr_engine="isolated-worker",
            error_code="extraction_failed",
        )
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def _cli() -> None:
    _apply_posix_limits()
    if len(sys.argv) != 3:
        sys.exit(2)
    path, mime = sys.argv[1], sys.argv[2]
    try:
        if mime == "application/pdf":
            result = _extract_pdf(path)
        elif (
            mime
            == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ):
            result = _extract_docx(path)
        elif mime in ("image/png", "image/jpeg"):
            result = _extract_image(path, mime)
        else:
            result = {
                "ok": False,
                "text": "",
                "page_count": 0,
                "ocr_engine": "isolated-worker",
                "error_code": "unsupported_file_type",
            }
        sys.stdout.write(json.dumps(result))
    except Exception:
        sys.stdout.write(
            json.dumps(
                {
                    "ok": False,
                    "text": "",
                    "page_count": 0,
                    "ocr_engine": "isolated-worker",
                    "error_code": "parse_error",
                }
            )
        )


if __name__ == "__main__":
    _cli()
