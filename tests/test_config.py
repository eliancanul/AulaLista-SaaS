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


@pytest.mark.parametrize(
    "value",
    [
        None,
        "",
        "sqlite:///private-secret.sqlite",
        "postgresql://user:secret@localhost/db",
        "postgresql+psycopg:///db",
        "postgresql+psycopg://user@host/db?connect_timeout=999",
        "postgresql+psycopg://user@host/db?options=-c%20statement_timeout=0",
        "postgresql+psycopg://user@host,other/db",
        "postgresql+psycopg://user:secret@host:invalid/db",
        "invalid-secret",
    ],
)
def test_invalid_database_configuration_fails_closed(monkeypatch, value):
    if value is None:
        monkeypatch.delenv("AULALISTA_DATABASE_URL")
    else:
        monkeypatch.setenv("AULALISTA_DATABASE_URL", value)
    with pytest.raises(ValueError) as error:
        create_app()
    assert (
        str(error.value)
        == "AULALISTA_DATABASE_URL must be an explicit PostgreSQL psycopg URL."
    )
    assert "secret" not in str(error.value)


@pytest.mark.parametrize("value", ["0", "1", "31", "-1", "nan", "3.5", "secret", ""])
def test_invalid_database_deadline_rejected(monkeypatch, value):
    monkeypatch.setenv("AULALISTA_DB_TIMEOUT_SECONDS", value)
    with pytest.raises(ValueError, match="must be an integer from 2 to 30"):
        create_app()


def test_settings_repr_does_not_reveal_dsn(monkeypatch):
    monkeypatch.setenv(
        "AULALISTA_DATABASE_URL",
        "postgresql+psycopg://person:private-secret@localhost/private-db",
    )
    settings = load_settings()
    assert "secret" not in repr(settings)
    assert "person" not in repr(settings)
    assert "private-db" not in repr(settings)
