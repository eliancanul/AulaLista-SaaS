"""Production chat UI/auth/HTTP/PostgreSQL, synthetic provider and delivery only."""

import json
import subprocess
from copy import deepcopy
from pathlib import Path
from uuid import uuid4

import auth_browser_integration as auth_harness
import pytest
from browser_integration import run_process_group
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_openai_planning import completed, reply

from aulalista_api.ai_budget import BudgetReservation
from aulalista_api.auth_models import AuthSession, Identity
from aulalista_api.chat_models import ChatTurn, ContextRevision, Conversation
from aulalista_api.openai_chat import SUMMARY_INSTRUCTIONS
from aulalista_api.openai_planning import OpenAIPlanning, ProviderError
from aulalista_api.pilot_runtime import create_window_app


def command(scenario):
    marker = {
        "context": "private multi-turn",
        "uncertain": "uncertain:",
        "versioned": "versioned context:",
        "compact-success": "compaction recovery:",
        "compact-budget": "compaction budget:",
        "compact-uncertain": "compaction uncertain:",
    }[scenario]
    return [
        "npx",
        "--no-install",
        "playwright",
        "test",
        "--config",
        "playwright.chat.config.ts",
        "--grep",
        marker,
    ]


@pytest.mark.parametrize(
    "scenario",
    [
        "context",
        "uncertain",
        "versioned",
        "compact-success",
        "compact-budget",
        "compact-uncertain",
    ],
)
def test_chat_runner_discovers_the_connected_journey(scenario):
    result = subprocess.run(
        [*command(scenario), "--list"],
        cwd=Path(__file__).resolve().parents[1] / "web",
        capture_output=True,
        text=True,
        check=True,
        timeout=20,
    )
    assert "Total: 1 test in 1 file" in result.stdout


@pytest.mark.parametrize(
    "scenario",
    [
        "context",
        "uncertain",
        "versioned",
        "compact-success",
        "compact-budget",
        "compact-uncertain",
    ],
)
def test_chat_two_turns_through_real_auth_browser(
    runtime_database, actors, monkeypatch, scenario
):
    actor, scope = actors[0]
    with Session(runtime_database) as db, db.begin():
        db.add(
            Identity(
                id=uuid4(),
                issuer="email",
                subject="chat-pilot-a@example.test",
                principal_id=actor,
                email="chat-pilot-a@example.test",
                email_verified=True,
            )
        )
    calls = []

    def transport(url, payload):
        calls.append((url, deepcopy(payload)))
        assert url == "https://api.openai.com/v1/responses"
        assert payload["text"] == {"format": {"type": "text"}}
        messages = payload["input"]
        if scenario.startswith("compact-"):
            summary = "Tema: agua. Duración corregida: 30 minutos, no 45."
            if len(calls) == 1:
                assert payload["instructions"] != SUMMARY_INSTRUCTIONS
                text = summary + '\\"😀' * 5000
                text += "a" * (32768 - len(text.encode()))
                assert len(text.encode()) == 32768
            elif payload["instructions"] == SUMMARY_INSTRUCTIONS:
                assert scenario != "compact-budget"
                if scenario == "compact-uncertain":
                    raise ProviderError("provider_timeout")
                text = json.dumps({"summary": summary, "complete": True})
            else:
                assert scenario == "compact-success"
                assert summary in messages[0]["content"]
                assert summary not in payload["instructions"]
                text = "Continuamos con agua durante 30 minutos, no 45."
            return reply(
                completed(
                    output=[
                        {
                            "type": "message",
                            "role": "assistant",
                            "status": "completed",
                            "content": [{"type": "output_text", "text": text}],
                        }
                    ]
                )
            )
        if scenario == "uncertain":
            assert (
                messages[0]["content"]
                == "Provoca incertidumbre sintética sin datos privados."
            )
            raise ProviderError("provider_timeout")
        if scenario == "versioned" and len(calls) >= 3:
            notes = "Contexto nuevo: usamos la palabra brújula, no farol."
            assert notes in messages[0]["content"]
            assert notes not in payload["instructions"]
            assert all(
                "Recuerda la palabra farol" not in message["content"]
                and "Recordaré farol" not in message["content"]
                and "Contexto confirmado: farol" not in message["content"]
                for message in messages
            )
            if len(calls) == 3:
                assert len(messages) == 1
                assert messages[0]["role"] == "user"
                assert messages[0]["content"].endswith(
                    "¿Qué palabra corresponde al contexto actualizado?"
                )
                text = "Contexto actualizado: brújula"
            else:
                assert len(calls) == 4
                assert [m["role"] for m in messages] == ["user", "assistant", "user"]
                assert messages[1]["content"] == "Contexto actualizado: brújula"
                assert (
                    messages[2]["content"] == "Confirma la palabra del contexto nuevo."
                )
                text = "Contexto confirmado: brújula"
        elif len(messages) == 1:
            assert (
                messages[0]["content"]
                == "Recuerda la palabra farol para esta conversación sintética."
            )
            text = "Recordaré farol en esta conversación sintética."
        else:
            assert [m["role"] for m in messages] == ["user", "assistant", "user"]
            assert "farol" in messages[1]["content"]
            assert (
                messages[-1]["content"]
                == "¿Qué palabra acordamos? Responde usando el contexto confirmado."
            )
            text = "Contexto confirmado: farol"
        return reply(
            completed(
                output=[
                    {
                        "type": "message",
                        "role": "assistant",
                        "status": "completed",
                        "content": [{"type": "output_text", "text": text}],
                    }
                ]
            )
        )

    for name, value in {
        "AULALISTA_PILOT_ENABLED": "true",
        "AULALISTA_PILOT_ACTOR_ID": str(actor),
        "AULALISTA_PILOT_SCOPE_ID": str(scope),
        "AULALISTA_PILOT_BUDGET_USD": "0.5" if scenario == "compact-budget" else "2",
        "AULALISTA_PILOT_ADDITIONAL_RESERVE_USD": "0",
        "OPENAI_API_KEY": "software-chat-credential-only",
    }.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setattr(
        OpenAIPlanning, "_send", lambda self, url, payload: transport(url, payload)
    )
    monkeypatch.setattr(auth_harness, "create_app", create_window_app)

    def run_chat(_command, **kwargs):
        run_process_group([*command(scenario), "--reporter=line"], **kwargs)

    monkeypatch.setattr(auth_harness, "run_process_group", run_chat)
    auth_harness.test_auth_journey_through_real_api(runtime_database, monkeypatch)
    if scenario.startswith("compact-"):
        with Session(runtime_database) as db:
            turns = db.scalars(select(ChatTurn).order_by(ChatTurn.number)).all()
            reservations = db.scalars(select(BudgetReservation)).all()
            revisions = db.scalars(
                select(ContextRevision).order_by(ContextRevision.revision)
            ).all()
            assert (
                len(turns)
                == len(reservations)
                == (1 if scenario == "compact-budget" else 2)
            )
            assert (
                turns[0].state == "succeeded"
                and len(turns[0].assistant_text.encode()) == 32768
            )
            if scenario == "compact-success":
                assert len(calls) >= 4
                assert len(revisions) == 2 and revisions[-1].origin == "summary"
                assert turns[-1].state == "succeeded"
                assert (
                    sum(item.reserved_usd for item in reservations)
                    == len(calls) * turns[0].reserved_usd
                )
            else:
                assert len(revisions) == 1 and revisions[0].origin == "initial"
                assert len(calls) == (1 if scenario == "compact-budget" else 2)
                if scenario == "compact-uncertain":
                    assert (
                        turns[-1].state == "uncertain"
                        and turns[-1].assistant_text is None
                    )
                    assert turns[-1].reserved_usd >= 3 * turns[0].reserved_usd
        return
    expected_count = {"context": 2, "uncertain": 1, "versioned": 4}[scenario]
    expected_state = "uncertain" if scenario == "uncertain" else "succeeded"
    assert len(calls) == expected_count
    with Session(runtime_database) as db:
        turns = db.scalars(select(ChatTurn)).all()
        reservations = db.scalars(select(BudgetReservation)).all()
        assert len(turns) == len(reservations) == expected_count
        assert all(
            turn.state == expected_state and turn.scope_id == scope for turn in turns
        )
        assert all(
            item.kind == "chat" and item.state == expected_state
            for item in reservations
        )

        if scenario == "versioned":
            conversations = db.scalars(select(Conversation)).all()
            revisions = db.scalars(
                select(ContextRevision).order_by(ContextRevision.revision)
            ).all()
            assert len(conversations) == 1
            assert conversations[0].version == 4
            assert conversations[0].context_revision == 2
            assert [revision.origin for revision in revisions] == [
                "initial",
                "manual",
                "reset",
            ]
            assert [revision.through_turn for revision in revisions] == [0, 2, 4]
            assert [
                turn.context_revision for turn in sorted(turns, key=lambda t: t.number)
            ] == [0, 0, 1, 1]
            assert (
                sum(item.reserved_usd for item in reservations)
                == 4 * reservations[0].reserved_usd
            )

        if scenario == "uncertain":
            assert turns[0].assistant_text is None
            assert str(reservations[0].reserved_usd) == "0.210768000"
            sessions = db.scalars(
                select(AuthSession).where(AuthSession.principal_id == actor)
            ).all()
            assert sessions and all(session.revoked for session in sessions)
