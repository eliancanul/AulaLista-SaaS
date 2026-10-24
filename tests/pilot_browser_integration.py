"""Pilot composition -> real auth/HTTP/PostgreSQL; external transports are fake."""

import hashlib
import json
import subprocess
from copy import deepcopy
from dataclasses import replace
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

import auth_browser_integration as auth_harness
import pytest
from browser_integration import run_process_group
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_openai_planning import completed, reply
from test_planning_generation import output, request

from aulalista_api.app import create_app
from aulalista_api.auth_models import Identity
from aulalista_api.materials import MaterialError
from aulalista_api.openai_planning import BASE_URL, MODEL, OpenAIPlanning, ProviderError
from aulalista_api.pilot import ManualPilotConfig
from aulalista_api.pilot_runtime import create_app as create_runtime_app
from aulalista_api.pilot_runtime import create_window_app
from aulalista_api.planning_generation import GenerationAttempt

PILOT_EMAIL = "manual-pilot-a@example.test"
UNCERTAIN_TOPIC = "Resultado incierto de software"


def pilot_command(scenario):
    return [
        "npx",
        "--no-install",
        "playwright",
        "test",
        "--config",
        "playwright.pilot.config.ts",
        "--grep",
        f"{scenario}:",
        "--output",
        f"test-results/integration/pilot-generation/{scenario}",
    ]


@pytest.mark.parametrize("scenario", ["success", "uncertain", "busy", "window"])
def test_pilot_command_selects_exactly_one_browser_journey(scenario):
    result = subprocess.run(
        [*pilot_command(scenario), "--list", "--reporter=json"],
        cwd=Path(__file__).resolve().parents[1] / "web",
        capture_output=True,
        text=True,
        timeout=20,
        check=True,
    )
    report = json.loads(result.stdout)
    titles = [spec["title"] for suite in report["suites"] for spec in suite["specs"]]
    assert not report["errors"]
    assert len(titles) == 1
    assert titles[0].startswith(f"{scenario}:")


@pytest.mark.parametrize("scenario", ["success", "uncertain", "busy", "window"])
def test_manual_pilot_through_real_auth_browser(
    runtime_database, actors, monkeypatch, scenario
):
    actor, scope = actors[0]
    # A test-only account record, not an actor/session override. Production OTP
    # verification must still issue the real cookie and CSRF-bound session.
    with Session(runtime_database) as db, db.begin():
        db.add(
            Identity(
                id=uuid4(),
                issuer="email",
                subject=PILOT_EMAIL,
                principal_id=actor,
                email=PILOT_EMAIL,
                email_verified=True,
            )
        )

    calls = []

    def transport(url, payload):
        # This seam receives an OpenAI request but never opens a network socket.
        calls.append((url, deepcopy(payload)))
        if url == "https://api.openai.com/v1/responses/input_tokens":
            return reply({"object": "response.input_tokens", "input_tokens": 120})
        assert url == "https://api.openai.com/v1/responses"
        request = json.loads(payload["input"])
        if request["topic"] == UNCERTAIN_TOPIC:
            raise ProviderError("provider_timeout")
        result = output()
        result["title"] = request["topic"]
        result["purpose"] = f"Resultado sintético de software: {request['topic']}"
        return reply(
            completed(
                output=[
                    {
                        "type": "message",
                        "role": "assistant",
                        "status": "completed",
                        "content": [
                            {"type": "output_text", "text": json.dumps(result)}
                        ],
                    }
                ]
            )
        )

    config = ManualPilotConfig(
        name="private-window-budget-v1"
        if scenario == "window"
        else "private-manual-pilot-v1",
        actor_id=actor,
        scope_id=scope,
        budget_usd=Decimal("1") if scenario == "window" else Decimal("0.1"),
        count_request_reserve_usd=Decimal("0")
        if scenario == "window"
        else Decimal("0.0001"),
        count_strategy="window-v1" if scenario == "window" else "remote-v1",
        additional_reserve_usd=Decimal("0.02")
        if scenario == "window"
        else Decimal("0"),
        input_policy="manual-variable-v1",
        provider="openai",
        destination=BASE_URL,
        model=MODEL,
    )
    profile = config.validated_profile()
    expected_actor, expected_scope = actor, scope
    if scenario == "busy":
        # Seed a real durable uncertain attempt belonging to a different actor.
        # The browser operator must never be shown its identity or operation key.
        expected_actor, expected_scope = actors[1]
        seed_calls = []

        def seed_timeout(url, payload):
            seed_calls.append(url)
            raise ProviderError("provider_timeout")

        seed_app = create_app(
            planning_provider=OpenAIPlanning(
                "software-placeholder-only", transport=seed_timeout
            ),
            pilot_config=replace(
                config, actor_id=expected_actor, scope_id=expected_scope
            ),
        )
        service = seed_app.state.planning_generation
        profile = service.profile
        try:
            with pytest.raises(MaterialError, match="generation_uncertain"):
                service.write(
                    expected_actor,
                    expected_scope,
                    uuid4(),
                    request(topic="Synthetic foreign uncertainty, not UI content"),
                )
        finally:
            service.engine.dispose()
        assert len(seed_calls) == 1

    for key, value in {
        "AULALISTA_PILOT_ENABLED": "true",
        "AULALISTA_PILOT_ACTOR_ID": str(actor),
        "AULALISTA_PILOT_SCOPE_ID": str(scope),
        "AULALISTA_PILOT_BUDGET_USD": str(config.budget_usd),
        "AULALISTA_PILOT_COUNT_RESERVE_USD": str(config.count_request_reserve_usd),
        "AULALISTA_PILOT_ADDITIONAL_RESERVE_USD": str(config.additional_reserve_usd),
        "OPENAI_API_KEY": "software-server-credential-only",
    }.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setattr(
        OpenAIPlanning, "_send", lambda self, url, payload: transport(url, payload)
    )

    def pilot_app():
        app = create_window_app() if scenario == "window" else create_runtime_app()
        assert not app.dependency_overrides
        return app

    def run_pilot(_command, **kwargs):
        run_process_group(
            [*pilot_command(scenario), "--reporter=line"],
            **kwargs,
        )

    monkeypatch.setattr(auth_harness, "create_app", pilot_app)
    monkeypatch.setattr(auth_harness, "run_process_group", run_pilot)
    auth_harness.test_auth_journey_through_real_api(runtime_database, monkeypatch)

    successes = 2 if scenario in {"window", "success"} else 0
    sends = (
        successes if scenario in {"success", "window"} else int(scenario == "uncertain")
    )
    expected_paths = (
        ["responses"] if scenario == "window" else ["input_tokens", "responses"]
    )
    assert [url.rsplit("/", 1)[-1] for url, _ in calls] == expected_paths * sends
    # No regeneration during editing, reading, printing, 401 or uncertainty GETs.
    with Session(runtime_database) as db:
        attempts = list(db.scalars(select(GenerationAttempt)))
        assert len(attempts) == (successes or 1)
        assert {attempt.actor_id for attempt in attempts} == {expected_actor}
        assert {attempt.scope_id for attempt in attempts} == {expected_scope}
        assert {attempt.profile_fingerprint for attempt in attempts} == {
            profile.fingerprint
        }
        assert len({attempt.operation_id for attempt in attempts}) == len(attempts)
        assert len({attempt.request_fingerprint for attempt in attempts}) == len(
            attempts
        )
        assert [attempt.state for attempt in attempts] == (
            ["succeeded"] * successes if successes else ["uncertain"]
        )
        assert (
            len(
                {
                    attempt.planning_revision_id
                    for attempt in attempts
                    if attempt.state == "succeeded"
                }
            )
            == successes
        )
        for attempt in attempts:
            raw = json.dumps(
                attempt.request,
                sort_keys=True,
                separators=(",", ":"),
                ensure_ascii=False,
            ).encode()
            assert attempt.request_fingerprint == hashlib.sha256(raw).hexdigest()
            assert attempt.reserved_usd == profile.reservation_usd
            assert attempt.configuration["input_policy"] == "manual-variable-v1"
            assert attempt.count_requests == int(scenario != "window")
            if scenario == "window":
                assert attempt.counted_input_tokens is None
            assert attempt.generation_requests == int(scenario != "busy")
        if not successes:
            assert attempts[0].planning_revision_id is None
        if scenario == "uncertain":
            assert attempts[0].request["topic"] == UNCERTAIN_TOPIC
