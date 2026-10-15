import os

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text

from aulalista_api.config import Settings, parse_database_url
from aulalista_api.database import make_engine

TEST_URL = "postgresql+psycopg://aulalista_test@127.0.0.1:55432/aulalista_test"
DISPOSABLE_MARKER = "AulaLista disposable integration tests"


@pytest.fixture(autouse=True)
def explicit_unit_configuration(monkeypatch):
    # This fixture is never imported by application runtime.
    monkeypatch.setenv("AULALISTA_DATABASE_URL", TEST_URL)
    monkeypatch.setenv("AULALISTA_DB_TIMEOUT_SECONDS", "2")


def disposable_engine(url_value, allow_reset):
    url = parse_database_url(url_value)
    if (
        allow_reset != "1"
        or url.host not in {"127.0.0.1", "localhost", "::1"}
        or url.database != "aulalista_test"
        or url.username != "aulalista_test"
        or url.query
    ):
        raise ValueError(
            "Refusing cleanup: target is not the disposable test database."
        )
    engine = make_engine(Settings(False, url, 2))
    try:
        with engine.connect() as connection:
            identity = connection.execute(
                text(
                    "SELECT current_database(), current_user, shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()"
                )
            ).one()
            if identity != ("aulalista_test", "aulalista_test", DISPOSABLE_MARKER):
                raise ValueError(
                    "Refusing cleanup: disposable database marker is missing."
                )
        return engine
    except BaseException:
        engine.dispose()
        raise


def reset_schema(engine):
    with engine.begin() as connection:
        connection.execute(text("DROP SCHEMA public CASCADE"))
        connection.execute(text("CREATE SCHEMA public"))


@pytest.fixture
def empty_database(monkeypatch):
    # No defaults and no skip: missing/unreachable PostgreSQL fails the suite.
    url = os.environ.get("AULALISTA_TEST_DATABASE_URL")
    engine = disposable_engine(url, os.environ.get("AULALISTA_TEST_ALLOW_RESET"))
    monkeypatch.setenv("AULALISTA_DATABASE_URL", url)
    reset_schema(engine)
    try:
        yield engine
    finally:
        reset_schema(engine)
        engine.dispose()


@pytest.fixture
def migrated_database(empty_database):
    command.upgrade(Config("alembic.ini"), "head")
    return empty_database
