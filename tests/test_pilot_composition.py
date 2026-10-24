"""New assembly through actual auth/CSRF/PG; only provider/email are synthetic.

PYTEST_DONT_REWRITE: never expand session/CSRF/OTP arguments on failure.
"""

import json
from copy import deepcopy
from dataclasses import replace
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_auth_integration import ORIGIN, CapturingSender, login
from test_auth_integration import auth_factory as auth_factory
from test_generated_contract import generated_body, provider_output
from test_generated_routes import submit
from test_guided_planning_integration import edit_body
from test_openai_planning import Transport, completed, reply
from test_pilot_configuration import pilot_config

from aulalista_api.app import create_app
from aulalista_api.auth_models import Identity
from aulalista_api.openai_planning import OpenAIPlanning, ProviderError
from aulalista_api.pilot_runtime import create_app as create_runtime_app
from aulalista_api.planning_generation import GenerationAttempt


@pytest.fixture
def composed(auth_factory, runtime_database, actors):
    actor, scope = actors[0]
    with Session(runtime_database) as db, db.begin():
        db.add(
            Identity(
                id=uuid4(),
                issuer="email",
                subject="composed-pilot@example.test",
                principal_id=actor,
                email="composed-pilot@example.test",
                email_verified=True,
            )
        )
    return pilot_config(actor_id=actor, scope_id=scope)


@pytest.fixture(params=["injected", "server-runtime"])
def application(request, monkeypatch):
    def build(config, transport):
        if request.param == "injected":
            app = create_app(
                pilot_config=config,
                planning_provider=OpenAIPlanning(
                    "software-placeholder-only", transport=transport
                ),
            )
        else:
            for key, value in {
                "AULALISTA_PILOT_ENABLED": "true",
                "AULALISTA_PILOT_ACTOR_ID": str(config.actor_id),
                "AULALISTA_PILOT_SCOPE_ID": str(config.scope_id),
                "AULALISTA_PILOT_BUDGET_USD": str(config.budget_usd),
                "AULALISTA_PILOT_COUNT_RESERVE_USD": str(
                    config.count_request_reserve_usd
                ),
                "OPENAI_API_KEY": "software-server-credential-only",
            }.items():
                monkeypatch.setenv(key, value)
            monkeypatch.setattr(
                OpenAIPlanning,
                "_send",
                lambda self, url, payload: transport(url, payload),
            )
            app = create_runtime_app()
        app.state.auth.sender = CapturingSender()
        assert not app.dependency_overrides
        return app

    return build


def sign_in(client):
    signed = login(client, client.app.state.auth.sender, "composed-pilot@example.test")
    return signed["scope_id"], {
        "Origin": ORIGIN,
        "X-CSRF-Token": signed["csrf_token"],
    }


def ledger(engine):
    with Session(engine) as db:
        return [
            (
                item.id,
                item.actor_id,
                item.scope_id,
                item.operation_id,
                item.state,
                item.reserved_usd,
                item.profile_fingerprint,
                deepcopy(item.configuration),
                item.planning_revision_id,
                item.count_requests,
                item.generation_requests,
            )
            for item in db.scalars(select(GenerationAttempt))
        ]


def test_composed_two_inputs_edit_reopen_and_restart_closed(
    composed, runtime_database, application
):
    provider_response = completed()
    provider_response["output"][0]["content"][0]["text"] = json.dumps(provider_output())
    transport = Transport(
        *[
            response
            for _ in range(2)
            for response in (
                reply({"object": "response.input_tokens", "input_tokens": 120}),
                reply(provider_response),
            )
        ]
    )
    app = application(composed, transport)
    with TestClient(app, base_url=ORIGIN) as client:
        scope, headers = sign_in(client)
        assert client.get(f"/scopes/{scope}/planning-generation").json() == {
            "available": True
        }
        assert ledger(runtime_database) == []
        assert transport.calls == []
        results = []
        for body in (
            generated_body(),
            generated_body(topic="Synthetic different context", language="en"),
        ):
            response = submit(client, scope, body, headers=headers)
            assert response.status_code == 201
            original = response.json()
            path = f"/scopes/{scope}/plannings/{original['receipt']['planning_id']}"
            changed = client.post(
                path + "/revisions",
                json=edit_body(value="Synthetic composed correction"),
                headers={**headers, "Idempotency-Key": str(uuid4())},
            )
            assert changed.status_code == 201
            assert changed.json()["initial_request"] == body
            assert changed.json()["receipt"]["revision"] == 2
            results.append((path, original, changed.json()))
        before = ledger(runtime_database)
        assert len(before) == 2
        # A fresh normal factory retains the same DB/session, not an in-place
        # mutation of the composed service. Turning off never deletes history.
        with TestClient(create_app(), base_url=ORIGIN) as closed:
            closed.cookies.update(client.cookies)
            assert closed.get(f"/scopes/{scope}/planning-generation").json() == {
                "available": False
            }
            for path, original, changed in results:
                assert closed.get(path).json() == changed
                assert closed.get(path + "/revisions/1").json() == original
                key = original["receipt"]["operation_id"]
                assert (
                    closed.get(f"/scopes/{scope}/planning-operations/{key}").json()
                    == original
                )
                assert (
                    submit(closed, scope, original["request"], key, headers).json()
                    == original
                )
            assert len(closed.get(f"/scopes/{scope}/plannings").json()["items"]) == 2
            blocked = submit(closed, scope, headers=headers)
            assert blocked.status_code == 503
            assert blocked.json() == {"detail": "generation_unavailable"}
            assert ledger(runtime_database) == before
    assert [url.rsplit("/", 1)[-1] for url, _ in transport.calls] == [
        "input_tokens",
        "responses",
        "input_tokens",
        "responses",
    ]


@pytest.mark.parametrize("stage", ["count", "generate"])
def test_composition_uncertainty_and_reserve_survive_close_reopen(
    composed, runtime_database, stage, application
):
    calls = []

    def timeout(url, payload):
        calls.append(url)
        if stage == "generate" and url.endswith("/input_tokens"):
            return reply({"object": "response.input_tokens", "input_tokens": 120})
        raise ProviderError("provider_timeout")

    app = application(composed, timeout)
    with TestClient(app, base_url=ORIGIN) as client:
        scope, headers = sign_in(client)
        key = uuid4()
        response = submit(client, scope, key=key, headers=headers)
        assert response.status_code == 409
        assert response.json() == {"detail": "generation_uncertain"}
        before = ledger(runtime_database)
        assert len(before) == 1 and before[0][4] == "uncertain"
        assert before[0][5] == app.state.planning_generation.profile.reservation_usd
        assert before[0][8] is None
        for next_app in (
            create_app(),
            application(replace(composed, name="rotated"), timeout),
        ):
            with TestClient(next_app, base_url=ORIGIN) as restarted:
                restarted.cookies.update(client.cookies)
                for _ in range(2):
                    assert restarted.get(
                        f"/scopes/{scope}/planning-operations/{key}"
                    ).json() == {"detail": "generation_uncertain"}
                assert submit(restarted, scope, key=key, headers=headers).json() == {
                    "detail": "generation_uncertain"
                }
                blocked = submit(restarted, scope, headers=headers)
                expected = (
                    "generation_busy"
                    if next_app.state.planning_generation.profile
                    else "generation_unavailable"
                )
                assert blocked.json() == {"detail": expected}
                assert ledger(runtime_database) == before
    assert len(calls) == (1 if stage == "count" else 2)


def test_composition_rejects_unauthorized_inputs_before_transport(
    composed, runtime_database, application
):
    transport = Transport()
    app = application(composed, transport)
    with TestClient(app, base_url=ORIGIN) as client:
        scope, headers = sign_in(client)
        assert submit(client, scope).status_code == 403
        for body in (
            generated_body(topic="x" * 201),
            generated_body(reference={"source_id": str(uuid4()), "source_version": 1}),
            generated_body(input_policy="manual-variable-v1"),
        ):
            assert submit(client, scope, body, headers=headers).status_code == 422
        with TestClient(app, base_url=ORIGIN) as other:
            signed = login(other, app.state.auth.sender, "not-the-pilot@example.test")
            other_headers = {"Origin": ORIGIN, "X-CSRF-Token": signed["csrf_token"]}
            assert other.get(f"/scopes/{scope}/planning-generation").status_code == 404
            assert other.get(
                f"/scopes/{signed['scope_id']}/planning-generation"
            ).json() == {"available": False}
            assert submit(other, signed["scope_id"], headers=other_headers).json() == {
                "detail": "generation_unavailable"
            }
    assert ledger(runtime_database) == []
    assert transport.calls == []


def test_global_budget_survives_a_new_factory(composed, runtime_database, application):
    config = replace(
        composed,
        budget_usd=Decimal("2"),
        count_request_reserve_usd=Decimal("1"),
    )
    result = completed()
    result["output"][0]["content"][0]["text"] = json.dumps(provider_output())
    transport = Transport(
        reply({"object": "response.input_tokens", "input_tokens": 120}), reply(result)
    )
    with TestClient(application(config, transport), base_url=ORIGIN) as client:
        scope, headers = sign_in(client)
        original = submit(client, scope, headers=headers)
        assert original.status_code == 201
        before = ledger(runtime_database)
        assert len(before) == 1
        assert before[0][5] == Decimal("1.000716800")
        with TestClient(application(config, transport), base_url=ORIGIN) as restarted:
            restarted.cookies.update(client.cookies)
            blocked = submit(restarted, scope, headers=headers)
            assert blocked.status_code == 429
            assert blocked.json() == {"detail": "generation_budget_exhausted"}
            saved = original.json()
            assert (
                submit(
                    restarted,
                    scope,
                    saved["request"],
                    saved["receipt"]["operation_id"],
                    headers,
                ).json()
                == saved
            )
        assert ledger(runtime_database) == before
    assert len(transport.calls) == 2
