from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from test_materials import actor_app, create
from test_plannings import submit

from aulalista_api.planning_fixture import generate
from aulalista_api.water_fixture import (
    FIXTURE_CONTEXT,
    FIXTURE_SOURCE,
    SUPPORTED_PROMPT,
)


def water_request(source):
    return {
        "contract_version": 1,
        "fixture_context": FIXTURE_CONTEXT,
        "prompt": SUPPORTED_PROMPT,
        "source_id": source["source_id"],
        "expected_source_version": 1,
    }


def test_water_fixture_is_independent_exact_and_fresh():
    result = generate(FIXTURE_CONTEXT, SUPPORTED_PROMPT, FIXTURE_SOURCE)
    assert result["title"] == "Agua que cambia"
    assert [item["minutes"] for item in result["activities"]] == [5, 18, 7]
    assert [item["previous_minutes"] for item in result["activities"]] == [10, 25, 10]
    assert result["resources"][0]["elements"][0]["text"] == (
        "Observa el vaso. Describe lo que ves."
    )
    result["resources"].clear()
    assert (
        len(generate(FIXTURE_CONTEXT, SUPPORTED_PROMPT, FIXTURE_SOURCE)["resources"])
        == 1
    )
    for prompt, source in [("Otro", FIXTURE_SOURCE), (SUPPORTED_PROMPT, b"other")]:
        with pytest.raises(ValueError):
            generate(FIXTURE_CONTEXT, prompt, source)


def test_water_fixture_http_restart_preserves_source_and_result(
    runtime_database, actors
):
    actor, scope = actors[0]
    operation = uuid4()
    with TestClient(actor_app(actor)) as client:
        source = create(client, scope, FIXTURE_SOURCE).json()
        payload = water_request(source)
        response = submit(client, scope, payload, operation)
        assert response.status_code == 201
        saved = response.json()
    with TestClient(actor_app(actor)) as client:
        assert (
            client.get(f"/scopes/{scope}/planning-operations/{operation}").json()
            == saved
        )
        assert submit(client, scope, payload, operation).json() == saved
        assert saved["result"] == generate(
            FIXTURE_CONTEXT, SUPPORTED_PROMPT, FIXTURE_SOURCE
        )
        assert (
            client.get(
                f"/scopes/{scope}/sources/{source['source_id']}/versions/1"
            ).content
            == FIXTURE_SOURCE
        )
