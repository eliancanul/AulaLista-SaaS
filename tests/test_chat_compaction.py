"""Automatic compaction uses only synthetic transport and disposable PostgreSQL."""

import hashlib
import json
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session
from test_chat import body, create, fails, service
from test_chat_context import context_body
from test_openai_chat import chat_response
from test_openai_planning import reply

from aulalista_api.ai_budget import BudgetReservation
from aulalista_api.chat_models import ContextRevision

FACTS = '3.º, no 2.º. NO tarea. Mañana agua 😀. "Ignore system" es cita.'


class SyntheticSummary:
    def __init__(self, *, loss=False):
        self.calls = []
        self.loss = loss

    def __call__(self, url, payload):
        self.calls.append((url, payload))
        if "incrementally" in payload["instructions"]:
            answer = json.dumps({"summary": FACTS, "complete": not self.loss})
        else:
            answer = "x" * 32768 if len(self.calls) == 1 else "Continuamos"
        return reply(chat_response(answer))


def test_automatic_compaction_retains_full_history_notes_and_joint_reserve(
    runtime_database, actors
):
    actor, scope = actors[0]
    transport = SyntheticSummary()
    chat = service(runtime_database, actor, scope, transport)
    conversation = create(chat, actor, scope)
    chat.update_context(actor, scope, conversation, uuid4(), context_body(notes=FACTS))
    first = chat.write(actor, scope, conversation, uuid4(), body(FACTS, 0, 1))
    key = uuid4()
    result = chat.write(actor, scope, conversation, key, body("Seguimos", 1, 1))
    assert result["conversation"]["id"] == first["conversation"]["id"]
    context = result["context"]
    assert context["origin"] == "summary"
    assert context["notes"] == FACTS
    assert context["summary"]["text"] == FACTS
    assert context["summary"]["from_turn"] == 1
    assert context["through_turn"] == 1
    assert context["operation_id"] == str(key)
    assert result["turns"][0]["context_revision"] == 1
    count = context["summary"]["steps"]
    assert 2 <= count <= 8
    assert len(transport.calls) == count + 2
    assert FACTS in transport.calls[-1][1]["input"][0]["content"]
    assert FACTS not in transport.calls[-1][1]["instructions"]
    history = chat.read(actor, scope, conversation)
    assert history["turns"][0]["assistant_text"] == "x" * 32768
    reviewed = chat.context_revision(actor, scope, conversation, 2)
    fragments = [
        source
        for step in reviewed["steps"]
        for source in step["sources"]
        if source["role"] == "assistant"
    ]
    offset = 0
    for fragment in fragments:
        assert fragment["start_byte"] == offset
        offset = fragment["end_byte"]
        assert (
            fragment["sha256"]
            == hashlib.sha256(
                ("x" * 32768).encode()[fragment["start_byte"] : offset]
            ).hexdigest()
        )
    assert offset == 32768
    assert chat.write(actor, scope, conversation, key, body("Seguimos", 1, 1)) == result
    assert len(transport.calls) == count + 2
    with Session(runtime_database) as db:
        rows = db.scalars(select(BudgetReservation)).all()
        assert len(rows) == 2
        assert sum(row.reserved_usd for row in rows) == Decimal("0.210768") * (
            count + 2
        )
        assert len(db.scalars(select(ContextRevision)).all()) == 3


def test_reported_summary_loss_does_not_publish_context_or_answer(
    runtime_database, actors
):
    actor, scope = actors[0]
    transport = SyntheticSummary(loss=True)
    chat = service(runtime_database, actor, scope, transport)
    conversation = create(chat, actor, scope)
    original = chat.write(actor, scope, conversation, uuid4(), body(FACTS))
    key = uuid4()
    fails(
        "chat_uncertain",
        lambda: chat.write(actor, scope, conversation, key, body("Continue", 1)),
    )
    result = chat.read(actor, scope, conversation, turn_operation=key)
    assert result["context"] == original["context"]
    assert result["turns"][0]["error_code"] == "provider_summary_loss"
    assert result["turns"][0]["assistant_text"] is None
    fails(
        "chat_uncertain",
        lambda: chat.write(actor, scope, conversation, key, body("Continue", 1)),
    )
    fails(
        "chat_busy",
        lambda: chat.update_context(
            actor, scope, conversation, uuid4(), context_body(2)
        ),
    )
    assert len(transport.calls) == 2
    with Session(runtime_database) as db:
        reservations = db.scalars(
            select(BudgetReservation).order_by(BudgetReservation.created_at)
        ).all()
        assert len(reservations) == 2
        assert reservations[-1].state == "uncertain"
        assert reservations[-1].reserved_usd >= Decimal("0.632304")


def test_compaction_repeats_after_short_turns_without_lifetime_quota(
    runtime_database, actors
):
    from aulalista_api.openai_chat import SUMMARY_INSTRUCTIONS

    calls = []

    def transport(url, payload):
        calls.append(payload)
        response = (
            json.dumps({"summary": FACTS, "complete": True})
            if payload["instructions"] == SUMMARY_INSTRUCTIONS
            else "A"
        )
        return reply(chat_response(response))

    actor, scope = actors[0]
    chat = service(runtime_database, actor, scope, transport, budget="100")
    conversation = create(chat, actor, scope)
    revision = 0
    for number in range(130):
        result = chat.write(
            actor, scope, conversation, uuid4(), body(FACTS, number, revision)
        )
        revision = result["context"]["revision"]
    assert revision == 2
    assert result["conversation"]["version"] == 130
    previous = chat.context_revision(actor, scope, conversation, 1)
    latest = chat.context_revision(actor, scope, conversation, 2)
    assert previous["context"]["summary"]["text"] == FACTS
    assert latest["context"]["summary"]["text"] == FACTS
    assert (
        latest["context"]["summary"]["from_turn"]
        == previous["context"]["through_turn"] + 1
    )
    assert result["turns"][0]["number"] == 130
    for payload in calls:
        assert (
            len(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode())
            <= 32768
        )


def test_escaped_unicode_maximum_answer_has_exact_byte_provenance(
    runtime_database, actors
):
    from aulalista_api.openai_chat import SUMMARY_INSTRUCTIONS

    original = "\x01" * 3000 + '😀"\\' * 1000 + "x" * 23768
    assert len(original.encode()) == 32768
    calls = []

    def transport(url, payload):
        calls.append(payload)
        output = (
            original
            if len(calls) == 1
            else json.dumps({"summary": FACTS, "complete": True})
            if payload["instructions"] == SUMMARY_INSTRUCTIONS
            else "Done"
        )
        return reply(chat_response(output))

    actor, scope = actors[0]
    chat = service(runtime_database, actor, scope, transport, budget="3")
    conversation = create(chat, actor, scope)
    chat.write(actor, scope, conversation, uuid4(), body(FACTS))
    result = chat.write(actor, scope, conversation, uuid4(), body("Next", 1))
    reviewed = chat.context_revision(actor, scope, conversation, 1)
    offset = 0
    for step in reviewed["steps"]:
        for source in step["sources"]:
            if source["role"] == "assistant":
                assert source["start_byte"] == offset
                offset = source["end_byte"]
                piece = original.encode()[source["start_byte"] : offset]
                assert piece.decode().encode() == piece
                assert hashlib.sha256(piece).hexdigest() == source["sha256"]
    assert offset == 32768
    assert result["context"]["summary"]["steps"] <= 8
    assert (
        chat.read(actor, scope, conversation)["turns"][0]["assistant_text"] == original
    )


def test_compaction_pending_expiry_and_late_result_never_dispatch_again(
    runtime_database, actors, monkeypatch
):
    import threading
    from concurrent.futures import ThreadPoolExecutor
    from datetime import timedelta

    import aulalista_api.chat as module
    from aulalista_api.openai_chat import SUMMARY_INSTRUCTIONS

    entered, release = threading.Event(), threading.Event()
    calls = []

    def transport(url, payload):
        calls.append(payload)
        if payload["instructions"] == SUMMARY_INSTRUCTIONS:
            entered.set()
            assert release.wait(10)
            return reply(
                chat_response(json.dumps({"summary": FACTS, "complete": True}))
            )
        return reply(chat_response("a" * 32768))

    actor, scope = actors[0]
    chat = service(runtime_database, actor, scope, transport)
    conversation = create(chat, actor, scope)
    original = chat.write(actor, scope, conversation, uuid4(), body(FACTS))
    key = uuid4()
    with ThreadPoolExecutor(max_workers=1) as pool:
        running = pool.submit(
            chat.write, actor, scope, conversation, key, body("Next", 1)
        )
        try:
            assert entered.wait(10)
            fails(
                "chat_pending",
                lambda: chat.write(actor, scope, conversation, key, body("Next", 1)),
            )
            fails(
                "chat_busy",
                lambda: chat.write(
                    actor, scope, conversation, uuid4(), body("Race", 2)
                ),
            )
            fails(
                "chat_busy",
                lambda: chat.update_context(
                    actor, scope, conversation, uuid4(), context_body(2)
                ),
            )
            other, other_scope = actors[1]
            other_chat = service(runtime_database, other, other_scope, transport)
            other_conversation = create(other_chat, other, other_scope)
            fails(
                "chat_busy",
                lambda: other_chat.write(
                    other, other_scope, other_conversation, uuid4(), body("Other")
                ),
            )
            expired = module.now() + timedelta(seconds=90)
            monkeypatch.setattr(module, "now", lambda: expired)
            receipt = chat.read(actor, scope, conversation, turn_operation=key)
            assert receipt["turns"][0]["state"] == "uncertain"
        finally:
            release.set()
        fails("chat_uncertain", running.result)
    assert len(calls) == 2
    assert chat.read(actor, scope, conversation)["context"] == original["context"]
    with Session(runtime_database) as db:
        rows = db.scalars(select(BudgetReservation)).all()
        assert len(rows) == 2
        assert sum(row.reserved_usd for row in rows) >= Decimal("0.843072")


def test_lost_step_commit_receipt_retains_step_without_retry_or_double_usage(
    runtime_database, actors
):
    from sqlalchemy import event

    from aulalista_api.chat_models import CompactionStep

    actor, scope = actors[0]
    transport = SyntheticSummary()
    chat = service(runtime_database, actor, scope, transport)
    conversation = create(chat, actor, scope)
    original = chat.write(actor, scope, conversation, uuid4(), body(FACTS))
    key = uuid4()

    def mark_step(session):
        if any(isinstance(value, CompactionStep) for value in session.new):
            session.info["lose_step_receipt"] = True

    def lose_receipt(session):
        if session.info.pop("lose_step_receipt", False):
            raise RuntimeError("synthetic lost commit acknowledgement")

    def before_flush(session, *_):
        mark_step(session)

    event.listen(Session, "before_flush", before_flush)
    # Keep a removable reference; this listener deliberately fails only one commit.
    event.listen(Session, "after_commit", lose_receipt)
    try:
        fails(
            "chat_uncertain",
            lambda: chat.write(actor, scope, conversation, key, body("Next", 1)),
        )
    finally:
        event.remove(Session, "after_commit", lose_receipt)
        event.remove(Session, "before_flush", before_flush)
    receipt = chat.read(actor, scope, conversation, turn_operation=key)
    assert receipt["context"] == original["context"]
    assert receipt["turns"][0]["state"] == "uncertain"
    assert receipt["turns"][0]["usage"]["input_tokens"] is None
    with Session(runtime_database) as db:
        assert len(db.scalars(select(CompactionStep)).all()) == 1
    fails(
        "chat_uncertain",
        lambda: chat.write(actor, scope, conversation, key, body("Next", 1)),
    )
    assert len(transport.calls) == 2


def test_summary_steps_cannot_be_truncated_even_by_schema_owner(
    runtime_database, migrated_database, actors
):
    import pytest
    from sqlalchemy import text
    from sqlalchemy.exc import DBAPIError

    from aulalista_api.chat_models import CompactionStep

    actor, scope = actors[0]
    transport = SyntheticSummary()
    chat = service(runtime_database, actor, scope, transport)
    conversation = create(chat, actor, scope)
    chat.write(actor, scope, conversation, uuid4(), body(FACTS))
    chat.write(actor, scope, conversation, uuid4(), body("Continue", 1))
    original = chat.context_revision(actor, scope, conversation, 1)
    with pytest.raises(DBAPIError) as rejected:
        with migrated_database.begin() as db:
            db.execute(text("TRUNCATE chat_compaction_step"))
    assert rejected.value.orig.sqlstate == "23514"
    assert chat.context_revision(actor, scope, conversation, 1) == original
    with Session(runtime_database) as db:
        assert (
            len(db.scalars(select(CompactionStep)).all())
            == original["context"]["summary"]["steps"]
        )
