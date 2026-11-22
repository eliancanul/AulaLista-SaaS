"""Integration tests for SEP/NEM curricular context, rich tables, and annex revision history."""

from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from aulalista_api.app import create_app
from aulalista_api.database import PersonalScope, Principal
from aulalista_api.material_routes import require_actor
from aulalista_api.openai_agent_chat import FakeAgentChatProvider


def _seed_user(engine):
    with Session(engine) as db:
        principal = Principal(id=uuid4())
        db.add(principal)
        db.flush()
        scope = PersonalScope(id=uuid4(), owner_principal_id=principal.id)
        db.add(scope)
        db.commit()
        return principal.id, scope.id


def test_curriculum_catalog_profile_and_agent_injection(runtime_database):
    principal_id, scope_id = _seed_user(runtime_database)
    other_principal_id, _ = _seed_user(runtime_database)
    fake_provider = FakeAgentChatProvider()

    app = create_app(agent_chat_provider=fake_provider)
    current_actor = [principal_id]
    app.dependency_overrides[require_actor] = lambda: current_actor[0]

    with TestClient(app) as client:
        catalog = client.get(f"/scopes/{scope_id}/curriculum/catalog")
        assert catalog.status_code == 200
        data = catalog.json()
        assert len(data["phases"]) == 4
        assert len(data["campos_formativos"]) == 4
        assert len(data["ejes_articuladores"]) == 7

        upsert = client.put(
            f"/scopes/{scope_id}/curriculum/profiles/escuela-1/mate",
            json={
                "phase": "Fase 4",
                "grade": "4° Primaria",
                "campo_formativo": "Saberes y Pensamiento Científico",
                "ejes_articuladores": ["Pensamiento crítico", "Vida saludable"],
                "pdas": [
                    {
                        "id": "nem-f4-sab-01",
                        "code": "F4-SAB-01",
                        "title": "Fracciones equivalentes y comparación",
                        "description": "Resuelve situaciones problemáticas vinculadas a fracciones equivalentes.",
                    }
                ],
                "notes": "Grupo participativo de 28 estudiantes.",
            },
        )
        assert upsert.status_code == 200
        saved = upsert.json()
        assert saved["phase"] == "Fase 4"
        assert saved["campo_formativo"] == "Saberes y Pensamiento Científico"
        assert saved["ejes_articuladores"] == ["Pensamiento crítico", "Vida saludable"]

        listed = client.get(f"/scopes/{scope_id}/curriculum/profiles")
        assert listed.status_code == 200
        assert len(listed.json()["items"]) == 1

        # Cross-scope isolation must return 404
        current_actor[0] = other_principal_id
        assert client.get(f"/scopes/{scope_id}/curriculum/profiles").status_code == 404
        current_actor[0] = principal_id

        # Agent chat prompt receives the persisted SEP/NEM curricular context
        turn = client.post(
            f"/scopes/{scope_id}/agent-chat/channels/subject:escuela-1:mate/turns",
            headers={"Idempotency-Key": str(uuid4())},
            json={
                "text": "Dame una actividad corta de fracciones",
                "agent_kind": "subject",
                "school_id": "escuela-1",
                "school_name": "Primaria Juárez",
                "subject_id": "mate",
                "subject_name": "Matemáticas",
                "grade": "4° Primaria",
            },
        )
        assert turn.status_code == 201
        assert len(fake_provider.calls) == 1
        ctx = fake_provider.calls[0][0]
        assert "Fase 4" in ctx.context_notes
        assert "Saberes y Pensamiento Científico" in ctx.context_notes
        assert "Pensamiento crítico" in ctx.context_notes
        assert "Fracciones equivalentes" in ctx.context_notes


def test_annex_rich_tables_teacher_key_pdf_and_revision_restore(runtime_database):
    principal_id, scope_id = _seed_user(runtime_database)
    other_principal_id, _ = _seed_user(runtime_database)

    app = create_app()
    current_actor = [principal_id]
    app.dependency_overrides[require_actor] = lambda: current_actor[0]

    with TestClient(app) as client:
        create = client.post(
            f"/scopes/{scope_id}/annexes",
            json={
                "title": "Rúbrica de fracciones v1",
                "subject": "Matemáticas",
                "grade": "4° Primaria",
                "topic": "Fracciones equivalentes",
                "instructions": "Completa la tabla y responde.",
                "content": {
                    "subtitle": "Actividad guiada NEM",
                    "student_header_fields": ["Nombre", "Fecha", "Grupo"],
                    "curricular_trace": {
                        "phase": "Fase 4 (3° y 4° Primaria)",
                        "campo_formativo": "Saberes y Pensamiento Científico",
                    },
                    "teacher_key": [
                        "1/2 equivale a 2/4 y 4/8.",
                        "Criterio destacado: explica con dibujo y operación.",
                    ],
                    "sections": [
                        {
                            "heading": "1. Tabla de equivalencias",
                            "prompt": "Completa los espacios.",
                            "bullets": ["Usa dibujos si lo necesitas."],
                            "table": {
                                "headers": ["Fracción", "Equivalente", "Dibujo"],
                                "rows": [
                                    ["1/2", "2/4", ""],
                                    ["2/3", "4/6", ""],
                                ],
                            },
                            "items": [
                                {
                                    "kind": "question",
                                    "text": "¿Por qué 1/2 y 2/4 representan lo mismo?",
                                    "answer_lines": 2,
                                }
                            ],
                        }
                    ],
                    "footer_note": "AulaLista · 4° Primaria",
                },
            },
        )
        assert create.status_code == 201
        annex = create.json()
        annex_id = annex["id"]
        assert annex["revision"] == 1
        assert annex["content"]["sections"][0]["table"]["headers"] == [
            "Fracción",
            "Equivalente",
            "Dibujo",
        ]

        # PDF renders with table + separate teacher key page
        pdf = client.get(f"/scopes/{scope_id}/annexes/{annex_id}/pdf")
        assert pdf.status_code == 200
        assert pdf.content.startswith(b"%PDF")
        assert len(pdf.content) > 1500

        # Update to create revision 2
        upd = client.put(
            f"/scopes/{scope_id}/annexes/{annex_id}",
            json={
                "title": "Rúbrica de fracciones v2",
                "subject": "Matemáticas",
                "grade": "4° Primaria",
                "topic": "Fracciones equivalentes",
                "instructions": "Instrucciones actualizadas.",
                "content": annex["content"],
            },
        )
        assert upd.status_code == 200
        assert upd.json()["revision"] == 2
        assert upd.json()["title"] == "Rúbrica de fracciones v2"

        # List revisions -> should have Rev 2 and Rev 1
        revs = client.get(f"/scopes/{scope_id}/annexes/{annex_id}/revisions")
        assert revs.status_code == 200
        rev_items = revs.json()["items"]
        assert [r["revision"] for r in rev_items] == [2, 1]

        # Restore Rev 1 -> becomes Rev 3 with Rev 1's title
        restored = client.post(
            f"/scopes/{scope_id}/annexes/{annex_id}/revisions/1/restore"
        )
        assert restored.status_code == 200
        restored_doc = restored.json()
        assert restored_doc["revision"] == 3
        assert restored_doc["title"] == "Rúbrica de fracciones v1"

        revs_after = client.get(f"/scopes/{scope_id}/annexes/{annex_id}/revisions")
        assert [r["revision"] for r in revs_after.json()["items"]] == [3, 2, 1]

        # Cross-scope isolation on revisions returns 404
        current_actor[0] = other_principal_id
        assert (
            client.get(f"/scopes/{scope_id}/annexes/{annex_id}/revisions").status_code
            == 404
        )
