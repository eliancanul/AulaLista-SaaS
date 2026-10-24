"""Durable private conversation semantics against disposable PostgreSQL."""

import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import event, select, text, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session
from test_openai_chat import chat_response
from test_openai_planning import Transport, reply
from test_planning_generation import output
from test_planning_generation import request as planning_request

from aulalista_api.ai_budget import BudgetReservation
from aulalista_api.auth import AuthenticatedActor, AuthError
from aulalista_api.auth_models import AuthSession
from aulalista_api.chat import Conversations
from aulalista_api.chat_models import ChatTurn, Conversation, TurnRequest
from aulalista_api.materials import MaterialError
from aulalista_api.openai_planning import OpenAIPlanning, ProviderError
from aulalista_api.planning_generation import GeneratedPlannings, GenerationProfile


def profile(actor, scope, budget="2"):
    return GenerationProfile(
        name="synthetic-chat",
        actor_id=actor,
        scope_id=scope,
        budget_usd=Decimal(budget),
        count_request_reserve_usd=Decimal("0"),
        allowed_request_sha256=None,
        input_policy="manual-variable-v1",
        count_strategy="window-v1",
        additional_reserve_usd=Decimal("0"),
    )


def service(engine, actor, scope, transport, budget="2"):
    return Conversations(
        engine,
        OpenAIPlanning(
            "synthetic-only", transport=transport, input_token_limit=1_050_000
        ),
        profile(actor, scope, budget),
    )


def create(chat, actor, scope):
    return UUID(chat.create(actor, scope, uuid4())["conversation"]["id"])


def body(text="Pregunta sintética", version=0, context_revision=0):
    return TurnRequest(
        text=text, expected_version=version, expected_context_revision=context_revision
    )


def fails(detail, call):
    with pytest.raises(MaterialError) as error:
        call()
    assert error.value.detail == detail
    return error.value.status


def test_two_turns_server_context_replay_restart_and_creation_recovery(
    runtime_database, actors
):
    actor, scope = actors[0]
    transport = Transport(
        reply(
            chat_response(
                "Primera respuesta", usage={"input_tokens": 1, "output_tokens": 1}
            )
        ),
        reply(chat_response("Segunda respuesta", usage=None)),
    )
    chat = service(runtime_database, actor, scope, transport)
    creation = uuid4()
    empty = chat.create(actor, scope, creation)
    conversation = UUID(empty["conversation"]["id"])
    assert empty["conversation"]["version"] == 0 and empty["turns"] == []
    assert chat.create(actor, scope, creation) == empty
    assert chat.read(actor, scope, creation_operation=creation) == empty
    first, second = uuid4(), uuid4()
    one = chat.write(actor, scope, conversation, first, body("Primera pregunta"))
    two = chat.write(actor, scope, conversation, second, body("Segunda pregunta", 1))
    assert one["conversation"]["title"] == "Primera pregunta"
    assert one["turns"][0]["usage"]["estimated_cost_usd"] == "0.0000006"
    assert two["conversation"]["version"] == 2
    assert [t["number"] for t in two["turns"]] == [2]
    assert two["turns"][0]["usage"]["input_tokens"] is None
    assert two["turns"][0]["usage"]["estimated_cost_usd"] is None
    assert transport.calls[1][1]["input"] == [
        {"role": "user", "content": "Primera pregunta"},
        {"role": "assistant", "content": "Primera respuesta"},
        {"role": "user", "content": "Segunda pregunta"},
    ]
    restarted = Conversations(runtime_database)
    saved = restarted.read(actor, scope, conversation)
    assert [t["number"] for t in saved["turns"]] == [1, 2]
    first_receipt = restarted.read(actor, scope, conversation, turn_operation=first)
    assert first_receipt["turns"] == one["turns"]
    assert (
        restarted.write(actor, scope, conversation, first, body("Primera pregunta"))
        == first_receipt
    )
    fails(
        "conflict",
        lambda: chat.write(actor, scope, conversation, first, body("Distinta")),
    )
    fails("conflict", lambda: chat.write(actor, scope, conversation, uuid4(), body()))
    another = create(chat, actor, scope)
    assert another == conversation
    assert len(transport.calls) == 2
    with Session(runtime_database) as db:
        reservations = db.scalars(select(BudgetReservation)).all()
        assert len(reservations) == 2
        assert all(r.kind == "chat" and r.state == "succeeded" for r in reservations)
        assert sum(r.reserved_usd for r in reservations) == Decimal("0.421536")


def test_scope_isolation_and_stable_pagination(runtime_database, actors):
    actor, scope = actors[0]
    other, other_scope = actors[1]
    chat = Conversations(runtime_database)
    ids = [create(chat, actor, scope) for _ in range(4)]
    assert len(set(ids)) == 1
    foreign = create(chat, other, other_scope)
    page = chat.list(actor, scope, limit=2)
    assert [item["id"] for item in page["items"]] == [str(ids[0])]
    assert page["next_cursor"] is None
    for call in (
        lambda: chat.list(other, scope),
        lambda: chat.list(actor, scope, cursor=foreign),
        lambda: chat.read(actor, scope, foreign),
        lambda: chat.read(other, scope, ids[0]),
        lambda: chat.read(actor, scope, ids[0], turn_operation=uuid4()),
        lambda: chat.read(actor, scope, creation_operation=uuid4()),
    ):
        assert fails("not_found", call) == 404


def test_lost_database_commit_response_does_not_overwrite_success(
    runtime_database, actors
):
    actor, scope = actors[0]
    transport = Transport(reply(chat_response()))
    chat = service(runtime_database, actor, scope, transport)
    conversation, operation = create(chat, actor, scope), uuid4()
    commits = 0

    def lose_response(session):
        nonlocal commits
        commits += 1
        if commits == 3:  # admission, pre-dispatch revalidation, confirmed result
            raise RuntimeError("synthetic lost commit response")

    event.listen(Session, "after_commit", lose_response)
    try:
        fails(
            "chat_uncertain",
            lambda: chat.write(actor, scope, conversation, operation, body()),
        )
    finally:
        event.remove(Session, "after_commit", lose_response)
    saved = chat.read(actor, scope, conversation, turn_operation=operation)
    assert saved["turns"][0]["state"] == "succeeded"
    assert chat.write(actor, scope, conversation, operation, body()) == saved
    assert len(transport.calls) == 1


@pytest.mark.parametrize("uncertain", [False, True])
def test_failure_retains_reserve_and_replay_never_dispatches(
    runtime_database, actors, uncertain
):
    actor, scope = actors[0]
    transport = Transport(
        ProviderError("provider_timeout", uncertain=uncertain), reply(chat_response())
    )
    chat = service(runtime_database, actor, scope, transport)
    conversation, operation = create(chat, actor, scope), uuid4()
    detail = "chat_uncertain" if uncertain else "chat_failed"
    for _ in range(2):
        fails(detail, lambda: chat.write(actor, scope, conversation, operation, body()))
    saved = chat.read(actor, scope, conversation, turn_operation=operation)
    assert saved["conversation"]["version"] == 1
    assert saved["turns"][0]["assistant_text"] is None
    assert saved["turns"][0]["usage"]["input_tokens"] is None
    if uncertain:
        fails(
            "chat_busy",
            lambda: chat.write(actor, scope, conversation, uuid4(), body(version=1)),
        )
        assert len(transport.calls) == 1
    else:
        result = chat.write(
            actor, scope, conversation, uuid4(), body("Revisión explícita", 1)
        )
        assert result["conversation"]["version"] == 2
        assert transport.calls[1][1]["input"] == [
            {"role": "user", "content": "Revisión explícita"}
        ]
    with Session(runtime_database) as db:
        rows = db.scalars(select(BudgetReservation)).all()
        assert len(rows) == (1 if uncertain else 2)
        assert all(r.reserved_usd == Decimal("0.210768") for r in rows)


@pytest.mark.parametrize("first_kind", ["planning", "chat"])
def test_chat_and_planning_share_one_retained_budget(
    runtime_database, actors, first_kind
):
    actor, scope = actors[0]
    result = chat_response(json.dumps(output()) if first_kind == "planning" else "Hola")
    transport = Transport(reply(result))
    chat = service(runtime_database, actor, scope, transport, budget="0.210768")
    planning = GeneratedPlannings(runtime_database, chat.provider, chat.profile)
    conversation = create(chat, actor, scope)
    if first_kind == "planning":
        key = uuid4()
        planning.write(actor, scope, key, planning_request())
        fails("conflict", lambda: chat.write(actor, scope, conversation, key, body()))
        fails(
            "chat_budget_exhausted",
            lambda: chat.write(actor, scope, conversation, uuid4(), body()),
        )
    else:
        chat.write(actor, scope, conversation, uuid4(), body())
        fails(
            "generation_budget_exhausted",
            lambda: planning.write(actor, scope, uuid4(), planning_request()),
        )
    assert len(transport.calls) == 1
    with Session(runtime_database) as db:
        assert len(db.scalars(select(BudgetReservation)).all()) == 1


def test_compaction_budget_rejects_without_truncation_or_reservation(
    runtime_database, actors
):
    actor, scope = actors[0]
    transport = Transport(reply(chat_response("a" * 32768)))
    chat = service(runtime_database, actor, scope, transport, budget="0.5")
    conversation = create(chat, actor, scope)
    chat.write(actor, scope, conversation, uuid4(), body())
    assert (
        fails(
            "chat_budget_exhausted",
            lambda: chat.write(actor, scope, conversation, uuid4(), body(version=1)),
        )
        == 429
    )
    assert chat.read(actor, scope, conversation)["conversation"]["version"] == 1
    assert len(transport.calls) == 1


@pytest.mark.parametrize("success", [False, True])
def test_continuity_beyond_previous_attempt_and_success_quotas(
    runtime_database, actors, success
):
    actor, scope = actors[0]
    maximum = 45 if success else 105
    responses = [
        reply(chat_response("A"))
        if success
        else ProviderError("provider_rejected", uncertain=False)
        for _ in range(maximum)
    ]
    transport = Transport(*responses)
    chat = service(runtime_database, actor, scope, transport, budget="30")
    conversation = create(chat, actor, scope)
    for version in range(maximum):

        def call():
            return chat.write(actor, scope, conversation, uuid4(), body("Q", version))

        if success:
            call()
        else:
            fails("chat_failed", call)
    assert len(transport.calls) == maximum
    saved = chat.read(actor, scope, conversation)
    assert saved["conversation"]["version"] == maximum
    assert len(saved["turns"]) == 20
    pages = saved["turns"]
    while saved["next_cursor"]:
        saved = chat.read(actor, scope, conversation, cursor=int(saved["next_cursor"]))
        pages = saved["turns"] + pages
    assert [row["number"] for row in pages] == list(range(1, maximum + 1))
    if success:
        assert len(transport.calls[-1][1]["input"]) == 2 * maximum - 1


def test_pending_replay_cas_global_busy_and_no_transaction_over_http(
    runtime_database, actors
):
    actor, scope = actors[0]
    entered, release = threading.Event(), threading.Event()

    def transport(url, payload):
        entered.set()
        assert release.wait(5)
        return reply(chat_response())

    chat = service(runtime_database, actor, scope, transport)
    conversation, other = create(chat, actor, scope), create(chat, actor, scope)
    key = uuid4()
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(chat.write, actor, scope, conversation, key, body())
        try:
            assert entered.wait(5)
            saved = chat.read(actor, scope, conversation, turn_operation=key)
            assert saved["turns"][0]["state"] == "generating"
            fails(
                "chat_pending",
                lambda: chat.write(actor, scope, conversation, key, body()),
            )
            fails(
                "conflict",
                lambda: chat.write(actor, scope, conversation, uuid4(), body()),
            )
            fails(
                "chat_busy",
                lambda: chat.write(actor, scope, other, uuid4(), body(version=1)),
            )
            planning = GeneratedPlannings(runtime_database, chat.provider, chat.profile)
            fails(
                "generation_busy",
                lambda: planning.write(actor, scope, uuid4(), planning_request()),
            )
        finally:
            release.set()
        assert future.result(timeout=5)["turns"][0]["state"] == "succeeded"


def test_overlapping_different_actors_serialize_one_budget(
    runtime_database, migrated_database, actors
):
    transport = Transport(reply(chat_response()), reply(chat_response()))
    services = [
        service(runtime_database, actor, scope, transport, "0.210768")
        for actor, scope in actors
    ]
    conversations = [
        create(chat, actor, scope) for chat, (actor, scope) in zip(services, actors)
    ]
    release, first_insert, second_started, second_insert = (
        threading.Event() for _ in range(4)
    )
    worker, pids = threading.local(), {}

    def pause(connection, cursor, statement, parameters, context, many):
        number = getattr(worker, "number", None)
        if number is None:
            return
        if number not in pids:
            pids[number] = connection.connection.driver_connection.info.backend_pid
            if number == 1:
                second_started.set()
        if statement.startswith("INSERT INTO chat_turn "):
            (first_insert if number == 0 else second_insert).set()
            assert release.wait(5)

    def write(number):
        worker.number = number
        actor, scope = actors[number]
        try:
            return services[number].write(
                actor, scope, conversations[number], uuid4(), body()
            )
        except MaterialError as error:
            return error

    event.listen(runtime_database, "before_cursor_execute", pause)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(write, 0)
            try:
                assert first_insert.wait(5)
                second = pool.submit(write, 1)
                assert second_started.wait(5)
                deadline = time.monotonic() + 1.5
                with migrated_database.connect() as observer:
                    while not second_insert.is_set():
                        if observer.scalar(
                            text("SELECT :first = ANY(pg_blocking_pids(:second))"),
                            {"first": pids[0], "second": pids[1]},
                        ):
                            break
                        assert time.monotonic() < deadline
                        time.sleep(0.005)
            finally:
                release.set()
            outcomes = [first.result(timeout=5), second.result(timeout=5)]
    finally:
        release.set()
        event.remove(runtime_database, "before_cursor_execute", pause)
    assert len([r for r in outcomes if isinstance(r, dict)]) == 1
    denied = [r for r in outcomes if isinstance(r, MaterialError)]
    assert len(denied) == 1
    assert denied[0].detail in {"chat_busy", "chat_budget_exhausted"}
    assert len(transport.calls) == 1


@pytest.mark.parametrize("stage", ["before_http", "before_commit"])
def test_original_session_revocation_prevents_send_or_result(
    runtime_database, actors, monkeypatch, stage
):
    import aulalista_api.chat as module

    principal, scope = actors[0]
    digest, instant = "c" * 64, datetime.now(UTC)
    with Session(runtime_database) as db, db.begin():
        db.add(
            AuthSession(
                token_hash=digest,
                principal_id=principal,
                expires_at=instant + timedelta(hours=1),
                idle_expires_at=instant + timedelta(hours=1),
                revoked=False,
            )
        )
    actor = AuthenticatedActor(principal, digest)

    def revoke():
        with Session(runtime_database) as db, db.begin():
            db.execute(
                update(AuthSession)
                .where(AuthSession.token_hash == digest)
                .values(revoked=True)
            )

    calls = []

    def transport(url, payload):
        calls.append(payload)
        if stage == "before_commit":
            revoke()
        return reply(chat_response())

    chat = service(runtime_database, principal, scope, transport)
    conversation = create(chat, actor, scope)
    if stage == "before_http":
        authorize = module.authorize
        count = 0

        def revalidate(db, identity, target):
            nonlocal count
            count += 1
            if count == 2:
                revoke()
            return authorize(db, identity, target)

        monkeypatch.setattr(module, "authorize", revalidate)
    with pytest.raises(AuthError) as denied:
        chat.write(actor, scope, conversation, uuid4(), body())
    assert denied.value.status == 401
    assert len(calls) == (0 if stage == "before_http" else 1)
    saved = chat.read(principal, scope, conversation)
    assert saved["turns"][0]["state"] == "uncertain"
    assert saved["turns"][0]["assistant_text"] is None


def test_crash_expires_and_late_usage_only_enriches_uncertainty(
    runtime_database, actors, monkeypatch
):
    import aulalista_api.chat as module

    actor, scope = actors[0]

    class Crash(BaseException):
        pass

    def transport(url, payload):
        raise Crash()

    chat = service(runtime_database, actor, scope, transport)
    conversation, key = create(chat, actor, scope), uuid4()
    with pytest.raises(Crash):
        chat.write(actor, scope, conversation, key, body())
    assert chat.read(actor, scope, conversation)["turns"][0]["state"] == "generating"
    future = datetime.now(UTC) + timedelta(seconds=76)
    monkeypatch.setattr(module, "now", lambda: future)
    saved = Conversations(runtime_database).read(actor, scope, conversation)
    assert saved["turns"][0]["state"] == "uncertain"
    fails("chat_uncertain", lambda: chat.write(actor, scope, conversation, key, body()))
    fails(
        "chat_busy",
        lambda: chat.write(actor, scope, conversation, uuid4(), body(version=1)),
    )
    with Session(runtime_database) as db:
        turn_id = db.scalar(select(ChatTurn.id))
    chat._finish(
        turn_id, "succeeded", "ignored", {"input_tokens": 12, "output_tokens": 4}
    )
    assert (
        chat.read(actor, scope, conversation)["turns"][0]["usage"]["input_tokens"] == 12
    )
    chat._finish(turn_id, "succeeded", "ignored", {"input_tokens": 15})
    assert (
        chat.read(actor, scope, conversation)["turns"][0]["usage"]["input_tokens"] == 12
    )


def test_get_expiry_while_response_in_flight_never_publishes_answer(
    runtime_database, actors, monkeypatch
):
    import aulalista_api.chat as module

    actor, scope = actors[0]

    def transport(url, payload):
        future = datetime.now(UTC) + timedelta(seconds=76)
        monkeypatch.setattr(module, "now", lambda: future)
        assert chat.read(actor, scope, conversation)["turns"][0]["state"] == "uncertain"
        return reply(chat_response())

    chat = service(runtime_database, actor, scope, transport)
    conversation = create(chat, actor, scope)
    fails(
        "chat_uncertain",
        lambda: chat.write(actor, scope, conversation, uuid4(), body()),
    )
    saved = chat.read(actor, scope, conversation)
    assert saved["turns"][0]["assistant_text"] is None
    assert saved["turns"][0]["usage"]["input_tokens"] == 120


def test_runtime_grants_terminal_immutability_and_retained_downgrade(
    runtime_database, migrated_database, actors, monkeypatch
):
    actor, scope = actors[0]
    chat = service(runtime_database, actor, scope, Transport(reply(chat_response())))
    conversation = create(chat, actor, scope)
    chat.write(actor, scope, conversation, uuid4(), body())
    queries = [
        "UPDATE chat_turn SET assistant_text = 'changed'",
        "UPDATE chat_turn SET state = 'generating', assistant_text = NULL, finished_at = NULL",
        "UPDATE chat_turn SET input_tokens = 0",
        "UPDATE chat_turn SET user_text = 'changed'",
        "UPDATE chat_turn SET reserved_usd = 0.1",
        "UPDATE chat_turn SET configuration = '{}'::jsonb",
        "DELETE FROM chat_turn",
        "TRUNCATE chat_turn",
        "DELETE FROM chat_conversation",
        "UPDATE chat_conversation SET title = 'changed'",
        "UPDATE ai_budget_reservation SET state = 'failed' WHERE kind = 'chat'",
    ]
    for sql in queries:
        with runtime_database.begin() as db, pytest.raises(DBAPIError):
            db.execute(text(sql))
    with pytest.raises(DBAPIError), runtime_database.begin() as db:
        db.execute(text("UPDATE chat_conversation SET version = version + 1"))
    # Owner access cannot rewrite immutable input/metadata either.
    for sql in ("UPDATE chat_turn SET user_text = 'changed'", "DELETE FROM chat_turn"):
        with migrated_database.begin() as db, pytest.raises(DBAPIError):
            db.execute(text(sql))
    monkeypatch.setenv(
        "AULALISTA_DATABASE_URL",
        migrated_database.url.render_as_string(hide_password=False),
    )
    with pytest.raises(DBAPIError):
        command.downgrade(Config("alembic.ini"), "0010_window_budget")
    assert chat.read(actor, scope, conversation)["turns"][0]["state"] == "succeeded"
    with Session(runtime_database) as db:
        assert db.scalar(select(Conversation.version)) == 1
