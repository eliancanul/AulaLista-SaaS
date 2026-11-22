"""Tests for secure real documents, isolated extraction, coherent purge/non-revival, and cited web search (#127)."""

from __future__ import annotations

import base64
import io
import struct
import zipfile
import zlib
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from reportlab.pdfgen import canvas
from sqlalchemy.orm import Session

from aulalista_api.app import create_app
from aulalista_api.database import PersonalScope, Principal
from aulalista_api.documents import (
    DocumentBlob,
    DocumentRevocationTombstone,
    TeacherDocument,
    reconcile_revoked_documents,
)
from aulalista_api.material_routes import require_actor


def _seed_user(engine):
    with Session(engine) as db:
        principal = Principal(id=uuid4())
        db.add(principal)
        db.flush()
        scope = PersonalScope(id=uuid4(), owner_principal_id=principal.id)
        db.add(scope)
        db.commit()
        return principal.id, scope.id


def _make_pdf_bytes(text: str) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.drawString(72, 720, text)
    c.showPage()
    c.save()
    return buf.getvalue()


def _make_docx_bytes(xml_content: str, *, extra_entry: tuple[str, bytes] | None = None) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types/>')
        zf.writestr("word/document.xml", xml_content.encode("utf-8"))
        if extra_entry is not None:
            zf.writestr(extra_entry[0], extra_entry[1])
    return buf.getvalue()


def _make_minimal_png_bytes() -> bytes:
    def _chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack("!I", len(data)) + tag + data + struct.pack("!I", crc)

    ihdr = struct.pack("!IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    raw_scanline = b"\x00\xff\xff\xff"
    idat = zlib.compress(raw_scanline)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", ihdr)
        + _chunk(b"IDAT", idat)
        + _chunk(b"IEND", b"")
    )


class _FakeWebSearchProvider:
    @property
    def is_configured(self) -> bool:
        return True

    def search(
        self, query: str, *, max_results: int, language: str
    ) -> list[dict[str, str]]:
        return [
            {
                "title": f"Guía SEP sobre {query}",
                "url": "https://es.wikipedia.org/wiki/Ciclo_del_agua",
                "snippet": "El ciclo hidrológico incluye evaporación y condensación.",
                "accessed_at": "2026-11-21T00:00:00+00:00",
            },
            {
                "title": "Enlace inseguro que debe filtrarse",
                "url": "http://insecure.example/test",
                "snippet": "No debe aparecer",
            },
            {
                "title": "Script que debe filtrarse",
                "url": "javascript:alert(1)",
                "snippet": "No debe aparecer",
            },
        ][:max_results]


def test_pdf_docx_png_upload_extraction_and_annex_generation(runtime_database):
    principal_id, scope_id = _seed_user(runtime_database)
    other_principal_id, _ = _seed_user(runtime_database)
    app = create_app()
    current_actor = [principal_id]
    app.dependency_overrides[require_actor] = lambda: current_actor[0]

    pdf_bytes = _make_pdf_bytes(
        "El ciclo del agua explica la evaporacion condensacion y precipitacion en la naturaleza."
    )
    docx_xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        "<w:body><w:p><w:r><w:t>Lectura sobre ecosistemas mexicanos y biodiversidad.</w:t></w:r></w:p></w:body>"
        "</w:document>"
    )
    docx_bytes = _make_docx_bytes(docx_xml)
    png_bytes = _make_minimal_png_bytes()

    with TestClient(app) as client:
        # 1. PDF upload + isolated extraction
        pdf_resp = client.post(
            f"/scopes/{scope_id}/documents",
            json={
                "filename": "guia_agua.pdf",
                "content_base64": base64.b64encode(pdf_bytes).decode("ascii"),
            },
        )
        assert pdf_resp.status_code == 201, pdf_resp.text
        pdf_doc = pdf_resp.json()
        assert pdf_doc["detected_mime"] == "application/pdf"
        assert pdf_doc["status"] == "ready"
        assert pdf_doc["page_count"] == 1
        assert "ciclo del agua" in (pdf_doc["extracted_text"] or "").lower()

        # 2. Generate editable annex from extracted document
        annex_resp = client.post(
            f"/scopes/{scope_id}/documents/{pdf_doc['id']}/generate-annex",
            json={
                "tool_id": "comprension-lectora",
                "subject": "Ciencias Naturales",
                "grade": "5° Primaria",
                "adaptation_mode": "lectura_facil",
            },
        )
        assert annex_resp.status_code == 201, annex_resp.text
        annex_data = annex_resp.json()
        assert annex_data["id"]
        assert annex_data["subject"] == "Ciencias Naturales"

        # 3. DOCX upload + isolated extraction
        docx_resp = client.post(
            f"/scopes/{scope_id}/documents",
            json={
                "filename": "ecosistemas.docx",
                "content_base64": base64.b64encode(docx_bytes).decode("ascii"),
            },
        )
        assert docx_resp.status_code == 201, docx_resp.text
        docx_doc = docx_resp.json()
        assert (
            docx_doc["detected_mime"]
            == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )
        assert docx_doc["status"] == "ready"
        assert "ecosistemas mexicanos" in (docx_doc["extracted_text"] or "").lower()

        # 4. PNG upload
        png_resp = client.post(
            f"/scopes/{scope_id}/documents",
            json={
                "filename": "diagrama.png",
                "content_base64": base64.b64encode(png_bytes).decode("ascii"),
            },
        )
        assert png_resp.status_code == 201, png_resp.text
        assert png_resp.json()["detected_mime"] == "image/png"

        # 5. List documents
        listed = client.get(f"/scopes/{scope_id}/documents")
        assert listed.status_code == 200
        assert len(listed.json()["items"]) == 3

        # 6. Cross-scope isolation
        current_actor[0] = other_principal_id
        assert client.get(f"/scopes/{scope_id}/documents").status_code == 404
        assert (
            client.get(f"/scopes/{scope_id}/documents/{pdf_doc['id']}").status_code
            == 404
        )
        assert (
            client.post(
                f"/scopes/{scope_id}/documents/{pdf_doc['id']}/revoke"
            ).status_code
            == 404
        )


def test_document_security_rejects_spoofed_traversal_and_xxe(runtime_database):
    principal_id, scope_id = _seed_user(runtime_database)
    app = create_app()
    app.dependency_overrides[require_actor] = lambda: principal_id

    with TestClient(app) as client:
        # Spoofed HTML pretending to be PDF
        spoofed = client.post(
            f"/scopes/{scope_id}/documents",
            json={
                "filename": "malicioso.pdf",
                "content_base64": base64.b64encode(
                    b"<html><script>alert(1)</script></html>"
                ).decode("ascii"),
            },
        )
        assert spoofed.status_code == 422

        # DOCX with zip path traversal entry
        traversal_zip = _make_docx_bytes(
            "<w:document/>", extra_entry=("../evil.txt", b"boom")
        )
        traversal_resp = client.post(
            f"/scopes/{scope_id}/documents",
            json={
                "filename": "traversal.docx",
                "content_base64": base64.b64encode(traversal_zip).decode("ascii"),
            },
        )
        assert traversal_resp.status_code == 422

        # DOCX with XXE DOCTYPE declaration -> isolated worker fails safely
        xxe_xml = (
            '<?xml version="1.0"?>'
            '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>'
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            "<w:body><w:p><w:r><w:t>&xxe;</w:t></w:r></w:p></w:body></w:document>"
        )
        xxe_zip = _make_docx_bytes(xxe_xml)
        xxe_resp = client.post(
            f"/scopes/{scope_id}/documents",
            json={
                "filename": "xxe.docx",
                "content_base64": base64.b64encode(xxe_zip).decode("ascii"),
            },
        )
        assert xxe_resp.status_code == 201
        xxe_doc = xxe_resp.json()
        assert xxe_doc["status"] == "failed"
        assert xxe_doc["extracted_text"] is None


def test_coherent_revocation_purge_and_backup_restore_non_revival(runtime_database):
    principal_id, scope_id = _seed_user(runtime_database)
    app = create_app()
    app.dependency_overrides[require_actor] = lambda: principal_id

    pdf_bytes = _make_pdf_bytes("Documento confidencial del docente para purgar.")

    with TestClient(app) as client:
        up = client.post(
            f"/scopes/{scope_id}/documents",
            json={
                "filename": "confidencial.pdf",
                "content_base64": base64.b64encode(pdf_bytes).decode("ascii"),
            },
        )
        assert up.status_code == 201
        doc_id = UUID(up.json()["id"])

        # Revoke & hard purge
        rev = client.post(f"/scopes/{scope_id}/documents/{doc_id}/revoke")
        assert rev.status_code == 200
        assert rev.json()["status"] == "revoked"
        assert rev.json()["revoked_at"] is not None
        assert rev.json()["text_preview"] == ""

        # Subsequent reads and annex generation fail with 410 document_revoked
        read_after = client.get(f"/scopes/{scope_id}/documents/{doc_id}")
        assert read_after.status_code == 410
        assert read_after.json()["detail"] == "document_revoked"

        gen_after = client.post(
            f"/scopes/{scope_id}/documents/{doc_id}/generate-annex",
            json={
                "tool_id": "comprension-lectora",
                "subject": "Español",
                "grade": "4° Primaria",
            },
        )
        assert gen_after.status_code == 410

    # Verify DB state: blob deleted, text nulled, tombstone written
    with Session(runtime_database) as db:
        assert db.get(DocumentBlob, doc_id) is None
        tomb = db.get(DocumentRevocationTombstone, doc_id)
        assert tomb is not None
        row = db.get(TeacherDocument, doc_id)
        assert row is not None
        assert row.status == "revoked"
        assert row.extracted_text is None

        # Simulate a stale backup restore attempting to revive the document & blob
        row.status = "ready"
        row.extracted_text = "contenido restaurado indebidamente"
        db.add(DocumentBlob(document_id=doc_id, scope_id=scope_id, content=pdf_bytes))
        db.commit()

        # Reconciler must enforce the tombstone and purge again
        reconciled = reconcile_revoked_documents(db)
        db.commit()
        assert reconciled >= 2
        assert db.get(DocumentBlob, doc_id) is None
        row_after = db.get(TeacherDocument, doc_id)
        assert row_after is not None
        assert row_after.status == "revoked"
        assert row_after.extracted_text is None


def test_cited_web_search_is_fail_closed_and_validates_https_citations(
    runtime_database, monkeypatch
):
    monkeypatch.delenv("AULALISTA_WEB_SEARCH_ENABLED", raising=False)
    principal_id, scope_id = _seed_user(runtime_database)

    # Default fail-closed
    app_default = create_app()
    app_default.dependency_overrides[require_actor] = lambda: principal_id
    with TestClient(app_default) as client:
        denied = client.post(
            f"/scopes/{scope_id}/web-search",
            json={"query": "ciclo del agua", "max_results": 3, "language": "es"},
        )
        assert denied.status_code == 503
        assert denied.json()["detail"] == "web_search_unavailable"

    # Configured provider filters out non-HTTPS links
    app_enabled = create_app(web_search_provider=_FakeWebSearchProvider())
    app_enabled.dependency_overrides[require_actor] = lambda: principal_id
    with TestClient(app_enabled) as client:
        ok = client.post(
            f"/scopes/{scope_id}/web-search",
            json={"query": "ciclo del agua", "max_results": 5, "language": "es"},
        )
        assert ok.status_code == 200
        body = ok.json()
        assert body["query"] == "ciclo del agua"
        assert len(body["citations"]) == 1
        assert body["citations"][0]["url"].startswith("https://")
        assert body["citations"][0]["domain"] == "es.wikipedia.org"
