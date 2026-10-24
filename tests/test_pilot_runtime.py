"""Server startup configuration; synthetic values and no external transport."""

import os
from decimal import Decimal
from uuid import UUID

import pytest
import requests

import aulalista_api.app as base_app
from aulalista_api.openai_planning import OpenAIPlanning, ProviderError, prepare

ACTOR = "00000000-0000-4000-8000-000000000001"
SCOPE = "00000000-0000-4000-8000-000000000002"
SYNTHETIC_KEY = "software-server-credential-only"


@pytest.fixture
def configured(monkeypatch):
    values = {
        "AULALISTA_PILOT_ENABLED": "true",
        "AULALISTA_PILOT_ACTOR_ID": ACTOR,
        "AULALISTA_PILOT_SCOPE_ID": SCOPE,
        "AULALISTA_PILOT_BUDGET_USD": "2",
        "AULALISTA_PILOT_COUNT_RESERVE_USD": "0.0001",
        "OPENAI_API_KEY": SYNTHETIC_KEY,
    }
    for key, value in values.items():
        monkeypatch.setenv(key, value)
    return values


def test_server_credential_is_explicit_and_absent_from_repr():
    provider = OpenAIPlanning(server_api_key=SYNTHETIC_KEY)
    assert provider.protected_placeholder is None
    assert provider.server_api_key == SYNTHETIC_KEY
    assert SYNTHETIC_KEY not in repr(provider)


def test_credential_modes_are_mutually_exclusive():
    with pytest.raises(ProviderError, match="^provider_unconfigured$"):
        OpenAIPlanning("software-network-placeholder", server_api_key=SYNTHETIC_KEY)


def test_server_key_authenticates_only_the_fixed_destination_without_netrc(monkeypatch):
    calls = []

    def forbidden_netrc(*args, **kwargs):
        pytest.fail("server credential must not consult netrc")

    def send(session, request, **kwargs):
        calls.append(request.url)
        assert request.url == "https://api.openai.com/v1/responses/input_tokens"
        assert request.headers["Authorization"] == "Bearer " + SYNTHETIC_KEY
        assert kwargs["verify"] is not False
        response = requests.Response()
        response.status_code = 200
        response._content = b'{"object":"response.input_tokens","input_tokens":120}'
        response._content_consumed = True
        return response

    monkeypatch.setattr(requests.sessions, "get_netrc_auth", forbidden_netrc)
    monkeypatch.setattr(requests.Session, "send", send)
    provider = OpenAIPlanning(server_api_key=SYNTHETIC_KEY)
    assert provider.count(prepare({"topic": "Synthetic software"}, {})) == 120
    assert len(calls) == 1


@pytest.mark.parametrize("value", [None, "", "bad\r\nheader", "é", "a" * 1025])
def test_server_credential_validation_does_not_echo_value(value):
    with pytest.raises(ProviderError) as error:
        OpenAIPlanning(server_api_key=value)
    assert str(error.value) == "provider_unconfigured"


@pytest.mark.parametrize("enabled", [None, "false"])
def test_closed_runtime_never_reads_pilot_configuration_or_key(monkeypatch, enabled):
    from aulalista_api import pilot_runtime

    monkeypatch.delenv("AULALISTA_PILOT_ENABLED", raising=False)
    if enabled is not None:
        monkeypatch.setenv("AULALISTA_PILOT_ENABLED", enabled)
    getitem = type(os.environ).__getitem__

    def guarded(environment, key):
        if key == "OPENAI_API_KEY" or (
            key.startswith("AULALISTA_PILOT_") and key != "AULALISTA_PILOT_ENABLED"
        ):
            pytest.fail("closed runtime must not discover configuration or credentials")
        return getitem(environment, key)

    monkeypatch.setattr(type(os.environ), "__getitem__", guarded)
    app = pilot_runtime.create_app()
    assert app.state.planning_generation.provider is None
    assert app.state.planning_generation.profile is None


def test_enabled_runtime_wires_one_actor_and_global_budget(configured):
    from aulalista_api import pilot_runtime

    app = pilot_runtime.create_app()
    service = app.state.planning_generation
    assert isinstance(service.provider, OpenAIPlanning)
    assert service.provider.server_api_key == SYNTHETIC_KEY
    assert service.provider.protected_placeholder is None
    assert service.profile.actor_id == UUID(ACTOR)
    assert service.profile.scope_id == UUID(SCOPE)
    assert service.profile.budget_usd == Decimal("2")
    assert service.profile.count_request_reserve_usd == Decimal("0.0001")
    assert service.profile.reservation_usd == Decimal("0.000816800")
    assert service.profile.input_policy == "manual-variable-v1"
    assert service.profile.allowed_request_sha256 is None
    assert not app.dependency_overrides


@pytest.mark.parametrize(
    "key, value",
    [
        ("AULALISTA_PILOT_ENABLED", "yes"),
        ("AULALISTA_PILOT_ENABLED", ""),
        ("AULALISTA_PILOT_ACTOR_ID", "not-a-uuid"),
        ("AULALISTA_PILOT_SCOPE_ID", ""),
        ("AULALISTA_PILOT_BUDGET_USD", "2.000000001"),
        ("AULALISTA_PILOT_BUDGET_USD", "0"),
        ("AULALISTA_PILOT_BUDGET_USD", "NaN"),
        ("AULALISTA_PILOT_BUDGET_USD", "Infinity"),
        ("AULALISTA_PILOT_BUDGET_USD", "0.0000000001"),
        ("AULALISTA_PILOT_BUDGET_USD", "not-money"),
        ("AULALISTA_PILOT_COUNT_RESERVE_USD", "0"),
        ("AULALISTA_PILOT_COUNT_RESERVE_USD", "NaN"),
        ("AULALISTA_PILOT_COUNT_RESERVE_USD", "0.0000000001"),
        ("AULALISTA_PILOT_COUNT_RESERVE_USD", "2"),
    ],
)
def test_bad_config_fails_before_key_engine_or_transport(
    configured, monkeypatch, key, value
):
    from aulalista_api import pilot_runtime

    monkeypatch.setenv(key, value)
    getitem = type(os.environ).__getitem__

    def guarded(environment, name):
        if name == "OPENAI_API_KEY":
            pytest.fail("invalid public configuration must not read the key")
        return getitem(environment, name)

    monkeypatch.setattr(type(os.environ), "__getitem__", guarded)
    monkeypatch.setattr(base_app, "make_engine", lambda *_: pytest.fail("opened DB"))
    with pytest.raises(ValueError) as error:
        pilot_runtime.create_app()
    assert str(error.value) == "invalid_pilot_runtime"


@pytest.mark.parametrize(
    "key",
    [
        "AULALISTA_PILOT_ACTOR_ID",
        "AULALISTA_PILOT_SCOPE_ID",
        "AULALISTA_PILOT_BUDGET_USD",
        "AULALISTA_PILOT_COUNT_RESERVE_USD",
        "OPENAI_API_KEY",
    ],
)
def test_missing_configuration_fails_closed(configured, monkeypatch, key):
    from aulalista_api import pilot_runtime

    monkeypatch.delenv(key)
    monkeypatch.setattr(base_app, "make_engine", lambda *_: pytest.fail("opened DB"))
    with pytest.raises(ValueError, match="^invalid_pilot_runtime$"):
        pilot_runtime.create_app()


def test_invalid_runtime_key_is_not_reflected(configured, monkeypatch):
    from aulalista_api import pilot_runtime

    monkeypatch.setenv("OPENAI_API_KEY", "synthetic credential with spaces")
    monkeypatch.setattr(base_app, "make_engine", lambda *_: pytest.fail("opened DB"))
    with pytest.raises(ValueError) as error:
        pilot_runtime.create_app()
    assert str(error.value) == "invalid_pilot_runtime"
    assert "synthetic" not in repr(error.value)
