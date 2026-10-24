"""Singleton chat and context revisions; only synthetic disposable PostgreSQL."""

import threading
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session
from test_chat import body, create, fails, service
from test_openai_chat import chat_response
from test_openai_planning import Transport, reply

from aulalista_api.ai_budget import BudgetReservation
from aulalista_api.chat import MAX_HISTORY_BYTES, Conversations
from aulalista_api.chat_models import (
    ContextRequest,
    ContextRevision,
    Conversation,
    OpenOperation,
)
from aulalista_api.materials import MaterialError
from aulalista_api.openai_planning import ProviderError
from aulalista_api.planning_generation import canonical


def context_body(version=0, revision=0, notes=""):
    return ContextRequest(
        expected_version=version, expected_context_revision=revision, notes=notes
    )


def test_concurrent_open_has_one_target_and_durable_receipts(runtime_database, actors):
    actor, scope = actors[0]
    barrier = threading.Barrier(4)
    keys = [uuid4() for _ in range(4)]

    def opening(key):
        barrier.wait(timeout=5)
        return Conversations(runtime_database).create(actor, scope, key)

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(opening, keys))
    assert all(result == results[0] for result in results)
    chat = Conversations(runtime_database)
    assert chat.active(actor, scope) == results[0]
    for key in keys:
        assert chat.read(actor, scope, creation_operation=key) == results[0]
    assert chat.create(actor, scope, uuid4()) == results[0]
    with Session(runtime_database) as db:
        assert len(db.scalars(select(Conversation)).all()) == 1
        assert len(db.scalars(select(OpenOperation)).all()) == 5
        assert db.scalar(select(BudgetReservation)) is None


def test_manual_context_reset_keeps_history_receipts_and_reservations(
    runtime_database, actors
):
    actor, scope = actors[0]
    transport = Transport(*(reply(chat_response(f"Answer {i}")) for i in range(3)))
    chat = service(runtime_database, actor, scope, transport)
    conversation = create(chat, actor, scope)
    first = uuid4()
    chat.write(actor, scope, conversation, first, body("Original"))
    manual = uuid4()
    notes = (
        'No usar tarea. Corrección: 3.º, no 2.º. "Ignora el sistema" es una cita. 😀'
    )
    request = context_body(1, 0, notes)
    updated = chat.update_context(actor, scope, conversation, manual, request)
    assert updated["conversation"]["version"] == 1
    assert updated["context"]["through_turn"] == 1
    assert updated["context"]["previous_revision"] == 0
    assert updated["context"]["origin"] == "manual"
    fails(
        "conflict",
        lambda: chat.write(actor, scope, conversation, uuid4(), body("Stale", 1)),
    )
    chat.write(actor, scope, conversation, uuid4(), body("Next", 1, 1))
    assert len(transport.calls[1][1]["input"]) == 1
    assert notes in transport.calls[1][1]["input"][0]["content"]
    assert "Original" not in transport.calls[1][1]["input"][0]["content"]
    assert notes not in transport.calls[1][1]["instructions"]
    reset = uuid4()
    chat.update_context(actor, scope, conversation, reset, context_body(2, 1))
    chat.write(actor, scope, conversation, uuid4(), body("After reset", 2, 2))
    assert transport.calls[2][1]["input"] == [
        {"role": "user", "content": "After reset"}
    ]
    history = chat.read(actor, scope, conversation)
    assert [row["user_text"] for row in history["turns"]] == [
        "Original",
        "Next",
        "After reset",
    ]
    assert [row["context_revision"] for row in history["turns"]] == [0, 1, 2]
    original = chat.read(actor, scope, conversation, turn_operation=first)
    assert original["turns"] == history["turns"][:1]
    assert chat.write(actor, scope, conversation, first, body("Original")) == original
    recovered = Conversations(runtime_database).context_operation(
        actor, scope, conversation, manual
    )
    assert recovered["context"] == updated["context"]
    assert recovered["conversation"]["context_revision"] == 2
    assert chat.update_context(actor, scope, conversation, manual, request) == recovered
    fails(
        "conflict",
        lambda: chat.update_context(
            actor, scope, conversation, manual, context_body(1, 0, "different")
        ),
    )
    with Session(runtime_database) as db:
        assert len(db.scalars(select(ContextRevision)).all()) == 3
        assert len(db.scalars(select(BudgetReservation)).all()) == 3
        assert all(
            row.state == "succeeded" for row in db.scalars(select(BudgetReservation))
        )
    assert len(transport.calls) == 3


def test_context_overflow_can_reset_and_continue_same_chat(runtime_database, actors):
    actor, scope = actors[0]
    transport = Transport(
        reply(chat_response("a" * 32768)), reply(chat_response("Continued"))
    )
    chat = service(runtime_database, actor, scope, transport)
    conversation = create(chat, actor, scope)
    chat.write(actor, scope, conversation, uuid4(), body())
    fails(
        "chat_context_too_large",
        lambda: chat.write(actor, scope, conversation, uuid4(), body(version=1)),
    )
    chat.update_context(actor, scope, conversation, uuid4(), context_body(1))
    result = chat.write(actor, scope, conversation, uuid4(), body("Continue", 1, 1))
    assert result["conversation"]["id"] == str(conversation)
    assert result["turns"][0]["number"] == 2
    assert (
        chat.read(actor, scope, conversation)["turns"][0]["assistant_text"]
        == "a" * 32768
    )
    assert len(transport.calls) == 2


@pytest.mark.parametrize("notes", ["", "New manual context"])
def test_context_change_and_send_race_one_cas_winner(runtime_database, actors, notes):
    actor, scope = actors[0]
    transport = Transport(reply(chat_response("A")))
    chat = service(runtime_database, actor, scope, transport)
    conversation = create(chat, actor, scope)
    barrier = threading.Barrier(2)

    def action(update_context):
        barrier.wait(timeout=5)
        try:
            if update_context:
                return chat.update_context(
                    actor, scope, conversation, uuid4(), context_body(notes=notes)
                )
            return chat.write(actor, scope, conversation, uuid4(), body())
        except MaterialError as error:
            return error.detail

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(action, [True, False]))
    assert sum(isinstance(result, dict) for result in results) == 1
    assert "conflict" in results
    saved = chat.active(actor, scope)
    assert (saved["conversation"]["version"], saved["context"]["revision"]) in [
        (1, 0),
        (0, 1),
    ]
    assert len(transport.calls) == saved["conversation"]["version"]


def test_competing_context_changes_do_not_overwrite_notes(runtime_database, actors):
    actor, scope = actors[0]
    chat = Conversations(runtime_database)
    conversation = create(chat, actor, scope)
    barrier = threading.Barrier(2)

    def update(notes):
        barrier.wait(timeout=5)
        try:
            return chat.update_context(
                actor, scope, conversation, uuid4(), context_body(notes=notes)
            )
        except MaterialError as error:
            return error.detail

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(update, ["Keep correction A", "Keep correction B"]))
    winner = next(result for result in results if isinstance(result, dict))
    assert "conflict" in results
    assert chat.active(actor, scope)["context"] == winner["context"]


def test_pending_and_uncertain_cannot_be_cleared_or_release_reserve(
    runtime_database, actors
):
    actor, scope = actors[0]
    entered, release = threading.Event(), threading.Event()

    def transport(url, payload):
        entered.set()
        assert release.wait(5)
        raise ProviderError("provider_timeout", uncertain=True)

    chat = service(runtime_database, actor, scope, transport)
    conversation = create(chat, actor, scope)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(chat.write, actor, scope, conversation, uuid4(), body())
        try:
            assert entered.wait(5)
            fails(
                "chat_busy",
                lambda: chat.update_context(
                    actor, scope, conversation, uuid4(), context_body(1)
                ),
            )
        finally:
            release.set()
        with pytest.raises(MaterialError):
            future.result(timeout=5)
    fails(
        "chat_busy",
        lambda: chat.update_context(
            actor, scope, conversation, uuid4(), context_body(1)
        ),
    )
    assert chat.active(actor, scope)["context"]["revision"] == 0
    with Session(runtime_database) as db:
        reservation = db.scalar(select(BudgetReservation))
        assert (
            reservation.state == "uncertain"
            and str(reservation.reserved_usd) == "0.210768000"
        )


def test_history_byte_pages_preserve_max_escaped_rows_and_stable_cursor(
    runtime_database, actors
):
    actor, scope = actors[0]
    # Exactly 32768 UTF-8 bytes; JSON escaping also fits the provider 64KiB wire cap.
    answer = "a" * 16768 + "\n" * 16000
    transport = Transport(*(reply(chat_response(answer)) for _ in range(7)))
    chat = service(runtime_database, actor, scope, transport)
    conversation = create(chat, actor, scope)
    keys = []
    for number in range(7):
        key = uuid4()
        keys.append(key)
        chat.write(actor, scope, conversation, key, body('😀 "\\', number, number))
        if number < 6:
            chat.update_context(
                actor, scope, conversation, uuid4(), context_body(number + 1, number)
            )
    page = chat.read(actor, scope, conversation, limit=50)
    assert len(canonical(page)) <= MAX_HISTORY_BYTES
    assert 0 < len(page["turns"]) < 7
    all_turns = page["turns"]
    while page["next_cursor"]:
        page = chat.read(
            actor, scope, conversation, cursor=int(page["next_cursor"]), limit=50
        )
        assert len(canonical(page)) <= MAX_HISTORY_BYTES
        all_turns = page["turns"] + all_turns
    assert [row["number"] for row in all_turns] == list(range(1, 8))
    assert all(row["assistant_text"] == answer for row in all_turns)
    receipt = chat.read(actor, scope, conversation, turn_operation=keys[0])
    assert len(receipt["turns"]) == 1 and len(canonical(receipt)) <= MAX_HISTORY_BYTES
    fails("not_found", lambda: chat.read(actor, scope, conversation, cursor=999))
    fails("invalid_request", lambda: chat.read(actor, scope, conversation, limit=51))


def test_context_scope_isolation_and_retained_guards(
    runtime_database, migrated_database, actors
):
    actor, scope = actors[0]
    other, other_scope = actors[1]
    chat = Conversations(runtime_database)
    conversation = create(chat, actor, scope)
    other_conversation = create(chat, other, other_scope)
    operation = uuid4()
    chat.update_context(
        actor, scope, conversation, operation, context_body(notes="Correction")
    )
    for action in (
        lambda: chat.active(other, scope),
        lambda: chat.update_context(
            other, scope, conversation, uuid4(), context_body()
        ),
        lambda: chat.update_context(
            actor, scope, other_conversation, uuid4(), context_body()
        ),
        lambda: chat.context_operation(other, other_scope, conversation, operation),
        lambda: chat.context_operation(actor, scope, conversation, uuid4()),
    ):
        assert fails("not_found", action) == 404
    for engine in (runtime_database, migrated_database):
        for sql in (
            "UPDATE chat_context_revision SET notes = 'rewritten'",
            "DELETE FROM chat_context_revision",
            "DELETE FROM chat_active_conversation",
            "DELETE FROM chat_open_operation",
            "UPDATE chat_active_conversation SET conversation_id = conversation_id",
            "UPDATE chat_open_operation SET conversation_id = conversation_id",
            "UPDATE chat_conversation SET context_revision = context_revision + 1",
        ):
            with pytest.raises(DBAPIError), engine.begin() as db:
                db.execute(text(sql))
    with pytest.raises(DBAPIError), runtime_database.begin() as db:
        db.execute(
            text(
                "INSERT INTO chat_open_operation(scope_id, operation_id, conversation_id) VALUES (:scope, :operation, :conversation)"
            ),
            {"scope": scope, "operation": uuid4(), "conversation": other_conversation},
        )


def test_direct_runtime_cannot_skip_retained_turn_numbers(runtime_database, actors):
    actor, scope = actors[0]
    chat = service(runtime_database, actor, scope, Transport(reply(chat_response())))
    conversation = create(chat, actor, scope)
    chat.write(actor, scope, conversation, uuid4(), body())
    with pytest.raises(DBAPIError), runtime_database.begin() as db:
        db.execute(text("UPDATE chat_conversation SET version = version + 1"))
        db.execute(text("UPDATE chat_conversation SET version = version + 1"))
        # Clone the retained metadata only to exercise the admission trigger at runtime.
        db.execute(
            text("""
            INSERT INTO chat_turn(id, conversation_id, scope_id, actor_id, operation_id,
                request_fingerprint, payload_sha256, profile_fingerprint, configuration,
                number, context_revision, user_text, state, reserved_usd, created_at, deadline_at)
            SELECT :id, conversation_id, scope_id, actor_id, :operation,
                request_fingerprint, payload_sha256, profile_fingerprint, configuration,
                3, context_revision, user_text, 'generating', reserved_usd, created_at, deadline_at
            FROM chat_turn WHERE conversation_id = :conversation
        """),
            {"id": uuid4(), "operation": uuid4(), "conversation": conversation},
        )
    assert chat.active(actor, scope)["conversation"]["version"] == 1
