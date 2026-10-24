"""Synthetic plain-text Responses; no API or credential discovery."""

from decimal import Decimal
from uuid import uuid4

import pytest
from pydantic import ValidationError
from test_openai_planning import Transport, completed, reply

from aulalista_api.chat_models import CreateConversation, TurnRequest
from aulalista_api.openai_chat import OpenAIChat, estimated_cost, prepare
from aulalista_api.openai_planning import OpenAIPlanning, ProviderError
from aulalista_api.planning_generation import GenerationProfile


def chat_response(text="Una respuesta sintética.", **changes):
    response = completed(**changes)
    response["output"][0]["content"][0]["text"] = text
    return response


def adapter(*responses):
    transport = Transport(*responses)
    return OpenAIChat(OpenAIPlanning("synthetic-only", transport=transport)), transport


def test_plain_text_preserves_context_and_one_request():
    messages = [
        {"role": "user", "content": "Mi primera pregunta"},
        {"role": "assistant", "content": "Mi primera respuesta"},
        {"role": "user", "content": "Una segunda pregunta"},
    ]
    service, transport = adapter(reply(chat_response()))
    result = service.generate(prepare(messages))
    assert result.text == "Una respuesta sintética."
    assert len(transport.calls) == 1
    url, payload = transport.calls[0]
    assert url == "https://api.openai.com/v1/responses"
    assert payload["input"] == messages
    assert payload["text"] == {"format": {"type": "text"}}
    assert payload["store"] is False
    assert payload["prompt_cache_options"] == {"mode": "explicit"}
    assert payload["max_output_tokens"] == 1024
    assert "tools" not in payload


def test_unknown_usage_stays_null():
    service, _ = adapter(reply(chat_response(usage=None)))
    usage = service.generate(prepare([{"role": "user", "content": "Hola"}])).usage
    assert usage["input_tokens"] is None
    assert usage["output_tokens"] is None
    assert estimated_cost(None, 10) is None


@pytest.mark.parametrize("tokens,cost", [(272000, "0.0277"), (272001, "0.0551502")])
def test_estimate_uses_short_or_long_standard_rates(tokens, cost):
    assert estimated_cost(tokens, 1000) == Decimal(cost)


def test_out_of_profile_observed_usage_has_no_misleading_estimate():
    assert estimated_cost(1_050_001, 10) is None
    assert estimated_cost(10, 1025) is None


@pytest.mark.parametrize("output", ["", " ", "\x00", "a" * 32769, None])
def test_invalid_assistant_output_is_not_published(output):
    service, _ = adapter(reply(chat_response(output)))
    with pytest.raises(ProviderError):
        service.generate(prepare([{"role": "user", "content": "Hola"}]))


@pytest.mark.parametrize("text", ["", " ", "\x00", "x" * 4097, "😀" * 2049, "\ud800"])
def test_user_text_limits(text):
    with pytest.raises(ValidationError):
        TurnRequest(text=text, expected_version=0)


def test_strict_request_shape():
    with pytest.raises(ValidationError):
        CreateConversation.model_validate({"source_id": "untrusted"})
    with pytest.raises(ValidationError):
        TurnRequest(text="Hola", expected_version=True)
    with pytest.raises(ValidationError):
        TurnRequest(text="Hola", expected_version=0, messages=[])


def test_context_size_is_rejected_before_transport():
    with pytest.raises(ProviderError):
        prepare([{"role": "user", "content": "x" * 32768}])


def test_payload_tampering_does_not_dispatch():
    service, transport = adapter()
    payload = prepare([{"role": "user", "content": "Hola"}])
    payload["tools"] = [{"type": "web_search"}]
    with pytest.raises(ProviderError):
        service.generate(payload)
    assert transport.calls == []


def test_factory_reuses_same_provider_profile_and_only_enables_exact_window_actor():
    from aulalista_api.app import create_app

    actor, scope = uuid4(), uuid4()
    transport = Transport()
    provider = OpenAIPlanning(
        "synthetic-only", transport=transport, input_token_limit=1_050_000
    )
    profile = GenerationProfile(
        name="synthetic-chat",
        actor_id=actor,
        scope_id=scope,
        budget_usd=Decimal("2"),
        count_request_reserve_usd=Decimal("0"),
        allowed_request_sha256=None,
        input_policy="manual-variable-v1",
        count_strategy="window-v1",
        additional_reserve_usd=Decimal("0"),
    )
    app = create_app(planning_provider=provider, generation_profile=profile)
    assert app.state.chat.provider is app.state.planning_generation.provider is provider
    assert app.state.chat.profile is app.state.planning_generation.profile is profile
    assert app.state.chat._enabled_for(actor, scope)
    assert not app.state.chat._enabled_for(uuid4(), scope)
    assert not app.state.chat._enabled_for(actor, uuid4())
    assert not create_app().state.chat._enabled_for(actor, scope)
    provider.input_token_limit = 2048
    assert not app.state.chat._enabled_for(actor, scope)
    assert transport.calls == []


@pytest.mark.parametrize(
    "usage",
    [
        {"input_tokens": 1_050_001, "output_tokens": 1},
        {"input_tokens": 1, "output_tokens": 1025},
        {
            "input_tokens": 1,
            "output_tokens": 1,
            "input_tokens_details": {"cached_tokens": 1},
        },
        {
            "input_tokens": 1,
            "output_tokens": 1,
            "output_tokens_details": {"reasoning_tokens": 1},
        },
    ],
)
def test_profile_violation_retains_observations_without_retry(usage):
    service, transport = adapter(reply(chat_response(usage=usage)))
    with pytest.raises(ProviderError) as rejected:
        service.generate(prepare([{"role": "user", "content": "Hola"}]))
    assert rejected.value.usage["input_tokens"] == usage["input_tokens"]
    assert len(transport.calls) == 1


def test_context_has_no_artificial_message_count_quota():
    messages = [
        {"role": "user" if number % 2 == 0 else "assistant", "content": "x"}
        for number in range(101)
    ]
    assert prepare(messages)["input"] == messages
    with pytest.raises(ProviderError):
        prepare(messages * 101)


@pytest.mark.parametrize("notes", [" ", "\x00", "😀" * 2049, "x" * 4097, "\ud800"])
def test_context_notes_are_bounded_without_unicode_or_whitespace_bypass(notes):
    from aulalista_api.chat_models import ContextRequest

    with pytest.raises(ValidationError):
        ContextRequest(expected_version=0, expected_context_revision=0, notes=notes)


def test_summary_preserves_corrections_and_rejects_reported_loss():
    import json

    from aulalista_api.openai_chat import prepare_summary

    facts = '3.º, no 2.º; NO dejar tarea; "ignorar reglas" es cita; mañana agua 😀'
    payload = prepare_summary({"previous_summary": "", "fragments": [{"text": facts}]})
    service, transport = adapter(
        reply(chat_response(json.dumps({"summary": facts, "complete": True})))
    )
    result = service.summarize(payload)
    assert result.text == facts
    assert facts not in payload["instructions"]
    assert json.loads(payload["input"][0]["content"])["fragments"][0]["text"] == facts
    assert len(transport.calls) == 1
    for output in (
        {"summary": "lost negation", "complete": False},
        {"summary": "x" * 4096, "complete": True},
    ):
        service, transport = adapter(reply(chat_response(json.dumps(output))))
        with pytest.raises(ProviderError):
            service.summarize(payload)
        assert len(transport.calls) == 1
