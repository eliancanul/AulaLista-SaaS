"""Deterministic unit and PostgreSQL integration tests for annexes, PDFs, and Email Print."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfReader

from aulalista_api.app import create_app
from aulalista_api.auth_config import load_auth_settings
from aulalista_api.mail_sender import (
    FakeMailSender,
    build_epson_pdf_message,
)
from aulalista_api.material_routes import require_actor
from aulalista_api.openai_annex import (
    DEFAULT_OPENAI_MODEL,
    AnnexGenerationSpec,
    AnnexGeneratorError,
    DeterministicFakeAnnexGenerator,
    OpenAIAnnexGenerator,
    sanitize_print_text,
)
from aulalista_api.pdf_annex import (
    MAX_EPSON_PDF_BYTES,
    PdfGenerationError,
    clean_header_field_label,
    duplicate_pdf_copies,
    needs_drawing_box,
    render_annex_pdf,
    render_test_page_pdf,
    strip_leading_number,
)


def _sample_annex_doc() -> dict:
    return {
        "title": "Fracciones en la vida diaria",
        "subject": "Matemáticas",
        "grade": "4.º de primaria",
        "topic": "Fracciones equivalentes",
        "instructions": "Lee cada indicación y resuelve con lápiz.",
        "content": {
            "subtitle": "Matemáticas · 4.º de primaria",
            "student_header_fields": ["Nombre", "Fecha", "Grupo"],
            "sections": [
                {
                    "heading": "1. Lectura inicial",
                    "prompt": "Observa el ejemplo.",
                    "items": [
                        {
                            "kind": "reading",
                            "text": "Dos cuartos de pizza equivalen a la mitad de la pizza.",
                            "answer_lines": 0,
                        }
                    ],
                },
                {
                    "heading": "2. Ejercicios",
                    "prompt": "Contesta en las líneas.",
                    "items": [
                        {
                            "kind": "question",
                            "text": "¿Qué fracción es equivalente a 1/2?",
                            "answer_lines": 3,
                        },
                        {
                            "kind": "checklist",
                            "text": "Revisé mis operaciones antes de entregar.",
                            "answer_lines": 0,
                        },
                    ],
                },
            ],
            "footer_note": "AulaLista · Hoja imprimible",
        },
    }


def test_sanitize_strips_markdown_noise():
    raw = "## **Título** con `código`\n```markdown\n__Texto__ limpio\n```"
    assert sanitize_print_text(raw) == "Título con código\nTexto limpio"


def test_openai_annex_generator_uses_default_luna_and_parses_structured_output():
    seen = {}

    def fake_transport(url, payload):
        seen["url"] = url
        seen["payload"] = payload
        output_json = {
            "title": "**Fracciones** básicas",
            "instructions": "Contesta con claridad.",
            "content": {
                "subtitle": "Matemáticas · 4.º",
                "student_header_fields": ["Nombre", "Fecha", "Grupo"],
                "sections": [
                    {
                        "heading": "## 1. Preguntas",
                        "prompt": "Usa las líneas.",
                        "items": [
                            {
                                "kind": "question",
                                "text": "¿Cuánto es 1/2 + 1/2?",
                                "answer_lines": 2,
                            }
                        ],
                    }
                ],
                "footer_note": "AulaLista",
            },
        }
        response_body = {
            "status": "completed",
            "model": "gpt-6-luna-2026-10-18",
            "output": [
                {
                    "type": "message",
                    "role": "assistant",
                    "status": "completed",
                    "content": [
                        {"type": "output_text", "text": json.dumps(output_json)}
                    ],
                }
            ],
        }
        return 200, json.dumps(response_body).encode("utf-8")

    gen = OpenAIAnnexGenerator(api_key="sk-test-key", transport=fake_transport)
    result = gen.generate(
        AnnexGenerationSpec(
            subject="Matemáticas", grade="4.º de primaria", topic="Fracciones"
        )
    )
    assert seen["url"] == "https://api.openai.com/v1/responses"
    assert seen["payload"]["model"] == DEFAULT_OPENAI_MODEL
    assert seen["payload"]["text"]["format"]["type"] == "json_schema"
    assert result.provenance == "openai-annex-v1"
    assert result.model == "gpt-6-luna-2026-10-18"
    assert result.payload.title == "Fracciones básicas"
    assert result.payload.content.sections[0].heading == "1. Preguntas"


def test_openai_annex_generator_handles_errors():
    gen = OpenAIAnnexGenerator(
        api_key="sk-test-key",
        transport=lambda url, payload: (401, b"{}"),
    )
    with pytest.raises(AnnexGeneratorError) as exc:
        gen.generate(
            AnnexGenerationSpec(subject="Español", grade="3.º", topic="Cuento")
        )
    assert exc.value.code == "openai_authentication_error"


def test_pdf_render_us_letter_copies_and_epson_limit():
    single = render_annex_pdf(_sample_annex_doc(), copies=1)
    reader_single = PdfReader(BytesIO(single))
    base_pages = len(reader_single.pages)
    assert base_pages >= 1
    box = reader_single.pages[0].mediabox
    assert round(float(box.width)) == 612
    assert round(float(box.height)) == 792

    five_copies = render_annex_pdf(_sample_annex_doc(), copies=5)
    reader_five = PdfReader(BytesIO(five_copies))
    assert len(reader_five.pages) == base_pages * 5
    assert len(five_copies) < MAX_EPSON_PDF_BYTES

    thirty_five = render_annex_pdf(_sample_annex_doc(), copies=35)
    assert len(PdfReader(BytesIO(thirty_five)).pages) == base_pages * 35
    assert len(thirty_five) < MAX_EPSON_PDF_BYTES

    with pytest.raises(PdfGenerationError) as bad_copies:
        duplicate_pdf_copies(single, 0)
    assert bad_copies.value.code == "invalid_copies"

    with pytest.raises(PdfGenerationError) as too_many:
        duplicate_pdf_copies(single, 51)
    assert too_many.value.code == "invalid_copies"

    test_pdf = render_test_page_pdf(
        printer_email="impresora@print.epsonconnect.com",
        default_copies=28,
        default_print_time="06:30",
    )
    assert len(PdfReader(BytesIO(test_pdf)).pages) == 1


def test_editorial_pdf_normalization_drawing_box_spanish_and_pagination():
    assert clean_header_field_label("Nombre: __________") == "Nombre"
    assert clean_header_field_label("Fecha:____") == "Fecha"
    assert strip_leading_number("1. ¿Qué es el agua?") == "¿Qué es el agua?"
    assert strip_leading_number("2) Resuelve") == "Resuelve"
    assert needs_drawing_box("Dibuja el ciclo del agua en el recuadro.") is True
    assert needs_drawing_box("¿Cuánto es 1/2 + 1/2?") is False

    doc = {
        "title": "El ciclo del agua y la acción comunitaria (4.º)",
        "subject": "Ciencias naturales",
        "grade": "4.º de primaria",
        "topic": "Ciclo del agua",
        "instructions": "Lee con atención: ¡áéíóúñ¿¡üºª!",
        "content": {
            "subtitle": "Hoja de práctica escolar",
            "student_header_fields": ["Nombre: _______", "Fecha: ____", "Grupo: ___"],
            "sections": [
                {
                    "heading": "1. Lectura breve",
                    "prompt": "Subraya las palabras clave.",
                    "items": [
                        {
                            "kind": "reading",
                            "text": "El agua recorre ríos, nubes y montañas en un ciclo continuo.",
                            "answer_lines": 0,
                        }
                    ],
                },
                {
                    "heading": "2. Comprensión y dibujo",
                    "prompt": "Responde y realiza tu esquema.",
                    "items": [
                        {
                            "kind": "question",
                            "text": "1. ¿Por qué es importante cuidar el agua en la escuela?",
                            "answer_lines": 3,
                        },
                        {
                            "kind": "exercise",
                            "text": "2. Dibuja el ciclo del agua con flechas y etiquetas.",
                            "answer_lines": 4,
                        },
                        {
                            "kind": "checklist",
                            "text": "Escribí mi nombre completo y revisé la ortografía.",
                            "answer_lines": 0,
                        },
                    ],
                },
                {
                    "heading": "3. Práctica extendida",
                    "prompt": "Desarrolla tus respuestas.",
                    "items": [
                        {
                            "kind": "question",
                            "text": f"{i}. Explica una acción concreta #{i} para ahorrar agua en casa.",
                            "answer_lines": 5,
                        }
                        for i in range(1, 7)
                    ],
                },
            ],
            "footer_note": "AulaLista · Ciencias 4.º",
        },
    }

    single = render_annex_pdf(doc, copies=1)
    reader = PdfReader(BytesIO(single))
    total_pages = len(reader.pages)
    assert total_pages >= 2
    full_text = "\n".join(page.extract_text() or "" for page in reader.pages)

    # US Letter preserved on every page
    for page in reader.pages:
        assert round(float(page.mediabox.width)) == 612
        assert round(float(page.mediabox.height)) == 792

    # Cleaned header labels (no doubled colons/underscores) and no duplicate numbering
    assert "Nombre:" in full_text
    assert "Nombre: _______:" not in full_text
    assert "1. 1." not in full_text
    assert "2. 2." not in full_text

    # Smart drawing box caption present + Spanish Latin-1 glyphs intact
    assert "Espacio para dibujar / esquematizar" in full_text
    assert "¡áéíóúñ¿¡üºª!" in full_text

    # Accurate "Página X de Y" pagination on first and last page
    assert f"Página 1 de {total_pages}" in (reader.pages[0].extract_text() or "")
    assert f"Página {total_pages} de {total_pages}" in (
        reader.pages[-1].extract_text() or ""
    )

    # 25 copies duplicate accurately and stay far below Epson's 20 MB limit
    twenty_five = render_annex_pdf(doc, copies=25)
    reader_25 = PdfReader(BytesIO(twenty_five))
    assert len(reader_25.pages) == total_pages * 25
    assert len(twenty_five) < MAX_EPSON_PDF_BYTES

    # Non-drawing worksheet does NOT include the drawing caption
    plain_pdf = render_annex_pdf(_sample_annex_doc(), copies=1)
    plain_reader = PdfReader(BytesIO(plain_pdf))
    plain_text = "\n".join(p.extract_text() or "" for p in plain_reader.pages)
    assert "Espacio para dibujar / esquematizar" not in plain_text
    assert f"Página 1 de {len(plain_reader.pages)}" in plain_text


def test_epson_mime_message_has_empty_body_and_pdf_attachment():
    pdf = render_test_page_pdf(
        printer_email="l3250@print.epsonconnect.com",
        default_copies=25,
        default_print_time="06:30",
    )
    msg = build_epson_pdf_message(
        from_email="docente@gmail.com",
        to_email="l3250@print.epsonconnect.com",
        filename="anexo_prueba.pdf",
        pdf_bytes=pdf,
        subject="Prueba",
    )
    assert msg["To"] == "l3250@print.epsonconnect.com"
    assert msg["From"] == "docente@gmail.com"
    assert msg.is_multipart()
    parts = list(msg.iter_parts())
    assert len(parts) == 1
    assert parts[0].get_content_type() == "application/pdf"
    assert parts[0].get_filename() == "anexo_prueba.pdf"
    assert parts[0].get_payload(decode=True) == pdf


def test_allowed_emails_env_parsing(monkeypatch):
    monkeypatch.setenv("AULALISTA_AUTH_ORIGIN", "https://acenta.example.com")
    monkeypatch.setenv(
        "AULALISTA_AUTH_HMAC_KEY",
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    )
    monkeypatch.setenv(
        "AULALISTA_ALLOWED_EMAILS",
        "Mama@Gmail.com, papa@gmail.com ",
    )
    settings = load_auth_settings()
    assert settings is not None
    assert settings.allowed_emails == frozenset({"mama@gmail.com", "papa@gmail.com"})


def test_end_to_end_annex_generate_edit_approve_and_epson_print_queue(
    runtime_database, actors, monkeypatch
):
    (actor_a, scope_a), (actor_b, scope_b) = actors
    fake_gen = DeterministicFakeAnnexGenerator()
    fake_mail = FakeMailSender()
    monkeypatch.setenv("AULALISTA_PRINT_CRON_SECRET", "super-secret-cron")

    app = create_app(
        annex_generator=fake_gen,
        mail_sender=fake_mail,
        print_poller_seconds=0,
    )
    current_actor = {"id": actor_a}
    app.dependency_overrides[require_actor] = lambda: current_actor["id"]

    with TestClient(app) as client:
        # 1. Capability check
        cap = client.get(f"/scopes/{scope_a}/annex-capability")
        assert cap.status_code == 200
        assert cap.json()["available"] is True

        # 2. Generate annex with deterministic fake
        created = client.post(
            f"/scopes/{scope_a}/annexes/generate",
            json={
                "subject": "Ciencias naturales",
                "grade": "3.º de primaria",
                "topic": "El ciclo del agua",
                "annex_type": "hoja-de-trabajo",
                "language": "es",
            },
        )
        assert created.status_code == 201
        annex = created.json()
        annex_id = annex["id"]
        assert annex["status"] == "draft"
        assert annex["revision"] == 1
        assert len(fake_gen.calls) == 1

        # 3. Cross-scope isolation: teacher B gets 404
        current_actor["id"] = actor_b
        assert client.get(f"/scopes/{scope_a}/annexes/{annex_id}").status_code == 404
        assert client.get(f"/scopes/{scope_b}/annexes/{annex_id}").status_code == 404
        current_actor["id"] = actor_a

        # 4. Configure Epson printer settings
        saved_settings = client.put(
            f"/scopes/{scope_a}/print-settings",
            json={
                "printer_email": "papa.l3250@print.epsonconnect.com",
                "default_copies": 28,
                "default_print_time": "06:30",
                "timezone": "America/Mexico_City",
            },
        )
        assert saved_settings.status_code == 200
        assert (
            saved_settings.json()["printer_email"]
            == "papa.l3250@print.epsonconnect.com"
        )

        # 5. Send test page
        test_job = client.post(f"/scopes/{scope_a}/print-settings/test-page", json={})
        assert test_job.status_code == 201
        assert test_job.json()["status"] == "sent"
        assert test_job.json()["job_kind"] == "test_page"
        assert len(fake_mail.sent) == 1
        assert fake_mail.sent[0].to_email == "papa.l3250@print.epsonconnect.com"

        # 6. Draft annex cannot be printed before approval
        blocked = client.post(
            f"/scopes/{scope_a}/annexes/{annex_id}/print",
            json={"mode": "now", "copies": 3},
        )
        assert blocked.status_code == 409
        assert blocked.json()["detail"] == "annex_not_approved"

        # 7. Edit annex and approve
        edited_payload = {
            "title": "El ciclo del agua · Guía editada",
            "subject": annex["subject"],
            "grade": annex["grade"],
            "topic": annex["topic"],
            "instructions": "Responde con lápiz y colores.",
            "content": annex["content"],
        }
        updated = client.put(
            f"/scopes/{scope_a}/annexes/{annex_id}", json=edited_payload
        )
        assert updated.status_code == 200
        assert updated.json()["revision"] == 2
        assert updated.json()["status"] == "draft"

        approved = client.post(f"/scopes/{scope_a}/annexes/{annex_id}/approve")
        assert approved.status_code == 200
        assert approved.json()["status"] == "approved"
        assert approved.json()["approved_at"] is not None

        # 8. Download PDF with 3 copies
        pdf_resp = client.get(f"/scopes/{scope_a}/annexes/{annex_id}/pdf?copies=3")
        assert pdf_resp.status_code == 200
        assert pdf_resp.headers["content-type"] == "application/pdf"
        single_resp = client.get(f"/scopes/{scope_a}/annexes/{annex_id}/pdf?copies=1")
        assert len(PdfReader(BytesIO(pdf_resp.content)).pages) == 3 * len(
            PdfReader(BytesIO(single_resp.content)).pages
        )

        # 9. Print NOW with idempotency key (replay must NOT double-print)
        now_job = client.post(
            f"/scopes/{scope_a}/annexes/{annex_id}/print",
            json={"mode": "now", "copies": 4, "idempotency_key": "print-now-1"},
        )
        assert now_job.status_code == 201
        assert now_job.json()["status"] == "sent"
        assert now_job.json()["copies"] == 4
        assert len(fake_mail.sent) == 2

        replay = client.post(
            f"/scopes/{scope_a}/annexes/{annex_id}/print",
            json={"mode": "now", "copies": 4, "idempotency_key": "print-now-1"},
        )
        assert replay.status_code == 201
        assert replay.json()["id"] == now_job.json()["id"]
        assert len(fake_mail.sent) == 2  # No duplicate email!

        # 10. Schedule print job in the future + dispatch via cron endpoint
        future_time = (datetime.now(UTC) + timedelta(minutes=30)).isoformat()
        sched = client.post(
            f"/scopes/{scope_a}/annexes/{annex_id}/print",
            json={
                "mode": "scheduled",
                "copies": 2,
                "scheduled_for": future_time,
                "idempotency_key": "sched-1",
            },
        )
        assert sched.status_code == 201
        assert sched.json()["status"] == "pending"
        assert len(fake_mail.sent) == 2

        # Unauthorized cron rejected
        assert client.post("/internal/print-jobs/dispatch").status_code == 401

        # Cron before scheduled time claims 0 jobs
        before = client.post(
            "/internal/print-jobs/dispatch",
            headers={"X-Print-Cron-Secret": "super-secret-cron"},
        )
        assert before.status_code == 200
        assert before.json()["claimed"] == 0

        # Dispatch as_of after scheduled time sends exactly once
        after = app.state.print_jobs.dispatch_due_jobs(
            as_of=datetime.now(UTC) + timedelta(minutes=31)
        )
        assert after["claimed"] == 1
        assert after["sent"] == 1
        assert len(fake_mail.sent) == 3

        # Re-running dispatch claims 0 (idempotent)
        again = app.state.print_jobs.dispatch_due_jobs(
            as_of=datetime.now(UTC) + timedelta(minutes=32)
        )
        assert again["claimed"] == 0
        assert len(fake_mail.sent) == 3

        # 11. Failure + Retry flow
        fake_mail.fail_with = "smtp_send_failed"
        failed_job = client.post(
            f"/scopes/{scope_a}/annexes/{annex_id}/print",
            json={"mode": "now", "copies": 1, "idempotency_key": "fail-1"},
        )
        assert failed_job.status_code == 201
        assert failed_job.json()["status"] == "failed"
        assert failed_job.json()["last_error"] == "smtp_send_failed"

        fake_mail.fail_with = None
        retried = client.post(
            f"/scopes/{scope_a}/print-jobs/{failed_job.json()['id']}/retry"
        )
        assert retried.status_code == 200
        assert retried.json()["status"] == "sent"
        assert len(fake_mail.sent) == 4

        # 12. Cancel pending job
        cancel_sched = client.post(
            f"/scopes/{scope_a}/annexes/{annex_id}/print",
            json={
                "mode": "scheduled",
                "copies": 1,
                "scheduled_for": future_time,
                "idempotency_key": "cancel-1",
            },
        )
        cancelled = client.post(
            f"/scopes/{scope_a}/print-jobs/{cancel_sched.json()['id']}/cancel"
        )
        assert cancelled.status_code == 200
        assert cancelled.json()["status"] == "cancelled"

        # 13. Editing an approved annex resets approval back to draft
        re_edited = client.put(
            f"/scopes/{scope_a}/annexes/{annex_id}", json=edited_payload
        )
        assert re_edited.status_code == 200
        assert re_edited.json()["status"] == "draft"
        assert re_edited.json()["approved_at"] is None

        # 14. Delete single print job & clear print queue (protecting active sending jobs)
        # Re-approve so we can enqueue one more failed job and one sending job
        assert (
            client.post(f"/scopes/{scope_a}/annexes/{annex_id}/approve").status_code
            == 200
        )
        fake_mail.fail_with = "smtp_send_failed"
        del_fail_1 = client.post(
            f"/scopes/{scope_a}/annexes/{annex_id}/print",
            json={"mode": "now", "copies": 1, "idempotency_key": "del-fail-1"},
        )
        del_fail_2 = client.post(
            f"/scopes/{scope_a}/annexes/{annex_id}/print",
            json={"mode": "now", "copies": 1, "idempotency_key": "del-fail-2"},
        )
        fake_mail.fail_with = None
        assert del_fail_1.json()["status"] == "failed"
        assert del_fail_2.json()["status"] == "failed"

        # Another scope cannot delete scope_a's job
        current_actor["id"] = actor_b
        assert (
            client.delete(
                f"/scopes/{scope_a}/print-jobs/{del_fail_1.json()['id']}"
            ).status_code
            == 404
        )
        current_actor["id"] = actor_a

        # Delete single job succeeds
        del_one = client.delete(
            f"/scopes/{scope_a}/print-jobs/{del_fail_1.json()['id']}"
        )
        assert del_one.status_code == 204
        assert (
            client.delete(
                f"/scopes/{scope_a}/print-jobs/{del_fail_1.json()['id']}"
            ).status_code
            == 404
        )

        # Clear only failed jobs keeps sent/cancelled jobs
        clear_failed = client.delete(f"/scopes/{scope_a}/print-jobs?status=failed")
        assert clear_failed.status_code == 200
        assert clear_failed.json() == {"deleted": 1, "skipped_sending": 0}
        remaining_after_failed = client.get(f"/scopes/{scope_a}/print-jobs").json()[
            "items"
        ]
        assert len(remaining_after_failed) >= 3
        assert all(j["status"] != "failed" for j in remaining_after_failed)

        # Mark one job as 'sending' directly in DB to verify active-sending protection
        from sqlalchemy import update as sa_update
        from sqlalchemy.orm import Session

        from aulalista_api.print_jobs import PrintJob

        sending_id = remaining_after_failed[0]["id"]
        with Session(app.state.print_jobs.engine) as session:
            session.execute(
                sa_update(PrintJob)
                .where(PrintJob.id == sending_id)
                .values(status="sending", sent_at=None)
            )
            session.commit()

        blocked_sending = client.delete(f"/scopes/{scope_a}/print-jobs/{sending_id}")
        assert blocked_sending.status_code == 409
        assert blocked_sending.json()["detail"] == "print_job_sending"

        # Clear entire queue deletes everything except the sending job
        clear_all = client.delete(f"/scopes/{scope_a}/print-jobs")
        assert clear_all.status_code == 200
        assert clear_all.json()["skipped_sending"] == 1
        assert clear_all.json()["deleted"] == len(remaining_after_failed) - 1
        final_jobs = client.get(f"/scopes/{scope_a}/print-jobs").json()["items"]
        assert [j["id"] for j in final_jobs] == [sending_id]

        # Invalid status filter returns 422
        assert (
            client.delete(f"/scopes/{scope_a}/print-jobs?status=bogus").status_code
            == 422
        )
