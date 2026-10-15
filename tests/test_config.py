import pytest

from aulalista_api.app import create_app
from aulalista_api.config import load_settings


def test_docs_are_disabled_by_default(monkeypatch):
    monkeypatch.delenv("AULALISTA_DOCS_ENABLED", raising=False)
    assert load_settings().docs_enabled is False


@pytest.mark.parametrize(
    ("value", "expected"),
    [("true", True), (" TRUE ", True), ("false", False), ("False", False)],
)
def test_explicit_boolean_configuration(monkeypatch, value, expected):
    monkeypatch.setenv("AULALISTA_DOCS_ENABLED", value)
    assert load_settings().docs_enabled is expected


@pytest.mark.parametrize("value", ["", "yes", "1", "no", "0", "private-value"])
def test_invalid_configuration_prevents_startup_without_echoing_value(
    monkeypatch, value
):
    monkeypatch.setenv("AULALISTA_DOCS_ENABLED", value)
    with pytest.raises(ValueError) as error:
        create_app()
    assert str(error.value) == "AULALISTA_DOCS_ENABLED must be true or false."


def test_settings_are_read_for_each_application(monkeypatch):
    monkeypatch.setenv("AULALISTA_DOCS_ENABLED", "true")
    first = create_app()
    monkeypatch.setenv("AULALISTA_DOCS_ENABLED", "false")
    second = create_app()
    assert first.openapi_url == "/openapi.json"
    assert second.openapi_url is None


def test_dotenv_is_not_loaded_implicitly(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("AULALISTA_DOCS_ENABLED", raising=False)
    (tmp_path / ".env").write_text("AULALISTA_DOCS_ENABLED=true\n")
    assert load_settings().docs_enabled is False
