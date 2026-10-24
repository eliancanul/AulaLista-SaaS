import os
from dataclasses import replace

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.orm import Session

from aulalista_api.config import Settings, load_settings, parse_database_url
from aulalista_api.database import PersonalScope, Principal, make_engine

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


@pytest.fixture
def actors(migrated_database):
    with Session(migrated_database) as session, session.begin():
        ids = []
        for _ in range(2):
            actor = Principal()
            session.add(actor)
            session.flush()
            scope = PersonalScope(owner_principal_id=actor.id)
            session.add(scope)
            session.flush()
            ids.append((actor.id, scope.id))
        return ids


@pytest.fixture
def runtime_database(migrated_database, actors, monkeypatch):
    with migrated_database.begin() as connection:
        connection.execute(
            text("""
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aulalista_runtime') THEN
                    CREATE ROLE aulalista_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
                        NOINHERIT NOREPLICATION NOBYPASSRLS;
                END IF;
            END $$
        """)
        )
        connection.execute(text("GRANT USAGE ON SCHEMA public TO aulalista_runtime"))
        connection.execute(
            text("""
            GRANT SELECT ON principal, personal_scope, alembic_version TO aulalista_runtime;
            GRANT INSERT ON principal, personal_scope TO aulalista_runtime;
            GRANT SELECT, INSERT ON auth_identity, auth_pre_session, auth_session, auth_email_challenge, auth_rate TO aulalista_runtime;
            GRANT UPDATE (email, email_verified) ON auth_identity TO aulalista_runtime;
            GRANT UPDATE (consumed, expires_at) ON auth_pre_session TO aulalista_runtime;
            GRANT UPDATE (revoked, idle_expires_at) ON auth_session TO aulalista_runtime;
            GRANT UPDATE (attempts, consumed) ON auth_email_challenge TO aulalista_runtime;
            GRANT UPDATE (count) ON auth_rate TO aulalista_runtime;
            GRANT SELECT, INSERT ON source, source_version TO aulalista_runtime;
            GRANT UPDATE (current_version) ON source TO aulalista_runtime;
            GRANT SELECT, INSERT ON planning, planning_revision TO aulalista_runtime;
            GRANT UPDATE (current_revision) ON planning TO aulalista_runtime;
            GRANT SELECT, INSERT ON planning_draft, planning_draft_revision TO aulalista_runtime;
            GRANT UPDATE (current_revision) ON planning_draft TO aulalista_runtime;
            GRANT SELECT, INSERT ON planning_generation_attempt TO aulalista_runtime;
            GRANT SELECT, INSERT ON ai_budget_reservation TO aulalista_runtime;
            GRANT UPDATE (state) ON ai_budget_reservation TO aulalista_runtime;
            GRANT SELECT, INSERT ON chat_conversation, chat_turn TO aulalista_runtime;
            GRANT UPDATE (title, version, updated_at) ON chat_conversation TO aulalista_runtime;
            GRANT SELECT, INSERT ON chat_active_conversation, chat_open_operation,
                chat_context_revision TO aulalista_runtime;
            GRANT UPDATE (context_revision) ON chat_conversation TO aulalista_runtime;
            GRANT UPDATE (state, assistant_text, finished_at, model, service_tier,
                provider_request_id, input_tokens, output_tokens, cached_tokens,
                cache_write_tokens, reasoning_tokens, error_code)
                ON chat_turn TO aulalista_runtime;
            GRANT UPDATE (state, finished_at, counted_input_tokens, generation_requests,
                model, service_tier, provider_request_id, input_tokens, output_tokens,
                cached_tokens, cache_write_tokens, reasoning_tokens, error_code, planning_revision_id)
                ON planning_generation_attempt TO aulalista_runtime;
            GRANT SELECT, INSERT ON analytic_section, analytic_section_revision TO aulalista_runtime;
            GRANT UPDATE (current_revision) ON analytic_section TO aulalista_runtime
        """)
        )
    settings = load_settings()
    url = settings.database_url.set(username="aulalista_runtime", password=None)
    monkeypatch.setenv(
        "AULALISTA_DATABASE_URL", url.render_as_string(hide_password=False)
    )
    runtime = make_engine(replace(settings, database_url=url))
    try:
        with runtime.connect() as connection:
            assert connection.execute(
                text("SELECT current_user, session_user")
            ).one() == ("aulalista_runtime", "aulalista_runtime")
            assert connection.execute(
                text("""
                SELECT rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls
                FROM pg_roles WHERE rolname = current_user
            """)
            ).one() == (False, False, False, False, False)
            assert (
                connection.execute(
                    text("""
                SELECT count(*) FROM pg_auth_members
                WHERE member = (SELECT oid FROM pg_roles WHERE rolname = current_user)
            """)
                ).scalar_one()
                == 0
            )
            assert (
                connection.execute(
                    text("""
                SELECT pg_get_userbyid(relowner) <> current_user
                FROM pg_class WHERE oid = 'source_version'::regclass
            """)
                ).scalar_one()
                is True
            )
        yield runtime
    finally:
        runtime.dispose()
