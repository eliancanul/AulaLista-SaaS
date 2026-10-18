"""Bounded software fixture contract; no curricular or classroom evaluation."""

from copy import deepcopy

import pytest
from pydantic import ValidationError

from aulalista_api.guided_planning import GuidedPlanningRequest, generate_guided
from aulalista_api.materials import MaterialError
from aulalista_api.planning_edits import EditRequest, edited_result
from aulalista_api.planning_result import RESULT_ADAPTER
from aulalista_api.plannings import PlanningRevision


def guided_body(**changes):
    return {
        "contract_version": 2,
        "fixture_context": "guided-water-v1",
        "subject": "Ciencias naturales",
        "grade": "3.º de primaria",
        "topic": "El cuidado del agua en la comunidad",
        "duration_minutes": 50,
        "method": "active-learning",
        "language": "es",
        "context": {
            "text": "Situación de ejemplo sin datos de estudiantes.",
            "hypothetical": True,
        },
        "learning_objectives": ["Proponer acciones cotidianas de cuidado del agua."],
        "formative_field": "Aportación manual de ejemplo",
        "articulating_axes": ["Eje escrito por el docente"],
        "reference": None,
        **changes,
    }


def result(**changes):
    return generate_guided(GuidedPlanningRequest.model_validate(guided_body(**changes)))


@pytest.mark.parametrize("duration", [15, 30, 50, 73, 100, 120, 150, 180])
def test_fixture_duration_is_explicit_coherent_and_deterministic(duration):
    first = result(duration_minutes=duration)
    assert first == result(duration_minutes=duration)
    assert first["kind"] == "guided-planning-v1"
    assert first["provenance"] == "synthetic-fixture-v1"
    assert first["duration_minutes"] == duration
    assert sum(item["minutes"] for item in first["activities"]) == duration
    assert all(
        item["minutes"] > 0 and item["statement"] for item in first["activities"]
    )
    assert first["purpose"] and first["formative_assessment"] and first["materials"]
    assert "ejemplo" in first["notice"].lower()
    assert "curricular" in first["notice"]
    assert "resources" not in first
    assert RESULT_ADAPTER.validate_python(first) == first
    first["activities"].clear()
    assert len(result()["activities"]) == 3


@pytest.mark.parametrize(
    "change",
    [
        {"contract_version": 1},
        {"contract_version": True},
        {"fixture_context": "universal"},
        {"subject": " "},
        {"grade": ""},
        {"topic": "x" * 201},
        {"topic": "nul\0"},
        {"topic": "\ud800"},
        {"duration_minutes": 14},
        {"duration_minutes": 181},
        {"duration_minutes": True},
        {"duration_minutes": "50"},
        {"method": 1},
        {"language": ""},
        {"context": {"text": "Hipótesis"}},
        {"context": {"text": "Hipótesis", "hypothetical": "true"}},
        {"context": {"text": " ", "hypothetical": True}},
        {"context": {"text": "x" * 1001, "hypothetical": True}},
        {"learning_objectives": [" "]},
        {"learning_objectives": ["x"] * 6},
        {"formative_field": ""},
        {"articulating_axes": ["x"] * 8},
        {"reference": {"source_id": "invented", "source_version": 1}},
        {
            "reference": {
                "source_id": "00000000-0000-0000-0000-000000000001",
                "source_version": True,
            }
        },
        {"source_id": "invented"},
        {"official_alignment": True},
    ],
)
def test_guided_request_rejects_invalid_and_untrusted_fields(change):
    with pytest.raises(ValidationError):
        GuidedPlanningRequest.model_validate(guided_body(**change))


@pytest.mark.parametrize(
    "change",
    [
        {"subject": "Matemáticas"},
        {"grade": "4.º de primaria"},
        {"topic": "El ciclo del agua"},
        {"method": "lecture"},
        {"language": "en"},
    ],
)
def test_valid_but_unrecognized_combinations_never_generate(change):
    with pytest.raises(ValueError, match="unsupported_fixture"):
        result(**change)


def test_manual_context_is_exact_separate_and_not_claimed_as_applied():
    body = guided_body()
    parsed = GuidedPlanningRequest.model_validate(body)
    assert parsed.model_dump(mode="json") == body
    assert (
        parsed.canonical()
        == GuidedPlanningRequest.model_validate(
            dict(reversed(list(body.items())))
        ).canonical()
    )
    # Manual inputs are preserved for the teacher, not interpreted by the fixture.
    assert result() == result(
        context=None, learning_objectives=[], formative_field=None, articulating_axes=[]
    )
    assert "manual" in result()["notice"].lower()


@pytest.mark.parametrize(
    "field",
    ["purpose", "formative_assessment", "materials", "duration_minutes", "kind"],
)
def test_guided_result_requires_complete_new_contract(field):
    incomplete = result()
    del incomplete[field]
    with pytest.raises(ValidationError):
        RESULT_ADAPTER.validate_python(incomplete)


@pytest.mark.parametrize(
    "change",
    [
        {"purpose": " "},
        {"formative_assessment": ""},
        {"materials": []},
        {"materials": [" "]},
        {"activities": []},
        {"duration_minutes": 49},
    ],
)
def test_guided_result_rejects_empty_or_incoherent_output(change):
    with pytest.raises(ValidationError):
        RESULT_ADAPTER.validate_python(dict(result(), **change))


@pytest.mark.parametrize(
    "resource,element,text,path",
    [
        ("planning", "purpose", "Propósito corregido.", ("purpose",)),
        (
            "planning",
            "formative_assessment",
            "Evaluación corregida.",
            ("formative_assessment",),
        ),
        ("planning", "material-0", "Hojas reutilizadas.", ("materials", 0)),
        (
            "activity:introduction",
            "statement",
            "Actividad corregida.",
            ("activities", 0, "statement"),
        ),
        ("activity:exploration", "minutes", "45", ("activities", 1, "minutes")),
    ],
)
def test_virtual_targets_edit_one_canonical_value(resource, element, text, path):
    base = PlanningRevision(result=result())
    before = deepcopy(base.result)
    request = EditRequest(
        contract_version=1,
        expected_revision=1,
        resource_key=resource,
        element_key=element,
        text=text,
    )
    edited = edited_result(base, request)
    target = edited
    for key in path:
        target = target[key]
    assert target == (int(text) if element == "minutes" else text)
    assert base.result == before
    assert edited["duration_minutes"] == sum(a["minutes"] for a in edited["activities"])
    assert RESULT_ADAPTER.validate_python(edited) == edited


@pytest.mark.parametrize(
    "resource,element,text",
    [
        ("planning", "kind", "changed"),
        ("planning", "material-01", "x"),
        ("planning", "material-99", "x"),
        ("planning", "topic", "x"),
        ("activity:missing", "statement", "x"),
        ("activity:introduction", "title", "x"),
        ("activity:introduction", "minutes", "0"),
        ("activity:introduction", "minutes", "181"),
        ("activity:introduction", "minutes", "01"),
        ("activity:introduction", "minutes", "1.5"),
        ("activity:introduction", "minutes", " 1"),
        ("activity:introduction", "minutes", "١"),
    ],
)
def test_virtual_targets_are_allowlisted_and_minutes_strict(resource, element, text):
    with pytest.raises(MaterialError) as denied:
        edited_result(
            PlanningRevision(result=result()),
            EditRequest(
                contract_version=1,
                expected_revision=1,
                resource_key=resource,
                element_key=element,
                text=text,
            ),
        )
    assert denied.value.status == 422


@pytest.mark.parametrize("hypothetical", [False, True])
def test_manual_context_condition_is_explicit_and_preserved(hypothetical):
    context = {"text": "  Contexto manual conservado.  ", "hypothetical": hypothetical}
    parsed = GuidedPlanningRequest.model_validate(guided_body(context=context))
    assert parsed.model_dump(mode="json")["context"] == context


def test_multiple_edits_cannot_overflow_result_budget():
    base = PlanningRevision(result=result())
    request = EditRequest(
        contract_version=1,
        expected_revision=1,
        resource_key="planning",
        element_key="purpose",
        text="🧪" * 1000,
    )
    base.result = edited_result(base, request)
    request.element_key = "formative_assessment"
    with pytest.raises(MaterialError) as denied:
        edited_result(base, request)
    assert denied.value.status == 413
