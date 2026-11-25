"""Tests for all 11 printable and projectable didactic tools (#86-#96)."""

from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from aulalista_api.app import create_app
from aulalista_api.database import PersonalScope, Principal
from aulalista_api.didactic_generators import DIDACTIC_TOOLS_CATALOG
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


ALL_TOOL_IDS = [item["id"] for item in DIDACTIC_TOOLS_CATALOG]


def test_didactic_tools_catalog_and_all_11_tools_generate_printable_pdf(
    runtime_database,
):
    principal_id, scope_id = _seed_user(runtime_database)
    other_principal_id, _ = _seed_user(runtime_database)
    app = create_app()
    current_actor = [principal_id]
    app.dependency_overrides[require_actor] = lambda: current_actor[0]

    with TestClient(app) as client:
        cat = client.get(f"/scopes/{scope_id}/annexes/tools")
        assert cat.status_code == 200
        assert len(cat.json()["items"]) == 11

        # Cross-scope isolation
        current_actor[0] = other_principal_id
        assert client.get(f"/scopes/{scope_id}/annexes/tools").status_code == 404
        current_actor[0] = principal_id

        for tool_id in ALL_TOOL_IDS:
            resp = client.post(
                f"/scopes/{scope_id}/annexes/tools/generate",
                json={
                    "tool_id": tool_id,
                    "subject": "Ciencias Naturales",
                    "grade": "5° Primaria",
                    "topic": "Ciclo del agua",
                    "terms": [
                        "Evaporación",
                        "Condensación",
                        "Precipitación",
                        "Nubes",
                        "Lluvia",
                        "Océano",
                        "Vapor",
                        "Río",
                        "Hielo",
                        "Infiltración",
                        "Manantial",
                        "Acuífero",
                    ],
                    "seed": 4242,
                    "board_count": 6,
                },
            )
            assert resp.status_code == 201, f"Failed for {tool_id}: {resp.text}"
            doc = resp.json()
            assert doc["content"]["tool_kind"] == tool_id
            assert doc["revision"] == 1
            assert len(doc["content"]["teacher_key"]) >= 1

            # Every generated didactic tool must produce a valid Carta PDF
            pdf = client.get(f"/scopes/{scope_id}/annexes/{doc['id']}/pdf")
            assert pdf.status_code == 200
            assert pdf.content.startswith(b"%PDF")
            assert len(pdf.content) > 1200


@pytest.mark.parametrize("seed", [101, 2026])
def test_wordsearch_and_bingo_are_seed_deterministic_with_unique_boards(
    runtime_database, seed
):
    principal_id, scope_id = _seed_user(runtime_database)
    app = create_app()
    app.dependency_overrides[require_actor] = lambda: principal_id

    payload_base = {
        "subject": "Matemáticas",
        "grade": "4° Primaria",
        "topic": "Fracciones y decimales",
        "terms": [
            "Fracción",
            "Numerador",
            "Denominador",
            "Decimal",
            "Entero",
            "Mitad",
            "Cuarto",
            "Tercio",
            "Equivalente",
            "Suma",
            "Resta",
            "Cociente",
            "Residuo",
            "Porcentaje",
            "Gráfica",
            "Unidad",
        ],
        "seed": seed,
        "board_count": 8,
    }

    with TestClient(app) as client:
        ws1 = client.post(
            f"/scopes/{scope_id}/annexes/tools/generate",
            json={**payload_base, "tool_id": "sopa-de-letras"},
        ).json()
        ws2 = client.post(
            f"/scopes/{scope_id}/annexes/tools/generate",
            json={**payload_base, "tool_id": "sopa-de-letras"},
        ).json()
        assert (
            ws1["content"]["metadata"]["wordsearch"]
            == ws2["content"]["metadata"]["wordsearch"]
        )
        assert len(ws1["content"]["metadata"]["wordsearch"]["placements"]) >= 5

        b1 = client.post(
            f"/scopes/{scope_id}/annexes/tools/generate",
            json={**payload_base, "tool_id": "bingo-tematico"},
        ).json()
        b2 = client.post(
            f"/scopes/{scope_id}/annexes/tools/generate",
            json={**payload_base, "tool_id": "bingo-tematico"},
        ).json()
        boards1 = b1["content"]["metadata"]["bingo"]["boards"]
        boards2 = b2["content"]["metadata"]["bingo"]["boards"]
        assert boards1 == boards2
        assert len(boards1) == 8
        # Every board has a distinct signature
        signatures = {
            tuple(cell for row in board["cells"] for cell in row) for board in boards1
        }
        assert len(signatures) == 8


def test_adapt_annex_preserves_original_intact(runtime_database):
    principal_id, scope_id = _seed_user(runtime_database)
    app = create_app()
    app.dependency_overrides[require_actor] = lambda: principal_id

    with TestClient(app) as client:
        orig = client.post(
            f"/scopes/{scope_id}/annexes/tools/generate",
            json={
                "tool_id": "comprension-lectora",
                "subject": "Español",
                "grade": "3° Primaria",
                "topic": "Las fábulas",
            },
        ).json()
        adapted = client.post(
            f"/scopes/{scope_id}/annexes/{orig['id']}/adapt",
            json={"adaptation_mode": "lectura_facil", "target_grade": "2° Primaria"},
        )
        assert adapted.status_code == 201
        adapted_doc = adapted.json()
        assert adapted_doc["id"] != orig["id"]
        assert adapted_doc["grade"] == "2° Primaria"
        assert adapted_doc["content"]["metadata"]["adapted_from_annex_id"] == orig["id"]

        # Original remains completely untouched
        orig_after = client.get(f"/scopes/{scope_id}/annexes/{orig['id']}").json()
        assert orig_after["title"] == orig["title"]
        assert orig_after["grade"] == "3° Primaria"
        assert orig_after["revision"] == 1
