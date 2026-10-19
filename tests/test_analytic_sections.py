"""Manual analytic sections are bounded data, never official curricular output."""

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from aulalista_api.analytic_sections import (
    AnalyticSectionData,
    AnalyticSectionEdit,
    DerivePlanningRequest,
)
from aulalista_api.app import create_app


def section_body(**changes):
    return {
        "contract_version": 1,
        "name": "El cuidado del agua en la comunidad",
        "grade": "3.º de primaria",
        "period": "Octubre · ejemplo de software",
        "context": {
            "text": "  Comunidad imaginaria sin datos de estudiantes.  ",
            "hypothetical": True,
        },
        "situation": "En una comunidad imaginaria se desperdicia agua.",
        "entries": [
            {
                "content": "Usos cotidianos del agua · aportación manual.",
                "pda": "Proponer acciones para cuidar el agua · aportación manual.",
            }
        ],
        "formative_field": "Campo escrito por el docente",
        "articulating_axes": ["Eje escrito por el docente"],
        "language": "es",
        "reference": None,
        **changes,
    }


def derive_body(**changes):
    return {
        "contract_version": 1,
        "subject": "Ciencias naturales",
        "duration_minutes": 50,
        "method": "active-learning",
        **changes,
    }


@pytest.mark.parametrize(
    "change",
    [
        {"contract_version": True},
        {"contract_version": 2},
        {"name": " "},
        {"name": "x" * 201},
        {"name": "nul\0"},
        {"name": "\ud800"},
        {"grade": ""},
        {"grade": "x" * 81},
        {"period": " "},
        {"period": "x" * 81},
        {"situation": ""},
        {"situation": "x" * 1001},
        {"situation": 1},
        {"context": {"text": "Hipótesis"}},
        {"context": {"text": "Hipótesis", "hypothetical": "true"}},
        {"context": {"text": "x" * 1001, "hypothetical": True}},
        {"entries": []},
        {"entries": [{"content": "x", "pda": "y"}] * 9},
        {"entries": [{"content": "x"}]},
        {"entries": [{"content": "x", "pda": " "}]},
        {"entries": [{"content": "x" * 501, "pda": "y"}]},
        {"entries": [{"content": "x", "pda": "y" * 501}]},
        {"entries": [{"content": "x", "pda": "y", "official": True}]},
        {"formative_field": ""},
        {"formative_field": "x" * 121},
        {"articulating_axes": ["x"] * 8},
        {"articulating_axes": ["x" * 81]},
        {"articulating_axes": [" "]},
        {"language": ""},
        {"language": "x" * 41},
        {"reference": {"source_id": str(uuid4()), "source_version": True}},
        {"reference": {"source_id": str(uuid4()), "source_version": 0}},
        {"reference": {"source_id": "invented", "source_version": 1}},
        {"provenance": "official"},
        {"actor_id": str(uuid4())},
        {"result": {"generated": True}},
    ],
)
def test_manual_section_rejects_invalid_or_authority_claiming_inputs(change):
    with pytest.raises(ValidationError):
        AnalyticSectionData.model_validate(section_body(**change))


@pytest.mark.parametrize("hypothetical", [False, True])
def test_section_preserves_manual_text_condition_and_all_content_pairs(hypothetical):
    body = section_body(
        context={"text": "  Contexto manual exacto.  ", "hypothetical": hypothetical},
        entries=[
            {"content": f" Contenido {index} ", "pda": f" PDA {index} "}
            for index in range(8)
        ],
    )
    assert AnalyticSectionData.model_validate(body).model_dump(mode="json") == body


def test_manual_section_has_no_implicit_reference_or_context():
    body = section_body()
    for field in [
        "context",
        "formative_field",
        "articulating_axes",
        "language",
        "reference",
    ]:
        del body[field]
    parsed = AnalyticSectionData.model_validate(body).model_dump(mode="json")
    assert parsed == dict(
        body,
        context=None,
        formative_field=None,
        articulating_axes=[],
        language="es",
        reference=None,
    )


@pytest.mark.parametrize("field", ["name", "grade", "period", "situation", "entries"])
def test_section_requires_each_core_field(field):
    body = section_body()
    del body[field]
    with pytest.raises(ValidationError):
        AnalyticSectionData.model_validate(body)


@pytest.mark.parametrize("expected", [True, 0, "1", 2_147_483_647])
def test_section_edit_requires_strict_positive_bounded_revision(expected):
    with pytest.raises(ValidationError):
        AnalyticSectionEdit.model_validate(
            {
                "contract_version": 1,
                "expected_revision": expected,
                "data": section_body(),
            }
        )


@pytest.mark.parametrize(
    "change",
    [
        {"contract_version": True},
        {"contract_version": 2},
        {"subject": " "},
        {"subject": "x" * 121},
        {"duration_minutes": True},
        {"duration_minutes": "50"},
        {"duration_minutes": 14},
        {"duration_minutes": 181},
        {"method": ""},
        {"method": "x" * 81},
        {"name": "Cannot replace origin"},
        {"context": {"text": "Cannot replace origin", "hypothetical": True}},
        {"reference": None},
        {"analytic_origin": {"revision": 9}},
    ],
)
def test_derivation_accepts_only_class_fields_without_origin_overrides(change):
    with pytest.raises(ValidationError):
        DerivePlanningRequest.model_validate(derive_body(**change))


def test_derivation_defaults_only_class_time_and_method():
    parsed = DerivePlanningRequest.model_validate(
        {"contract_version": 1, "subject": "Ciencias naturales"}
    )
    assert parsed.model_dump(mode="json") == derive_body()


def test_all_section_routes_fail_closed_without_identity():
    scope, section, key = uuid4(), uuid4(), uuid4()
    base = f"/scopes/{scope}/analytic-sections"
    with TestClient(create_app()) as client:
        client.headers.update(
            {"X-Actor-Id": str(uuid4()), "Authorization": "Bearer invented"}
        )
        for path in [
            base,
            f"{base}/{section}",
            f"{base}/{section}/revisions/1",
            f"/scopes/{scope}/analytic-section-operations/{key}",
        ]:
            denied = client.get(path)
            assert denied.status_code == 401
            assert denied.headers["cache-control"] == "no-store"
        for path, payload in [
            (base, section_body()),
            (
                f"{base}/{section}/revisions",
                {"contract_version": 1, "expected_revision": 1, "data": section_body()},
            ),
            (f"{base}/{section}/revisions/1/plannings", derive_body()),
        ]:
            denied = client.post(
                path, json=payload, headers={"Idempotency-Key": str(key)}
            )
            assert denied.status_code == 401
            assert denied.headers["cache-control"] == "no-store"
