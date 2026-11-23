"""Tests for multi-teacher Orchestrator -> Subject Agent chat architecture."""

from __future__ import annotations

import json
import os
from decimal import Decimal
from uuid import uuid4

import pytest
from test_auth_integration import ORIGIN, login
from test_auth_integration import auth_factory as auth_factory

from aulalista_api.agent_chat import (
    AgentChatService,
    AgentContextRequest,
    AgentTurnRequest,
)
from aulalista_api.materials import MaterialError
from aulalista_api.openai_agent_chat import (
    AgentChatProviderError,
    AgentPromptContext,
    FakeAgentChatProvider,
    OpenAIAgentChatProvider,
    build_agent_instructions,
    load_agent_chat_provider_from_env,
)


def test_agent_chat_is_fail_closed_and_never_reads_api_key_when_disabled(monkeypatch):
    monkeypatch.delenv("AULALISTA_OPENAI_CHAT_ENABLED", raising=False)
    getitem = type(os.environ).__getitem__

    def guarded(env, key):
        if key == "OPENAI_API_KEY":
            pytest.fail("disabled agent chat must never read OPENAI_API_KEY")
        return getitem(env, key)

    monkeypatch.setattr(type(os.environ), "__getitem__", guarded)
    provider = load_agent_chat_provider_from_env()
    assert provider.is_configured is False


def test_orchestrator_and_subject_agents_stay_isolated_with_compact_digests(
    runtime_database, actors
):
    actor_a, scope_a = actors[0]
    actor_b, scope_b = actors[1]
    fake = FakeAgentChatProvider()
    service = AgentChatService(runtime_database, provider=fake)

    assert service.capability(actor_a, scope_a) == {
        "available": True,
        "model": "fake-luna-agent",
    }
    assert service.capability(actor_b, scope_b)["available"] is True

    # 1. Teacher A chats in Matemáticas agent
    mat_reply = service.send_turn(
        actor_a,
        scope_a,
        "subject:benito:benito-mat",
        uuid4(),
        AgentTurnRequest(
            text="Necesito ejercicios de fracciones equivalentes con regletas Cuisenaire",
            expected_version=0,
            agent_kind="subject",
            school_id="benito",
            school_name="Benito Juárez",
            grade="4.º A",
            shift="Matutino",
            subject_id="benito-mat",
            subject_name="Matemáticas",
        ),
    )
    assert mat_reply["turn"]["state"] == "succeeded"
    assert mat_reply["turn"]["number"] == 1
    assert mat_reply["channel"]["version"] == 1
    assert "fracciones" in mat_reply["channel"]["summary_topic"].lower()

    # 2. Teacher A chats in Español agent — must NOT see Matemáticas turns
    esp_reply = service.send_turn(
        actor_a,
        scope_a,
        "subject:benito:benito-esp",
        uuid4(),
        AgentTurnRequest(
            text="Prepara una lectura de fábula de Esopo con moraleja",
            expected_version=0,
            agent_kind="subject",
            school_id="benito",
            school_name="Benito Juárez",
            grade="4.º A",
            shift="Matutino",
            subject_id="benito-esp",
            subject_name="Español",
        ),
    )
    assert esp_reply["turn"]["number"] == 1
    esp_ctx, esp_messages = fake.calls[-1]
    assert esp_ctx.agent_kind == "subject"
    assert esp_ctx.subject_name == "Español"
    assert len(esp_messages) == 1
    assert "Cuisenaire" not in json.dumps(esp_messages)

    # 3. Teacher A chats in Orquestador — receives compact digests of BOTH subjects,
    #    never raw subject messages, and detects delegation when asking about 1 subject.
    orch_reply = service.send_turn(
        actor_a,
        scope_a,
        "orchestrator:benito",
        uuid4(),
        AgentTurnRequest(
            text="¿Cómo vamos en Matemáticas esta semana?",
            expected_version=0,
            agent_kind="orchestrator",
            school_id="benito",
            school_name="Benito Juárez",
            grade="4.º A",
            shift="Matutino",
        ),
    )
    assert orch_reply["turn"]["state"] == "succeeded"
    assert orch_reply["turn"]["delegated_subject_id"] == "benito-mat"
    orch_ctx, orch_messages = fake.calls[-1]
    assert orch_ctx.agent_kind == "orchestrator"
    assert len(orch_messages) == 1
    by_name = {d.subject_name: d for d in orch_ctx.subject_digests}
    assert by_name["Matemáticas"].turn_count == 1
    assert "fracciones" in by_name["Matemáticas"].digest.lower()
    assert by_name["Español"].turn_count == 1
    assert "fábula" in by_name["Español"].digest.lower()

    # 4. Orchestrator manual notes flow as a short brief to Subject agents
    service.update_context(
        actor_a,
        scope_a,
        "orchestrator:benito",
        uuid4(),
        AgentContextRequest(
            notes="Esta semana tenemos consejo técnico el viernes.",
            reset=False,
            agent_kind="orchestrator",
            school_id="benito",
            school_name="Benito Juárez",
            grade="4.º A",
            shift="Matutino",
        ),
    )
    mat_doc = service.get_channel(actor_a, scope_a, "subject:benito:benito-mat")
    assert "consejo técnico" in mat_doc["orchestrator_brief"]
    assert len(mat_doc["turns"]) == 1

    # 5. Resetting Matemáticas clears ONLY Matemáticas context/digest, not Español
    reset_res = service.update_context(
        actor_a,
        scope_a,
        "subject:benito:benito-mat",
        uuid4(),
        AgentContextRequest(
            notes="",
            reset=True,
            agent_kind="subject",
            school_id="benito",
            school_name="Benito Juárez",
            grade="4.º A",
            shift="Matutino",
            subject_id="benito-mat",
            subject_name="Matemáticas",
        ),
    )
    assert reset_res["channel"]["through_turn"] == 1
    assert reset_res["channel"]["digest"] == ""
    esp_doc = service.get_channel(actor_a, scope_a, "subject:benito:benito-esp")
    assert esp_doc["channel"]["through_turn"] == 0
    assert esp_doc["channel"]["digest"] != ""

    # 6. Teacher B is completely isolated from Teacher A
    b_channels = service.list_channels(actor_b, scope_b)
    assert b_channels["items"] == []
    with pytest.raises(MaterialError) as err:
        service.get_channel(actor_b, scope_a, "subject:benito:benito-mat")
    assert err.value.status == 404


def test_idempotency_conflict_and_per_scope_budget(runtime_database, actors):
    actor_a, scope_a = actors[0]
    actor_b, scope_b = actors[1]
    fake = FakeAgentChatProvider(scope_budget_usd=Decimal("0.000044"))
    service = AgentChatService(runtime_database, provider=fake)

    op = uuid4()
    req = AgentTurnRequest(
        text="Hola Luna",
        expected_version=0,
        agent_kind="orchestrator",
        school_id="benito",
        school_name="Benito Juárez",
        grade="4.º A",
    )
    first = service.send_turn(actor_a, scope_a, "orchestrator:benito", op, req)
    replay = service.send_turn(actor_a, scope_a, "orchestrator:benito", op, req)
    assert replay == first
    assert len(fake.calls) == 1

    # Budget is now exhausted for teacher A...
    with pytest.raises(MaterialError) as exhausted:
        service.send_turn(
            actor_a,
            scope_a,
            "orchestrator:benito",
            uuid4(),
            AgentTurnRequest(
                text="Segundo mensaje",
                expected_version=1,
                agent_kind="orchestrator",
                school_id="benito",
                school_name="Benito Juárez",
                grade="4.º A",
            ),
        )
    assert exhausted.value.status == 429
    assert exhausted.value.detail == "chat_budget_exhausted"

    # ...while teacher B still has full budget!
    b_first = service.send_turn(actor_b, scope_b, "orchestrator:benito", uuid4(), req)
    assert b_first["turn"]["state"] == "succeeded"


def test_agent_chat_http_routes_with_auth_and_csrf(auth_factory, runtime_database):
    factory, sender = auth_factory
    with factory() as client:
        client.app.state.agent_chat._explicit_provider = FakeAgentChatProvider()
        signed = login(client, sender, "teacher-agent@example.test")
        scope = signed["scope_id"]
        headers = {"X-CSRF-Token": signed["csrf_token"], "Origin": ORIGIN}
        cap = client.get(f"/scopes/{scope}/agent-chat/capability")
        assert cap.status_code == 200
        assert cap.json() == {"available": True, "model": "fake-luna-agent"}

        empty = client.get(f"/scopes/{scope}/agent-chat/channels/orchestrator:benito")
        assert empty.status_code == 200
        assert empty.json()["turns"] == []
        assert empty.json()["channel"]["agent_kind"] == "orchestrator"

        sent = client.post(
            f"/scopes/{scope}/agent-chat/channels/subject:benito:benito-mat/turns",
            json={
                "text": "Plan rápido de multiplicaciones",
                "expected_version": 0,
                "agent_kind": "subject",
                "school_id": "benito",
                "school_name": "Benito Juárez",
                "grade": "4.º A",
                "shift": "Matutino",
                "subject_id": "benito-mat",
                "subject_name": "Matemáticas",
            },
            headers={**headers, "Idempotency-Key": str(uuid4())},
        )
        assert sent.status_code == 201
        assert sent.json()["turn"]["state"] == "succeeded"

        listed = client.get(f"/scopes/{scope}/agent-chat/channels?school_id=benito")
        assert listed.status_code == 200
        assert len(listed.json()["items"]) == 1
        assert listed.json()["items"][0]["subject_id"] == "benito-mat"


def test_openai_agent_chat_provider_payload_and_response_parsing():
    captured = []

    def fake_transport(url, payload):
        captured.append((url, payload))
        return (
            200,
            json.dumps(
                {
                    "status": "completed",
                    "model": "gpt-6-luna-2026-10-01",
                    "output": [
                        {
                            "type": "message",
                            "role": "assistant",
                            "status": "completed",
                            "content": [
                                {
                                    "type": "output_text",
                                    "text": "Aquí tienes 3 ejercicios de fracciones.",
                                }
                            ],
                        }
                    ],
                    "usage": {
                        "input_tokens": 150,
                        "output_tokens": 40,
                        "input_tokens_details": {"cached_tokens": 32},
                    },
                }
            ).encode("utf-8"),
        )

    provider = OpenAIAgentChatProvider(
        api_key="sk-test-synthetic",
        model="gpt-6-luna",
        transport=fake_transport,
    )
    ctx = AgentPromptContext(
        agent_kind="subject",
        school_name="Benito Juárez",
        grade="4.º A",
        shift="Matutino",
        subject_name="Matemáticas",
        context_notes="Grupo visual, le gustan retos cortos.",
    )
    reply = provider.generate(
        context=ctx,
        messages=[{"role": "user", "content": "Dame ejercicios de fracciones"}],
    )
    assert reply.text == "Aquí tienes 3 ejercicios de fracciones."
    assert reply.model == "gpt-6-luna-2026-10-01"
    assert reply.input_tokens == 150
    assert reply.output_tokens == 40
    assert captured[0][0] == "https://api.openai.com/v1/responses"
    assert captured[0][1]["reasoning"] == {"effort": "none"}
    assert "Grupo visual" in captured[0][1]["input"][0]["content"]
    assert "Matemáticas" in build_agent_instructions(ctx)

    # Refusal maps cleanly to 422
    refusal_provider = OpenAIAgentChatProvider(
        api_key="sk-test-synthetic",
        transport=lambda _u, _p: (
            200,
            json.dumps(
                {
                    "status": "completed",
                    "output": [
                        {
                            "type": "message",
                            "content": [{"type": "refusal", "refusal": "no"}],
                        }
                    ],
                }
            ).encode("utf-8"),
        ),
    )
    with pytest.raises(AgentChatProviderError) as err:
        refusal_provider.generate(
            context=ctx, messages=[{"role": "user", "content": "x"}]
        )
    assert err.value.code == "chat_refusal"
    assert err.value.status == 422


def test_unified_chat_auto_routes_subjects_and_keeps_contexts_isolated(
    runtime_database, actors
):
    actor_a, scope_a = actors[0]
    # Budget allows exactly 3 calls (0.000044 * 3 = 0.000132) — mirroring must NOT double-count!
    fake = FakeAgentChatProvider(scope_budget_usd=Decimal("0.000132"))
    service = AgentChatService(runtime_database, provider=fake)

    # 1. Message about fractions on unified school chat auto-routes to Matemáticas
    t1 = service.send_turn(
        actor_a,
        scope_a,
        "orchestrator:benito",
        uuid4(),
        AgentTurnRequest(
            text="Dame ejercicios de fracciones equivalentes con regletas Cuisenaire",
            expected_version=0,
            agent_kind="orchestrator",
            school_id="benito",
            school_name="Benito Juárez",
            grade="4.º A",
            shift="Matutino",
        ),
    )
    assert t1["turn"]["state"] == "succeeded"
    assert t1["turn"]["delegated_subject_id"] == "benito-mat"
    ctx1, msgs1 = fake.calls[-1]
    assert ctx1.agent_kind == "subject"
    assert ctx1.subject_name == "Matemáticas"
    assert len(msgs1) == 1

    # 2. Message about cuento/ortografía auto-routes to Español with ZERO Matemáticas clutter
    t2 = service.send_turn(
        actor_a,
        scope_a,
        "orchestrator:benito",
        uuid4(),
        AgentTurnRequest(
            text="Prepara una actividad de ortografía con un cuento breve",
            expected_version=1,
            agent_kind="orchestrator",
            school_id="benito",
            school_name="Benito Juárez",
            grade="4.º A",
            shift="Matutino",
        ),
    )
    assert t2["turn"]["delegated_subject_id"] == "benito-esp"
    ctx2, msgs2 = fake.calls[-1]
    assert ctx2.agent_kind == "subject"
    assert ctx2.subject_name == "Español"
    assert len(msgs2) == 1
    assert "Cuisenaire" not in json.dumps(msgs2)

    # 3. Weekly coordination message stays general and gets compact digests of both subjects
    t3 = service.send_turn(
        actor_a,
        scope_a,
        "orchestrator:benito",
        uuid4(),
        AgentTurnRequest(
            text="Organiza la semana del grupo considerando lo que ya trabajamos",
            expected_version=2,
            agent_kind="orchestrator",
            school_id="benito",
            school_name="Benito Juárez",
            grade="4.º A",
            shift="Matutino",
        ),
    )
    assert t3["turn"]["delegated_subject_id"] is None
    ctx3, msgs3 = fake.calls[-1]
    assert ctx3.agent_kind == "orchestrator"
    assert "Cuisenaire" not in json.dumps(msgs3)
    by_name = {d.subject_name: d for d in ctx3.subject_digests}
    assert by_name["Matemáticas"].turn_count == 1
    assert "fracciones" in by_name["Matemáticas"].digest.lower()
    assert by_name["Español"].turn_count == 1
    assert "ortografía" in by_name["Español"].digest.lower()

    # Instructions must never tell Luna to talk about "orquestador" as a role
    general_instructions = build_agent_instructions(ctx3).lower()
    assert "la coordinadora general (orquestadora)" not in general_instructions
    assert "nunca menciones 'orquestador'" in general_instructions

