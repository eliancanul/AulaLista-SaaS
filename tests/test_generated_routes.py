"""HTTP integration with software test doubles, never an API or teaching trial."""

import os
from dataclasses import replace
from uuid import UUID, uuid4

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from test_auth_integration import ORIGIN, CapturingSender, SyntheticGoogle, login
from test_auth_integration import auth_factory as auth_factory
from test_generated_contract import generated_body, provider_output
from test_guided_planning import guided_body
from test_guided_planning_integration import edit_body
from test_materials import actor_app
from test_openai_planning import Transport, completed, reply
from test_planning_edits import write as edit
from test_planning_generation import FakeProvider, profile, request

from aulalista_api.app import create_app
from aulalista_api.database import SCHEMA_REVISION
from aulalista_api.material_routes import require_actor
from aulalista_api.materials import MaterialError
from aulalista_api.openai_planning import OpenAIPlanning, ProviderError
from aulalista_api.planning_generation import GeneratedPlannings


def configured_app(actor, scope, provider, body=None):
    app = create_app(
        planning_provider=provider,
        generation_profile=profile(body or request(), actor=actor, scope=scope),
    )
    app.dependency_overrides[require_actor] = lambda: actor
    return app


def submit(client, scope, body=None, key=None, headers=None):
    return client.post(
        f"/scopes/{scope}/generated-plannings",
        json=generated_body() if body is None else body,
        headers={"Idempotency-Key": str(key or uuid4()), **(headers or {})},
    )


def test_default_factory_never_reads_provider_credential(
    runtime_database, actors, monkeypatch
):
    actor, scope = actors[0]
    original_getitem = type(os.environ).__getitem__

    def guarded_getitem(environment, key):
        if key == "OPENAI_API_KEY":
            pytest.fail("Normal factory must not read a provider credential")
        return original_getitem(environment, key)

    monkeypatch.setattr(type(os.environ), "__getitem__", guarded_getitem)
    with TestClient(actor_app(actor)) as client:
        capability = client.get(f"/scopes/{scope}/planning-generation")
        assert capability.json() == {"available": False}
        assert capability.headers["cache-control"] == "no-store"
        assert submit(client, scope).json() == {"detail": "generation_unavailable"}
        assert (
            client.get(f"/scopes/{actors[1][1]}/planning-generation").status_code == 404
        )
    with runtime_database.connect() as connection:
        assert (
            connection.scalar(text("SELECT count(*) FROM planning_generation_attempt"))
            == 0
        )


def test_generated_http_recovery_edit_copy_library_never_resend(
    runtime_database, actors
):
    actor, scope = actors[0]
    provider, key = FakeProvider(), uuid4()
    with TestClient(configured_app(actor, scope, provider)) as client:
        assert client.get(f"/scopes/{scope}/planning-generation").json() == {
            "available": True
        }
        response = submit(client, scope, key=key)
        assert response.status_code == 201
        assert response.headers["cache-control"] == "no-store"
        saved = response.json()
        assert saved["request"] == generated_body()
        planning_id = saved["receipt"]["planning_id"]
        assert submit(client, scope, key=key).json() == saved
        assert (
            submit(
                client, scope, generated_body(topic="Changed request"), key
            ).status_code
            == 409
        )
        changed = edit(
            client, scope, planning_id, payload=edit_body(value="Software-only edit")
        )
        assert changed.status_code == 201
        assert changed.json()["initial_request"] == saved["request"]
        assert changed.json()["result"]["provenance"] == "openai-guided-v1"
        copied = edit(
            client,
            scope,
            planning_id,
            kind="copy",
            payload=edit_body(kind="copy", revision=2, value="Software-only copy"),
        )
        assert copied.status_code == 201
        assert copied.json()["initial_request"] == saved["request"]
        assert copied.json()["result"]["provenance"] == "openai-guided-v1"
    with TestClient(actor_app(actor)) as restarted:
        assert (
            restarted.get(f"/scopes/{scope}/planning-operations/{key}").json() == saved
        )
        assert submit(restarted, scope, key=key).json() == saved
        assert len(restarted.get(f"/scopes/{scope}/plannings").json()["items"]) == 2
    with TestClient(actor_app(actors[1][0])) as foreign:
        assert (
            foreign.get(f"/scopes/{scope}/planning-operations/{key}").status_code == 404
        )
    assert [kind for kind, _ in provider.calls] == ["count", "generate"]


def test_generated_route_retains_uncertainty_across_restart(runtime_database, actors):
    class LostResponse(FakeProvider):
        def generate(self, payload):
            super().generate(payload)
            raise ProviderError("provider_timeout")

    actor, scope = actors[0]
    provider, key = LostResponse(), uuid4()
    with TestClient(configured_app(actor, scope, provider)) as client:
        response = submit(client, scope, key=key)
        assert response.status_code == 409
        assert response.json() == {"detail": "generation_uncertain"}
    with TestClient(actor_app(actor)) as restarted:
        recovered = restarted.get(f"/scopes/{scope}/planning-operations/{key}")
        assert recovered.status_code == 409
        assert recovered.json() == {"detail": "generation_uncertain"}
        assert submit(restarted, scope, key=key).json() == recovered.json()
        assert (
            restarted.get(f"/scopes/{scope}/planning-operations/{uuid4()}").status_code
            == 404
        )
    assert len(provider.calls) == 2


@pytest.mark.parametrize(
    "body",
    [
        guided_body(),
        generated_body(fixture_context="guided-water-v1"),
        generated_body(topic=""),
    ],
)
def test_generated_route_rejects_wrong_contract_before_provider(
    runtime_database, actors, body
):
    actor, scope = actors[0]
    provider = FakeProvider()
    with TestClient(configured_app(actor, scope, provider)) as client:
        response = submit(client, scope, body)
        assert response.status_code == 422
        assert response.json() == {"detail": "invalid_request"}
    assert provider.calls == []


def test_generation_requires_real_session_origin_and_csrf(auth_factory):
    provider = FakeProvider()
    app = create_app(planning_provider=provider)
    sender = CapturingSender()
    app.state.auth.sender = sender
    app.state.auth.google = SyntheticGoogle()
    assert not app.dependency_overrides
    with TestClient(app, base_url=ORIGIN) as client:
        assert submit(client, uuid4()).status_code == 401
        signed = login(client, sender)
        scope = signed["scope_id"]
        app.state.planning_generation.profile = profile(
            request(), actor=UUID(signed["principal_id"]), scope=UUID(scope)
        )
        assert client.get(f"/scopes/{scope}/planning-generation").json() == {
            "available": True
        }
        assert submit(client, scope).status_code == 403
        assert (
            submit(
                client,
                scope,
                headers={
                    "Origin": "https://foreign.example.test",
                    "X-CSRF-Token": signed["csrf_token"],
                },
            ).status_code
            == 403
        )
        assert provider.calls == []
        headers = {"Origin": ORIGIN, "X-CSRF-Token": signed["csrf_token"]}
        assert submit(client, scope, headers=headers).status_code == 201
        assert len(provider.calls) == 2


def test_revocation_during_provider_response_never_publishes_result(
    auth_factory, runtime_database
):
    provider = FakeProvider()
    app = create_app(planning_provider=provider)
    sender = CapturingSender()
    app.state.auth.sender = sender
    app.state.auth.google = SyntheticGoogle()
    with TestClient(app, base_url=ORIGIN) as client:
        signed = login(client, sender)
        scope, key = signed["scope_id"], uuid4()
        app.state.planning_generation.profile = profile(
            request(), actor=UUID(signed["principal_id"]), scope=UUID(scope)
        )
        headers = {"Origin": ORIGIN, "X-CSRF-Token": signed["csrf_token"]}
        original = provider.generate

        def revoke_after_generate(payload):
            result = original(payload)
            assert client.post("/auth/logout", headers=headers).status_code == 204
            return replace(
                result, output={**result.output, "title": "Must not be published"}
            )

        provider.generate = revoke_after_generate
        assert submit(client, scope, key=key, headers=headers).status_code == 401
        assert (
            client.get(f"/scopes/{scope}/planning-operations/{key}").status_code == 401
        )
        with runtime_database.connect() as connection:
            assert (
                connection.scalar(text("SELECT count(*) FROM planning_revision")) == 0
            )
            assert (
                connection.scalar(text("SELECT state FROM planning_generation_attempt"))
                == "uncertain"
            )
        assert len(provider.calls) == 2


def test_generation_accounting_is_monotone_and_admission_cannot_be_erased(
    runtime_database, migrated_database, actors, monkeypatch
):
    class Timeout(FakeProvider):
        def count(self, payload):
            raise ProviderError("provider_timeout")

    actor, scope = actors[0]
    body = request()
    service = GeneratedPlannings(
        runtime_database, Timeout(), profile(body, actor=actor, scope=scope)
    )
    with pytest.raises(MaterialError) as interrupted:
        service.write(actor, scope, uuid4(), body)
    assert interrupted.value.detail == "generation_uncertain"
    with runtime_database.begin() as connection:
        connection.execute(
            text("UPDATE planning_generation_attempt SET input_tokens = 123")
        )
    for statement in (
        "UPDATE planning_generation_attempt SET input_tokens = 124",
        "UPDATE planning_generation_attempt SET input_tokens = NULL",
        "UPDATE planning_generation_attempt SET state = 'failed'",
        "UPDATE planning_generation_attempt SET request = '{}'::jsonb",
        "UPDATE planning_generation_attempt SET configuration = '{}'::jsonb",
        "UPDATE planning_generation_attempt SET reserved_usd = 0.00001",
        "DELETE FROM planning_generation_attempt",
        "TRUNCATE planning_generation_attempt",
    ):
        with pytest.raises(DBAPIError), runtime_database.begin() as connection:
            connection.execute(text(statement))
    monkeypatch.setenv(
        "AULALISTA_DATABASE_URL",
        migrated_database.url.render_as_string(hide_password=False),
    )
    with pytest.raises(DBAPIError):
        command.downgrade(Config("alembic.ini"), "0007_guided_planning")
    with runtime_database.connect() as connection:
        assert (
            connection.scalar(text("SELECT version_num FROM alembic_version"))
            == SCHEMA_REVISION
        )
        assert connection.execute(
            text("SELECT state, input_tokens FROM planning_generation_attempt")
        ).one() == ("uncertain", 123)


@pytest.mark.parametrize("cache_write_tokens", [0, None])
def test_success_records_observed_zero_cache_writes_separately_from_unknown(
    runtime_database, actors, cache_write_tokens
):
    import json

    actor, scope = actors[0]
    response = completed()
    response["output"][0]["content"][0]["text"] = json.dumps(provider_output())
    if cache_write_tokens is not None:
        response["usage"]["input_tokens_details"] = {
            "cache_write_tokens": cache_write_tokens
        }
    transport = Transport(
        reply({"object": "response.input_tokens", "input_tokens": 120}),
        reply(response),
    )
    provider = OpenAIPlanning("software-placeholder-only", transport=transport)
    with TestClient(configured_app(actor, scope, provider)) as client:
        assert submit(client, scope).status_code == 201
    with runtime_database.connect() as connection:
        assert (
            connection.scalar(
                text("SELECT cache_write_tokens FROM planning_generation_attempt")
            )
            == cache_write_tokens
        )
    assert len(transport.calls) == 2
