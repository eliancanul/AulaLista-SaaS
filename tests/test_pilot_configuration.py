"""Opt-in assembly validates non-secret configuration before opening resources."""

import os
from dataclasses import replace
from decimal import Decimal
from uuid import uuid4

import pytest

import aulalista_api.app as app_module
from aulalista_api.app import create_app
from aulalista_api.openai_planning import BASE_URL, MODEL, OpenAIPlanning
from aulalista_api.pilot import ManualPilotConfig


def pilot_config(**changes):
    return ManualPilotConfig(
        **{
            "name": "software-pilot-only",
            "actor_id": uuid4(),
            "scope_id": uuid4(),
            "budget_usd": Decimal("0.1"),
            "count_request_reserve_usd": Decimal("0.0001"),
            "provider": "openai",
            "destination": BASE_URL,
            "model": MODEL,
            "input_policy": "manual-variable-v1",
            **changes,
        }
    )


def no_transport(*args, **kwargs):
    pytest.fail("configuration must never contact a provider")


def test_normal_factory_ignores_credential_and_pilot_environment(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "synthetic-not-a-key")
    monkeypatch.setenv("AULALISTA_PILOT_ENABLED", "true")
    getitem = type(os.environ).__getitem__

    def guarded(environment, key):
        if key in {"OPENAI_API_KEY", "AULALISTA_PILOT_ENABLED"}:
            pytest.fail("normal factory must not discover pilot configuration")
        return getitem(environment, key)

    monkeypatch.setattr(type(os.environ), "__getitem__", guarded)
    monkeypatch.setattr(OpenAIPlanning, "__post_init__", no_transport)
    app = create_app()
    assert app.state.planning_generation.provider is None
    assert app.state.planning_generation.profile is None


def test_valid_explicit_composition_builds_profile_without_transport():
    config = pilot_config()
    provider = OpenAIPlanning("software-placeholder-only", transport=no_transport)
    app = create_app(planning_provider=provider, pilot_config=config)
    service = app.state.planning_generation
    assert service.provider is provider
    assert service.profile.actor_id == config.actor_id
    assert service.profile.scope_id == config.scope_id
    assert service.profile.input_policy == "manual-variable-v1"
    assert service.profile.allowed_request_sha256 is None
    assert service.profile.budget_usd == config.budget_usd


@pytest.mark.parametrize(
    "field, value",
    [
        ("name", ""),
        ("actor_id", None),
        ("scope_id", None),
        ("actor_id", "not-a-uuid"),
        ("provider", "other"),
        ("destination", "https://unapproved.example/v1"),
        ("destination", "http://api.openai.com/v1"),
        ("destination", BASE_URL + "/"),
        ("model", "other-model"),
        ("input_policy", "exact-input-v1"),
        ("input_policy", None),
        ("budget_usd", Decimal("0.0001")),
        ("budget_usd", Decimal("NaN")),
        ("budget_usd", Decimal("Infinity")),
        ("budget_usd", Decimal("0")),
        ("budget_usd", Decimal("-1")),
        ("budget_usd", Decimal("0.1000000001")),
        ("budget_usd", "0.1"),
        ("budget_usd", 0.1),
        ("budget_usd", True),
        ("count_request_reserve_usd", Decimal("0")),
        ("count_request_reserve_usd", Decimal("0.0000000001")),
        ("count_request_reserve_usd", Decimal("1")),
        ("count_request_reserve_usd", Decimal("NaN")),
        ("count_request_reserve_usd", False),
    ],
)
def test_invalid_pilot_fails_before_engine_and_transport(monkeypatch, field, value):
    config = replace(pilot_config(), **{field: value})
    monkeypatch.setattr(app_module, "make_engine", no_transport)
    with pytest.raises(ValueError, match="^invalid_manual_pilot$"):
        create_app(
            planning_provider=OpenAIPlanning(
                "software-placeholder-only", transport=no_transport
            ),
            pilot_config=config,
        )


@pytest.mark.parametrize("provider", [None, object()])
def test_partial_provider_fails_before_engine(monkeypatch, provider):
    monkeypatch.setattr(app_module, "make_engine", no_transport)
    with pytest.raises(ValueError, match="^invalid_manual_pilot$"):
        create_app(planning_provider=provider, pilot_config=pilot_config())


@pytest.mark.parametrize("config", [{}, object(), False])
def test_untyped_config_is_not_silently_ignored(monkeypatch, config):
    monkeypatch.setattr(app_module, "make_engine", no_transport)
    with pytest.raises(ValueError, match="^invalid_manual_pilot$"):
        create_app(
            planning_provider=OpenAIPlanning("software-placeholder-only"),
            pilot_config=config,
        )


def test_conflicting_composition_is_rejected_without_engine(monkeypatch):
    monkeypatch.setattr(app_module, "make_engine", no_transport)
    with pytest.raises(ValueError, match="^invalid_manual_pilot$"):
        create_app(
            planning_provider=OpenAIPlanning("software-placeholder-only"),
            generation_profile=object(),
            pilot_config=pilot_config(),
        )


def test_config_does_not_accept_credentials_or_approval_flags():
    for key in ("api_key", "protected_placeholder", "token", "approved", "source"):
        with pytest.raises(TypeError):
            pilot_config(**{key: "synthetic-secret-not-accepted"})
