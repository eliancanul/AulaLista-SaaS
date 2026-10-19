"""Software contract only; fixtures never leave the test process."""

from copy import deepcopy

import pytest
from pydantic import ValidationError
from test_guided_planning import guided_body

from aulalista_api.guided_planning import GeneratedPlanningRequest
from aulalista_api.planning_result import OUTPUT_SCHEMA, validate_generated_output


def generated_body(**changes):
    body = guided_body()
    del body["fixture_context"]
    return {**body, "contract_version": 3, **changes}


def provider_output():
    return {
        "title": "Software test output",
        "purpose": "Contract validation only.",
        "formative_assessment": "No educational evaluation.",
        "duration_minutes": 50,
        "materials": ["Software fixture"],
        "activities": [
            {"key": key, "title": key, "statement": "Fixture", "minutes": minutes}
            for key, minutes in (
                ("introduction", 10),
                ("exploration", 30),
                ("closure", 10),
            )
        ],
    }


def test_generated_request_has_own_version_and_no_fixture_selector():
    request = GeneratedPlanningRequest.model_validate(
        generated_body(topic="Manual topic")
    )
    assert request.contract_version == 3
    assert b"fixture_context" not in request.canonical()
    for body in (
        guided_body(),
        generated_body(fixture_context="guided-water-v1"),
        generated_body(contract_version=3.0),
    ):
        with pytest.raises(ValidationError):
            GeneratedPlanningRequest.model_validate(body)


def test_provider_cannot_choose_provenance_and_duration_is_exact():
    raw = provider_output()
    original = deepcopy(raw)
    result = validate_generated_output(raw, 50)
    assert raw == original
    assert result["provenance"] == "openai-guided-v1"
    assert result["kind"] == "guided-planning-v1"
    assert "automáticamente" in result["notice"]
    assert OUTPUT_SCHEMA["additionalProperties"] is False
    assert set(OUTPUT_SCHEMA["required"]) == set(raw)
    with pytest.raises(ValueError):
        validate_generated_output(raw, 60)
    for field in ("provenance", "notice", "kind", "private_note"):
        with pytest.raises(ValidationError):
            validate_generated_output({**raw, field: "untrusted"}, 50)


@pytest.mark.parametrize("field", ["purpose", "formative_assessment", "statement"])
def test_generated_editable_fields_fit_b3_and_provider_schema(field):
    raw = provider_output()
    target = raw["activities"][0] if field == "statement" else raw
    target[field] = "á" * 1000
    assert validate_generated_output(raw, 50)
    target[field] += "á"
    with pytest.raises(ValidationError):
        validate_generated_output(raw, 50)
    properties = (
        OUTPUT_SCHEMA["$defs"]["GeneratedActivity"]["properties"]
        if field == "statement"
        else OUTPUT_SCHEMA["properties"]
    )
    assert properties[field]["maxLength"] == 1000


@pytest.mark.parametrize("change", ["order", "sum", "type", "empty", "material"])
def test_provider_output_rejects_invalid_structure_without_repair(change):
    raw = provider_output()
    if change == "order":
        raw["activities"].reverse()
    elif change == "sum":
        raw["activities"][0]["minutes"] = 11
    elif change == "type":
        raw["activities"][0]["minutes"] = "10"
    elif change == "empty":
        raw["purpose"] = " "
    else:
        raw["materials"] = []
    with pytest.raises(ValueError):
        validate_generated_output(raw, 50)
