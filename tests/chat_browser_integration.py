"""Production chat UI/auth/HTTP/PostgreSQL, synthetic provider and delivery only."""

import subprocess
from copy import deepcopy
from pathlib import Path
from uuid import uuid4

import auth_browser_integration as auth_harness
from browser_integration import run_process_group
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_openai_planning import completed, reply

from aulalista_api.ai_budget import BudgetReservation
from aulalista_api.auth_models import Identity
from aulalista_api.chat_models import ChatTurn
from aulalista_api.openai_planning import OpenAIPlanning
from aulalista_api.pilot_runtime import create_window_app


def command():
    return [
        "npx",
        "--no-install",
        "playwright",
        "test",
        "--config",
        "playwright.chat.config.ts",
    ]


def test_chat_runner_discovers_the_connected_journey():
    result = subprocess.run(
        [*command(), "--list"],
        cwd=Path(__file__).resolve().parents[1] / "web",
        capture_output=True,
        text=True,
        check=True,
        timeout=20,
    )
    assert "Total: 1 test in 1 file" in result.stdout


def test_chat_two_turns_through_real_auth_browser(
    runtime_database, actors, monkeypatch
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
        if len(messages) == 1:
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
        "AULALISTA_PILOT_BUDGET_USD": "2",
        "AULALISTA_PILOT_ADDITIONAL_RESERVE_USD": "0",
        "OPENAI_API_KEY": "software-chat-credential-only",
    }.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setattr(
        OpenAIPlanning, "_send", lambda self, url, payload: transport(url, payload)
    )
    monkeypatch.setattr(auth_harness, "create_app", create_window_app)

    def run_chat(_command, **kwargs):
        run_process_group([*command(), "--reporter=line"], **kwargs)

    monkeypatch.setattr(auth_harness, "run_process_group", run_chat)
    auth_harness.test_auth_journey_through_real_api(runtime_database, monkeypatch)
    assert len(calls) == 2
    with Session(runtime_database) as db:
        turns = db.scalars(select(ChatTurn)).all()
        reservations = db.scalars(select(BudgetReservation)).all()
        assert len(turns) == len(reservations) == 2
        assert all(
            turn.state == "succeeded" and turn.scope_id == scope for turn in turns
        )
        assert all(
            item.kind == "chat" and item.state == "succeeded" for item in reservations
        )
