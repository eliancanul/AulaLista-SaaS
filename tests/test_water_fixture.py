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


def test_water_flow_recovers_lost_receipts_edits_and_reopens_from_library(
    runtime_database, actors
):
    actor, scope = actors[0]
    source_key, planning_key, edit_key = uuid4(), uuid4(), uuid4()

    def disconnected_client():
        app = actor_app(actor)

        async def transport(scope, receive, send):
            async def disconnect(message):
                if message["type"] == "http.response.start":
                    assert message["status"] == 201
                    raise OSError("Synthetic response lost after commit")
                await send(message)

            await app(scope, receive, disconnect)

        return TestClient(transport)

    with disconnected_client() as client:
        with pytest.raises(OSError, match="Synthetic response lost after commit"):
            create(client, scope, FIXTURE_SOURCE, source_key)
    with TestClient(actor_app(actor)) as client:
        recovered_source = client.get(f"/scopes/{scope}/operations/{source_key}")
        assert recovered_source.status_code == 200
        source = recovered_source.json()
        assert create(client, scope, FIXTURE_SOURCE, source_key).json() == source
        payload = water_request(source)

    with disconnected_client() as client:
        with pytest.raises(OSError, match="Synthetic response lost after commit"):
            submit(client, scope, payload, planning_key)
    with TestClient(actor_app(actor)) as client:
        recovered = client.get(f"/scopes/{scope}/planning-operations/{planning_key}")
        assert recovered.status_code == 200
        original = recovered.json()
        assert submit(client, scope, payload, planning_key).json() == original
        planning_id = original["receipt"]["planning_id"]
        edit = {
            "contract_version": 1,
            "resource_key": "observation-sheet",
            "element_key": "instruction",
            "text": "Observa el vaso y describe los cambios del agua.",
            "expected_revision": 1,
        }
        edited = client.post(
            f"/scopes/{scope}/plannings/{planning_id}/revisions",
            json=edit,
            headers={"Idempotency-Key": str(edit_key)},
        )
        assert edited.status_code == 201
        saved = edited.json()

    with TestClient(actor_app(actor)) as client:
        library = client.get(f"/scopes/{scope}/plannings?limit=1")
        assert library.status_code == 200
        assert library.json() == {"items": [saved], "next_cursor": None}
        assert client.get(f"/scopes/{scope}/plannings/{planning_id}").json() == saved
        assert saved["initial_request"] == payload
        assert saved["receipt"]["revision"] == 2
        assert saved["receipt"]["source_version_id"] == source["version_id"]
        assert saved["result"]["context"] == {
            "level": "Primaria",
            "group": "4.º A",
            "subject": "Ciencias",
        }
        assert saved["result"]["resources"][0]["elements"][0]["text"] == edit["text"]
        assert (
            client.get(f"/scopes/{scope}/plannings/{planning_id}/revisions/1").json()
            == original
        )
        assert submit(client, scope, payload, planning_key).json() == original
        original_bytes = client.get(
            f"/scopes/{scope}/sources/{source['source_id']}/versions/1"
        )
        assert original_bytes.status_code == 200
        assert original_bytes.content == FIXTURE_SOURCE
        assert original_bytes.headers["x-content-sha256"] == source["sha256"]
        assert original_bytes.headers["x-content-size"] == str(len(FIXTURE_SOURCE))
        assert client.get(f"/scopes/{scope}/operations/{source_key}").json() == source
