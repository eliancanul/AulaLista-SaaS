"""Variable manual policy: synthetic inputs, durable DB and fake transport only."""

import hashlib
import json
from dataclasses import replace
from decimal import Decimal
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session
from test_auth_integration import ORIGIN, CapturingSender, login
from test_auth_integration import auth_factory as auth_factory
from test_generated_contract import generated_body, provider_output
from test_generated_routes import submit
from test_guided_planning_integration import edit_body
from test_openai_planning import Transport, completed, reply
from test_planning_generation import FakeProvider, profile, request

from aulalista_api.app import create_app
from aulalista_api.materials import MaterialError, Materials
from aulalista_api.openai_planning import OpenAIPlanning, ProviderError
from aulalista_api.planning_generation import (
    GeneratedPlannings,
    GenerationAttempt,
    GenerationProfile,
)


def manual_profile(*, actor, scope, budget="0.1"):
    return GenerationProfile(
        name="synthetic-manual-only",
        actor_id=actor,
        scope_id=scope,
        budget_usd=Decimal(budget),
        count_request_reserve_usd=Decimal("0.0001"),
        allowed_request_sha256=None,
        input_policy="manual-variable-v1",
    )


def test_two_variable_manual_inputs_have_independent_durable_results(
    runtime_database, actors
):
    actor, scope = actors[0]
    provider = FakeProvider()
    service = GeneratedPlannings(
        runtime_database, provider, manual_profile(actor=actor, scope=scope)
    )
    bodies = [request(), request(topic="Propiedades de materiales sintéticos")]
    saved = [service.write(actor, scope, uuid4(), body) for body in bodies]
    assert saved[0]["receipt"]["planning_id"] != saved[1]["receipt"]["planning_id"]
    assert [item["request"] for item in saved] == [
        body.model_dump(mode="json") for body in bodies
    ]
    assert [kind for kind, _ in provider.calls] == [
        "count",
        "generate",
        "count",
        "generate",
    ]
    with Session(runtime_database) as session:
        attempts = session.scalars(select(GenerationAttempt)).all()
        assert len(attempts) == 2
        for attempt in attempts:
            expected = hashlib.sha256(
                request(
                    **{
                        key: value
                        for key, value in attempt.request.items()
                        if key != "contract_version"
                    }
                ).canonical()
            ).hexdigest()
            assert attempt.request_fingerprint == expected
            assert attempt.configuration["request_sha256"] == expected
            assert attempt.configuration["input_policy"] == "manual-variable-v1"
            assert "approved_request_sha256" not in attempt.configuration
            assert attempt.profile_fingerprint == service.profile.fingerprint
            assert attempt.reserved_usd == service.profile.reservation_usd
            assert (attempt.count_requests, attempt.generation_requests) == (1, 1)
            assert (attempt.counted_input_tokens, attempt.output_tokens) == (500, 100)


@pytest.mark.parametrize(
    "policy, hashes",
    [
        ("exact-input-v1", None),
        ("exact-input-v1", frozenset()),
        ("exact-input-v1", frozenset({"*"})),
        ("exact-input-v1", {"a" * 64}),
        ("manual-variable-v1", frozenset()),
        ("manual-variable-v1", frozenset({"a" * 64})),
        ("manual-variable-v2", None),
        ("unknown", frozenset({"a" * 64})),
        (None, None),
    ],
)
def test_unknown_or_ambiguous_policy_fails_closed(policy, hashes):
    valid = manual_profile(actor=uuid4(), scope=uuid4())
    with pytest.raises(ValueError, match="^invalid_generation_profile$"):
        replace(valid, input_policy=policy, allowed_request_sha256=hashes)


def test_policy_fingerprint_is_explicit_and_default_remains_exact():
    actor, scope = uuid4(), uuid4()
    exact = profile(request(), actor=actor, scope=scope)
    manual = replace(
        exact, input_policy="manual-variable-v1", allowed_request_sha256=None
    )
    assert exact.input_policy == "exact-input-v1"
    assert manual.fingerprint != exact.fingerprint
    assert manual.reservation_usd == exact.reservation_usd
    assert manual.fingerprint == replace(manual).fingerprint
    for field in ("actor_id", "scope_id"):
        with pytest.raises(ValueError, match="^invalid_generation_profile$"):
            replace(manual, **{field: None})


def test_manual_rejects_references_actor_scope_and_malformed_profile_before_count(
    runtime_database, actors
):
    actor, scope = actors[0]
    other, other_scope = actors[1]
    provider = FakeProvider()
    policy = manual_profile(actor=actor, scope=scope)
    service = GeneratedPlannings(runtime_database, provider, policy)
    owned = Materials(runtime_database).write(
        actor, scope, uuid4(), b"synthetic source"
    )
    bodies = [
        request(reference={"source_id": item, "source_version": 1})
        for item in (owned["source_id"], str(uuid4()))
    ]
    for owner, target, body, code in (
        (actor, scope, bodies[0], "generation_input_not_approved"),
        (actor, scope, bodies[1], "generation_input_not_approved"),
        (other, other_scope, request(), "generation_unavailable"),
        (other, scope, request(), "not_found"),
    ):
        with pytest.raises(MaterialError) as denied:
            service.write(owner, target, uuid4(), body)
        assert denied.value.detail == code
    for invalid in (
        None,
        {},
        SimpleNamespace(
            actor_id=actor, scope_id=scope, input_policy="manual-variable-v1"
        ),
    ):
        malformed = GeneratedPlannings(runtime_database, provider, invalid)
        assert malformed.capability(actor, scope) == {"available": False}
        with pytest.raises(MaterialError, match="generation_unavailable"):
            malformed.write(actor, scope, uuid4(), request())
    assert GeneratedPlannings(runtime_database, None, policy).capability(
        actor, scope
    ) == {"available": False}
    with Session(runtime_database) as session:
        assert session.scalar(select(GenerationAttempt)) is None
    assert provider.calls == []


@pytest.mark.parametrize("first_policy", ["exact-input-v1", "manual-variable-v1"])
def test_policy_rotation_preserves_snapshot_replay_and_global_budget(
    runtime_database, actors, first_policy
):
    actor, scope = actors[0]
    body, key, provider = request(), uuid4(), FakeProvider()
    first = profile(
        body, actor=actor, scope=scope, budget="0.0008168", input_policy=first_policy
    )
    saved = GeneratedPlannings(runtime_database, provider, first).write(
        actor, scope, key, body
    )
    with Session(runtime_database) as session:
        original = session.scalar(select(GenerationAttempt))
        snapshot = original.configuration.copy()
        fingerprint = original.profile_fingerprint
        assert snapshot["input_policy"] == first_policy
        assert ("approved_request_sha256" in snapshot) == (
            first_policy == "exact-input-v1"
        )
    second_policy = (
        "manual-variable-v1" if first_policy == "exact-input-v1" else "exact-input-v1"
    )
    second = profile(
        request(topic="Different"),
        actor=actor,
        scope=scope,
        budget="0.0008168",
        input_policy=second_policy,
    )
    service = GeneratedPlannings(runtime_database, provider, second)
    assert service.write(actor, scope, key, body) == saved
    with pytest.raises(MaterialError, match="conflict"):
        service.write(actor, scope, key, request(topic="Different"))
    with pytest.raises(MaterialError, match="generation_budget_exhausted"):
        service.write(actor, scope, uuid4(), request(topic="Different"))
    with Session(runtime_database) as session:
        attempts = session.scalars(select(GenerationAttempt)).all()
        assert len(attempts) == 1
        assert attempts[0].configuration == snapshot
        assert attempts[0].profile_fingerprint == fingerprint
    assert len(provider.calls) == 2


@pytest.mark.parametrize("first_policy", ["exact-input-v1", "manual-variable-v1"])
def test_policy_rotation_cannot_clear_global_uncertainty(
    runtime_database, actors, first_policy
):
    actor, scope = actors[0]
    other, other_scope = actors[1]

    class Timeout(FakeProvider):
        def count(self, payload):
            super().count(payload)
            raise ProviderError("provider_timeout")

    provider, body, key = Timeout(), request(), uuid4()
    first = profile(body, actor=actor, scope=scope, input_policy=first_policy)
    with pytest.raises(MaterialError, match="generation_uncertain"):
        GeneratedPlannings(runtime_database, provider, first).write(
            actor, scope, key, body
        )
    second_policy = (
        "manual-variable-v1" if first_policy == "exact-input-v1" else "exact-input-v1"
    )
    second = profile(body, actor=other, scope=other_scope, input_policy=second_policy)
    with pytest.raises(MaterialError, match="generation_busy"):
        GeneratedPlannings(runtime_database, provider, second).write(
            other, other_scope, uuid4(), body
        )
    disabled = GeneratedPlannings(runtime_database)
    with pytest.raises(MaterialError, match="generation_uncertain"):
        disabled.write(actor, scope, key, body)
    with Session(runtime_database) as session:
        attempt = session.scalar(select(GenerationAttempt))
        assert attempt.configuration["input_policy"] == first_policy
        assert attempt.reserved_usd == first.reservation_usd
        assert attempt.state == "uncertain"
    assert len(provider.calls) == 1


def test_manual_snapshot_cannot_be_rewritten(runtime_database, actors):
    actor, scope = actors[0]
    GeneratedPlannings(
        runtime_database, FakeProvider(), manual_profile(actor=actor, scope=scope)
    ).write(actor, scope, uuid4(), request())
    with (
        pytest.raises(DBAPIError),
        Session(runtime_database) as session,
        session.begin(),
    ):
        attempt = session.scalar(select(GenerationAttempt))
        attempt.configuration = {
            **attempt.configuration,
            "input_policy": "exact-input-v1",
        }


def test_manual_authenticated_http_transport_edit_reopen_and_limits(
    auth_factory, runtime_database
):
    responses = []
    for index in range(2):
        response = completed()
        response["output"][0]["content"][0]["text"] = json.dumps(
            {**provider_output(), "title": f"Synthetic result {index + 1}"}
        )
        responses += [
            reply({"object": "response.input_tokens", "input_tokens": 120}),
            reply(response),
        ]
    transport = Transport(*responses)
    app = create_app(
        planning_provider=OpenAIPlanning(
            "software-placeholder-only", transport=transport
        )
    )
    sender = CapturingSender()
    app.state.auth.sender = sender
    assert not app.dependency_overrides
    with TestClient(app, base_url=ORIGIN) as client:
        signed = login(client, sender)
        scope = signed["scope_id"]
        app.state.planning_generation.profile = manual_profile(
            actor=UUID(signed["principal_id"]), scope=UUID(scope)
        )
        headers = {"Origin": ORIGIN, "X-CSRF-Token": signed["csrf_token"]}
        assert submit(client, scope).status_code == 403
        for body, status in (
            (generated_body(topic="x" * 201), 422),
            (generated_body(input_policy="manual-variable-v1"), 422),
            (
                generated_body(
                    reference={"source_id": str(uuid4()), "source_version": 1}
                ),
                422,
            ),
            (
                generated_body(
                    context={"text": "界" * 1000, "hypothetical": False},
                    learning_objectives=["界" * 200] * 5,
                ),
                413,
            ),
        ):
            assert submit(client, scope, body, headers=headers).status_code == status
        assert transport.calls == []
        bodies = [
            generated_body(),
            generated_body(
                topic="Synthetic second topic",
                language="en",
                context={
                    "text": "Synthetic, non-sensitive manual context.",
                    "hypothetical": False,
                },
            ),
        ]
        saved = []
        for body in bodies:
            response = submit(client, scope, body, headers=headers)
            assert response.status_code == 201
            assert response.json()["request"] == body
            saved.append(response.json())
        first, second = saved
        planning = first["receipt"]["planning_id"]
        changed = client.post(
            f"/scopes/{scope}/plannings/{planning}/revisions",
            json=edit_body(value="Synthetic correction"),
            headers={**headers, "Idempotency-Key": str(uuid4())},
        )
        assert changed.status_code == 201
        assert changed.json()["initial_request"] == bodies[0]
        assert changed.json()["receipt"]["revision"] == 2
        assert (
            client.get(f"/scopes/{scope}/plannings/{planning}").json() == changed.json()
        )
        assert (
            client.get(
                f"/scopes/{scope}/plannings/{second['receipt']['planning_id']}"
            ).json()
            == second
        )
        app.state.planning_generation.profile = None
        assert client.get(f"/scopes/{scope}/planning-generation").json() == {
            "available": False
        }
        assert (
            client.get(
                f"/scopes/{scope}/planning-operations/{first['receipt']['operation_id']}"
            ).json()
            == first
        )
        assert len(client.get(f"/scopes/{scope}/plannings").json()["items"]) == 2
    assert [url for url, _ in transport.calls] == [
        "https://api.openai.com/v1/responses/input_tokens",
        "https://api.openai.com/v1/responses",
    ] * 2
    for _, payload in transport.calls:
        assert payload["model"] == "gpt-6-luna"
        assert "reference" not in json.loads(payload["input"])
        assert "tools" not in payload
