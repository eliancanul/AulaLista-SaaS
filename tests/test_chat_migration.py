"""Additive legacy-chat migration, including retained global uncertainty."""

import hashlib
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from test_chat import body, fails, service
from test_openai_planning import Transport

from aulalista_api.chat import Conversations
from aulalista_api.planning_generation import canonical


def snapshot(db):
    return {
        table: db.execute(text(f"SELECT to_jsonb(t) FROM {table} t ORDER BY id"))
        .scalars()
        .all()
        for table in ("chat_conversation", "chat_turn", "ai_budget_reservation")
    }


def seed_legacy(db, actor, scope, conversation, instant, state):
    opening, operation, turn = uuid4(), uuid4(), uuid4()
    question = "Legacy original"
    fingerprint = hashlib.sha256(
        canonical(
            {
                "conversation_id": str(conversation),
                "text": question,
                "expected_version": 0,
            }
        )
    ).hexdigest()
    params = {
        "actor": actor,
        "scope": scope,
        "conversation": conversation,
        "instant": instant,
        "opening": opening,
        "operation": operation,
        "turn": turn,
        "fingerprint": fingerprint,
        "question": question,
    }
    db.execute(
        text("""
        INSERT INTO chat_conversation(id, scope_id, actor_id, operation_id, title,
            version, created_at, updated_at)
        VALUES (:conversation, :scope, :actor, :opening, 'Legacy', 0, :instant, :instant)
    """),
        params,
    )
    db.execute(
        text("UPDATE chat_conversation SET version = 1 WHERE id = :conversation"),
        params,
    )
    db.execute(
        text("""
        INSERT INTO chat_turn(id, conversation_id, scope_id, actor_id, operation_id,
            request_fingerprint, payload_sha256, profile_fingerprint, configuration,
            number, user_text, state, reserved_usd, created_at, deadline_at)
        VALUES (:turn, :conversation, :scope, :actor, :operation, :fingerprint,
            :fingerprint, :fingerprint, '{"version":"private-chat-v1"}'::jsonb,
            1, :question, 'generating', 0.210768, :instant, :instant + interval '75 seconds')
    """),
        params,
    )
    if state != "generating":
        db.execute(
            text("""
            UPDATE chat_turn SET state = :state, finished_at = created_at,
                assistant_text = :answer, error_code = :error WHERE id = :turn
        """),
            {
                **params,
                "state": state,
                "answer": "Legacy answer" if state == "succeeded" else None,
                "error": "provider_timeout" if state == "uncertain" else None,
            },
        )
    return opening, operation


def test_upgrade_selects_deterministically_preserves_all_legacy_history(empty_database):
    config = Config("alembic.ini")
    command.upgrade(config, "0011_private_chat")
    actor, scope = uuid4(), uuid4()
    ids = [UUID(int=n) for n in (1, 2, 3)]
    instant = datetime.now(UTC)
    with empty_database.begin() as db:
        db.execute(text("INSERT INTO principal(id) VALUES (:actor)"), {"actor": actor})
        db.execute(
            text(
                "INSERT INTO personal_scope(id, owner_principal_id) VALUES (:scope, :actor)"
            ),
            {"scope": scope, "actor": actor},
        )
        receipts = [
            seed_legacy(db, actor, scope, ids[0], instant, "uncertain"),
            seed_legacy(
                db, actor, scope, ids[1], instant + timedelta(seconds=1), "succeeded"
            ),
            seed_legacy(
                db, actor, scope, ids[2], instant + timedelta(seconds=1), "succeeded"
            ),
        ]
        before = snapshot(db)
    command.upgrade(config, "head")
    with empty_database.connect() as db:
        after = snapshot(db)
        assert (
            db.execute(
                text(
                    "SELECT conversation_id FROM chat_active_conversation WHERE scope_id = :scope"
                ),
                {"scope": scope},
            ).scalar_one()
            == ids[2]
        )
        assert (
            db.execute(text("SELECT count(*) FROM chat_context_revision")).scalar_one()
            == 3
        )
        assert (
            db.execute(text("SELECT count(*) FROM chat_open_operation")).scalar_one()
            == 3
        )
    for table in before:
        assert [
            {k: v for k, v in row.items() if k != "context_revision"}
            for row in after[table]
        ] == before[table]
    chat = Conversations(empty_database)
    assert chat.active(actor, scope)["conversation"]["id"] == str(ids[2])
    assert chat.create(actor, scope, uuid4())["conversation"]["id"] == str(ids[2])
    for conversation, (opening, operation) in zip(ids, receipts, strict=True):
        recovered = chat.read(actor, scope, creation_operation=opening)
        assert recovered["conversation"]["id"] == str(conversation)
        assert chat.create(actor, scope, opening) == recovered
        assert recovered["conversation"]["active"] is (conversation == ids[2])
        assert len(recovered["turns"]) == 1
        assert (
            chat.read(actor, scope, conversation, turn_operation=operation)["turns"]
            == recovered["turns"]
        )
    assert (
        chat.write(actor, scope, ids[1], receipts[1][1], body("Legacy original"))[
            "turns"
        ][0]["assistant_text"]
        == "Legacy answer"
    )
    fails(
        "chat_uncertain",
        lambda: chat.write(
            actor, scope, ids[0], receipts[0][1], body("Legacy original")
        ),
    )
    fails(
        "chat_archived",
        lambda: chat.write(actor, scope, ids[1], uuid4(), body(version=1)),
    )
    transport = Transport()
    enabled = service(empty_database, actor, scope, transport)
    fails(
        "chat_busy",
        lambda: enabled.write(actor, scope, ids[2], uuid4(), body(version=1)),
    )
    assert transport.calls == []
    with pytest.raises(DBAPIError):
        command.downgrade(config, "0011_private_chat")
    with empty_database.connect() as db:
        assert db.execute(text("SELECT count(*) FROM chat_turn")).scalar_one() == 3
        assert (
            db.execute(text("SELECT count(*) FROM ai_budget_reservation")).scalar_one()
            == 3
        )


def test_empty_context_migration_round_trip_restores_old_guards(empty_database):
    config = Config("alembic.ini")
    command.upgrade(config, "head")
    command.downgrade(config, "0011_private_chat")
    actor, scope = uuid4(), uuid4()
    with empty_database.begin() as db:
        db.execute(text("INSERT INTO principal(id) VALUES (:actor)"), {"actor": actor})
        db.execute(
            text(
                "INSERT INTO personal_scope(id, owner_principal_id) VALUES (:scope, :actor)"
            ),
            {"scope": scope, "actor": actor},
        )
        seed_legacy(db, actor, scope, uuid4(), datetime.now(UTC), "succeeded")
    command.upgrade(config, "head")
    assert (
        Conversations(empty_database).active(actor, scope)["conversation"]["version"]
        == 1
    )
