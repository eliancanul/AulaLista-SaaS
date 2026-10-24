"""One real HTTP generation seam; all provider credentials/transport synthetic.

PYTEST_DONT_REWRITE: do not expand auth arguments on failures.
"""

import json
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import Session
from test_auth_integration import ORIGIN, CapturingSender
from test_auth_integration import auth_factory as auth_factory
from test_generated_contract import generated_body, provider_output
from test_generated_routes import submit
from test_openai_planning import Transport, completed, reply
from test_pilot_composition import composed as composed
from test_pilot_composition import sign_in

from aulalista_api.ai_budget import BudgetReservation
from aulalista_api.openai_planning import OpenAIPlanning, ProviderError
from aulalista_api.planning_generation import GenerationAttempt


def configure(monkeypatch, actor, scope):
    for key, value in {
        "AULALISTA_PILOT_ENABLED": "true",
        "AULALISTA_PILOT_ACTOR_ID": str(actor),
        "AULALISTA_PILOT_SCOPE_ID": str(scope),
        "AULALISTA_PILOT_BUDGET_USD": "2",
        "AULALISTA_PILOT_ADDITIONAL_RESERVE_USD": "0.02",
        "OPENAI_API_KEY": "software-server-credential-only",
    }.items():
        monkeypatch.setenv(key, value)
    monkeypatch.delenv("AULALISTA_PILOT_COUNT_RESERVE_USD", raising=False)


def test_window_startup_reserves_whole_long_window_without_remote_count(monkeypatch):
    from aulalista_api.pilot_runtime import create_window_app

    configure(monkeypatch, uuid4(), uuid4())
    app = create_window_app()
    service = app.state.planning_generation
    assert service.profile.count_strategy == "window-v1"
    assert service.profile.count_request_reserve_usd == 0
    assert service.profile.reservation_usd == Decimal("0.230768000")
    assert service.provider.input_token_limit == 1_050_000
    assert not app.dependency_overrides


@pytest.mark.parametrize(
    "extra", [None, "-0.01", "NaN", "Infinity", "0.0000000001", "2"]
)
def test_window_startup_invalid_extra_fails_before_key(monkeypatch, extra):
    import aulalista_api.pilot_runtime as runtime

    configure(monkeypatch, uuid4(), uuid4())
    if extra is None:
        monkeypatch.delenv("AULALISTA_PILOT_ADDITIONAL_RESERVE_USD")
    else:
        monkeypatch.setenv("AULALISTA_PILOT_ADDITIONAL_RESERVE_USD", extra)
    getitem = type(os.environ).__getitem__

    def guarded(environment, key):
        if key == "OPENAI_API_KEY":
            pytest.fail("invalid public configuration read key")
        return getitem(environment, key)

    monkeypatch.setattr(type(os.environ), "__getitem__", guarded)
    with pytest.raises(ValueError, match="^invalid_pilot_runtime$"):
        runtime.create_window_app()


def window_app(monkeypatch, composed, transport, *, budget="2"):
    from aulalista_api.pilot_runtime import create_window_app

    configure(monkeypatch, composed.actor_id, composed.scope_id)
    monkeypatch.setenv("AULALISTA_PILOT_BUDGET_USD", budget)
    monkeypatch.setattr(OpenAIPlanning, "_send", lambda self, u, p: transport(u, p))
    app = create_window_app()
    app.state.auth.sender = CapturingSender()
    return app


def test_window_http_two_inputs_replay_restart_and_budget(
    monkeypatch, composed, runtime_database
):
    response = completed(usage={"input_tokens": 3000, "output_tokens": 20})
    response["output"][0]["content"][0]["text"] = json.dumps(provider_output())
    transport = Transport(reply(response), reply(response))
    key, second_key = uuid4(), uuid4()
    app = window_app(monkeypatch, composed, transport, budget="0.461536")
    second_body = generated_body(topic="Otro contexto sintético")
    with TestClient(app, base_url=ORIGIN) as client:
        scope, headers = sign_in(client)
        assert client.get(f"/scopes/{scope}/planning-generation").json() == {
            "available": True
        }
        saved = submit(client, scope, key=key, headers=headers)
        assert saved.status_code == 201
        assert submit(client, scope, key=key, headers=headers).json() == saved.json()
        saved2 = submit(
            client, scope, body=second_body, key=second_key, headers=headers
        )
        assert saved2.status_code == 201
        assert (
            saved2.json()["receipt"]["planning_id"]
            != saved.json()["receipt"]["planning_id"]
        )
        assert submit(client, scope, headers=headers).status_code == 429
        cookies = client.cookies
    with TestClient(
        window_app(monkeypatch, composed, transport, budget="0.461536"), base_url=ORIGIN
    ) as client:
        client.cookies.update(cookies)
        assert client.get("/auth/session").status_code == 200
        assert (
            submit(
                client, scope, body=second_body, key=second_key, headers=headers
            ).json()
            == saved2.json()
        )
        assert submit(client, scope, headers=headers).status_code == 429
    assert [url for url, _ in transport.calls] == [
        "https://api.openai.com/v1/responses"
    ] * 2
    with Session(runtime_database) as db:
        rows = db.scalars(select(GenerationAttempt)).all()
        assert len(rows) == 2
        assert sum(row.reserved_usd for row in rows) == Decimal("0.461536")
        assert all(
            (row.count_requests, row.counted_input_tokens, row.generation_requests)
            == (0, None, 1)
            for row in rows
        )
        assert all(
            row.input_tokens == 3000 and row.count_strategy == "window-v1"
            for row in rows
        )


@pytest.mark.parametrize("uncertain", [False, True])
def test_window_failure_keeps_reservation_and_never_retries(
    monkeypatch, composed, runtime_database, uncertain
):
    transport = Transport(ProviderError("provider_timeout", uncertain=uncertain))
    with TestClient(
        window_app(monkeypatch, composed, transport, budget="0.230768"), base_url=ORIGIN
    ) as client:
        scope, headers = sign_in(client)
        key = uuid4()
        assert submit(client, scope, key=key, headers=headers).status_code == 409
        assert submit(client, scope, key=key, headers=headers).status_code == 409
        assert submit(client, scope, headers=headers).status_code == (
            409 if uncertain else 429
        )
    assert len(transport.calls) == 1
    with Session(runtime_database) as db:
        row = db.scalars(select(GenerationAttempt)).one()
        assert row.state == ("uncertain" if uncertain else "failed")
        assert row.reserved_usd == Decimal("0.230768000")
        assert row.count_requests == 0 and row.counted_input_tokens is None


def test_window_revoked_between_admission_and_send_never_transmits(
    monkeypatch, composed, runtime_database
):
    import aulalista_api.planning_generation as module

    original = module.authorize
    calls = []

    def revoke_before_next_check(db, actor, scope):
        calls.append(1)
        if len(calls) == 2:
            with runtime_database.begin() as connection:
                connection.execute(text("UPDATE auth_session SET revoked = true"))
        return original(db, actor, scope)

    transport = Transport()
    with TestClient(
        window_app(monkeypatch, composed, transport), base_url=ORIGIN
    ) as client:
        scope, headers = sign_in(client)
        monkeypatch.setattr(module, "authorize", revoke_before_next_check)
        assert submit(client, scope, headers=headers).status_code == 401
    assert not transport.calls
    with Session(runtime_database) as db:
        row = db.scalars(select(GenerationAttempt)).one()
        assert row.state == "uncertain"
        assert row.reserved_usd == Decimal("0.230768000")


def test_window_concurrent_request_cannot_dispatch_twice(monkeypatch, composed):
    entered, release = threading.Event(), threading.Event()
    calls = []
    response = completed()
    response["output"][0]["content"][0]["text"] = json.dumps(provider_output())

    def blocking(url, payload):
        calls.append(url)
        entered.set()
        assert release.wait(5)
        return reply(response)

    with TestClient(
        window_app(monkeypatch, composed, blocking, budget="0.230768"), base_url=ORIGIN
    ) as client:
        scope, headers = sign_in(client)
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(submit, client, scope, headers=headers)
            try:
                assert entered.wait(5)
                assert submit(client, scope, headers=headers).status_code == 409
            finally:
                release.set()
            assert pending.result(timeout=5).status_code == 201
        assert submit(client, scope, headers=headers).status_code == 429
    assert calls == ["https://api.openai.com/v1/responses"]


def test_window_includes_legacy_reservations_in_global_budget(
    monkeypatch, composed, runtime_database
):
    instant = datetime.now(UTC)
    with Session(runtime_database) as db, db.begin():
        db.add(
            GenerationAttempt(
                actor_id=composed.actor_id,
                scope_id=composed.scope_id,
                operation_id=uuid4(),
                request_fingerprint="a" * 64,
                payload_sha256="b" * 64,
                profile_fingerprint="c" * 64,
                request={},
                configuration={},
                state="failed",
                reserved_usd=Decimal("0.02"),
                count_requests=1,
                generation_requests=0,
                created_at=instant,
                deadline_at=instant + timedelta(seconds=75),
                finished_at=instant,
            )
        )
    transport = Transport()
    app = window_app(monkeypatch, composed, transport, budget="0.24")
    with TestClient(app, base_url=ORIGIN) as client:
        scope, headers = sign_in(client)
        assert submit(client, scope, headers=headers).status_code == 429
    assert not transport.calls
    with Session(runtime_database) as db:
        row = db.scalars(select(GenerationAttempt)).one()
        assert row.count_strategy == "remote-v1"
        assert row.reserved_usd == Decimal("0.02")


def test_window_uses_reservations_from_other_product_in_same_total(
    monkeypatch, composed, runtime_database
):
    with Session(runtime_database) as db, db.begin():
        db.add(
            BudgetReservation(
                id=uuid4(),
                scope_id=composed.scope_id,
                operation_id=uuid4(),
                kind="chat",
                state="failed",
                reserved_usd=Decimal("1.9"),
                created_at=datetime.now(UTC),
            )
        )
    transport = Transport()
    with TestClient(
        window_app(monkeypatch, composed, transport), base_url=ORIGIN
    ) as client:
        scope, headers = sign_in(client)
        assert submit(client, scope, headers=headers).status_code == 429
    assert not transport.calls


def test_window_sql_constraints_and_retained_attempt_prevent_downgrade(empty_database):
    from alembic import command
    from alembic.config import Config
    from sqlalchemy.exc import DBAPIError

    config = Config("alembic.ini")
    command.upgrade(config, "head")
    actor, scope = uuid4(), uuid4()
    with empty_database.begin() as connection:
        connection.execute(text("INSERT INTO principal (id) VALUES (:a)"), {"a": actor})
        connection.execute(
            text("INSERT INTO personal_scope (id, owner_principal_id) VALUES (:s, :a)"),
            {"s": scope, "a": actor},
        )

    def insert(*, strategy="window-v1", counted=None):
        with empty_database.begin() as connection:
            connection.execute(
                text("""
                INSERT INTO planning_generation_attempt
                (id, scope_id, actor_id, operation_id, request_fingerprint, request,
                 configuration, payload_sha256, profile_fingerprint, state, reserved_usd,
                 count_strategy, count_requests, generation_requests, counted_input_tokens,
                 created_at, deadline_at, finished_at)
                VALUES (:id, :s, :a, :op, repeat('a',64), '{}', '{}', repeat('b',64),
                    repeat('c',64), 'failed', 0.230768, :strategy, 0, 1, :counted,
                    now(), now() + interval '75 seconds', now())
            """),
                {
                    "id": uuid4(),
                    "s": scope,
                    "a": actor,
                    "op": uuid4(),
                    "strategy": strategy,
                    "counted": counted,
                },
            )

    with pytest.raises(DBAPIError):
        insert(strategy="invented")
    with pytest.raises(DBAPIError):
        insert(counted=123)
    insert()
    insert()
    with pytest.raises(DBAPIError):
        command.downgrade(config, "0009_planning_branches")
    with empty_database.connect() as connection:
        assert (
            connection.scalar(text("SELECT version_num FROM alembic_version"))
            == "0010_window_budget"
        )
        assert (
            connection.scalar(text("SELECT count(*) FROM planning_generation_attempt"))
            == 2
        )
