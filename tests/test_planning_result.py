"""Contract checks on existing software fixtures, not educational evaluation."""

import json
from copy import deepcopy
from pathlib import Path

import pytest
from pydantic import ValidationError

from aulalista_api import planning_fixture, water_fixture
from aulalista_api.planning_result import RESULT_ADAPTER


def existing_result():
    return water_fixture.generate(
        water_fixture.SUPPORTED_PROMPT, water_fixture.FIXTURE_SOURCE
    )


def test_existing_results_round_trip_without_new_fields():
    results = [
        existing_result(),
        planning_fixture.generate(
            "timing-example-v1",
            planning_fixture.SUPPORTED_PROMPT,
            planning_fixture.FIXTURE_SOURCE,
        ),
    ]
    for result in results:
        before = deepcopy(result)
        assert RESULT_ADAPTER.validate_python(result) == before
        assert result == before
        assert RESULT_ADAPTER.validate_json(RESULT_ADAPTER.dump_json(result)) == before


def test_existing_web_contract_examples_remain_valid():
    examples = json.loads(Path("web/tests/acenta-contract-examples.json").read_text())
    for operation in ("create", "edit", "copy", "draft"):
        result = examples[operation]["result"]
        assert RESULT_ADAPTER.validate_python(result) == result


@pytest.mark.parametrize("minutes", [True, "5", 5.5, -1, None])
def test_rejects_invalid_minutes_without_coercion(minutes):
    result = existing_result()
    result["activities"][0]["minutes"] = minutes
    with pytest.raises(ValidationError):
        RESULT_ADAPTER.validate_python(result)


@pytest.mark.parametrize("field", ["context", "materials", "resources"])
def test_optional_means_absent_not_null(field):
    result = existing_result()
    del result[field]
    assert field not in RESULT_ADAPTER.validate_python(result)
    result[field] = None
    with pytest.raises(ValidationError):
        RESULT_ADAPTER.validate_python(result)


@pytest.mark.parametrize(
    "path,value",
    [
        (("provenance",), "model-output"),
        (("resources", 0, "audience"), "teachers"),
        (("resources", 0, "elements", 0, "editable"), "true"),
        (("resources", 0, "elements", 1, "lines"), -1),
        (("activities", 0, "minutes"), 0),
    ],
)
def test_nested_contract(path, value):
    result = existing_result()
    target = result
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    if path == ("activities", 0, "minutes"):
        assert RESULT_ADAPTER.validate_python(result) == result
    else:
        with pytest.raises(ValidationError):
            RESULT_ADAPTER.validate_python(result)


def test_missing_required_and_unknown_fields_rejected():
    for field in ("notice", "activities", "provenance"):
        result = existing_result()
        del result[field]
        with pytest.raises(ValidationError):
            RESULT_ADAPTER.validate_python(result)
    result = existing_result()
    result["activities"][0]["private_note"] = "unexpected"
    with pytest.raises(ValidationError):
        RESULT_ADAPTER.validate_python(result)


def test_generation_validates_before_returning(monkeypatch):
    invalid = existing_result()
    invalid["activities"][0]["minutes"] = "5"
    monkeypatch.setattr(water_fixture, "generate", lambda *args: invalid)
    with pytest.raises(ValidationError):
        planning_fixture.generate(
            water_fixture.FIXTURE_CONTEXT,
            water_fixture.SUPPORTED_PROMPT,
            water_fixture.FIXTURE_SOURCE,
        )
