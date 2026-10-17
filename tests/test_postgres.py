import asyncio
import socket
import time
from dataclasses import replace
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from conftest import DISPOSABLE_MARKER, TEST_URL, disposable_engine
from fastapi.testclient import TestClient
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from aulalista_api.app import create_app
from aulalista_api.config import load_settings
from aulalista_api.database import (
    SCHEMA_REVISION,
    PersonalScope,
    Principal,
    Readiness,
    make_engine,
    schema_is_ready,
)


def test_empty_database_migrates_and_upgrade_is_repeatable(empty_database):
    engine = empty_database
    assert inspect(engine).get_table_names() == []
    command.upgrade(Config("alembic.ini"), "head")
    with Session(engine) as session, session.begin():
        owner = Principal()
        session.add(owner)
        session.flush()
        scope = PersonalScope(owner_principal_id=owner.id)
        session.add(scope)
        session.flush()
        ids = owner.id, scope.id
    command.upgrade(Config("alembic.ini"), "head")
    with Session(engine) as session:
        assert (
            session.execute(
                text("SELECT version_num FROM alembic_version")
            ).scalar_one()
            == SCHEMA_REVISION
        )
        assert session.execute(text("SELECT id FROM principal")).scalars().all() == [
            ids[0]
        ]
        assert session.execute(
            text("SELECT id FROM personal_scope")
        ).scalars().all() == [ids[1]]
    assert set(inspect(engine).get_table_names()) == {
        "principal",
        "personal_scope",
        "alembic_version",
        "source",
        "source_version",
        "planning",
        "planning_revision",
        "planning_draft",
        "planning_draft_revision",
    }
    command.check(Config("alembic.ini"))


@pytest.mark.parametrize(
    ("owner_kind", "sqlstate"),
    [("null", "23502"), ("absent", "23503"), ("duplicate", "23505")],
)
def test_postgres_rejects_invalid_owner_without_python_validation(
    migrated_database, owner_kind, sqlstate
):
    engine = migrated_database
    owner = uuid4()
    if owner_kind == "duplicate":
        with engine.begin() as connection:
            connection.execute(
                text("INSERT INTO principal (id) VALUES (:id)"), {"id": owner}
            )
            connection.execute(
                text(
                    "INSERT INTO personal_scope (id, owner_principal_id) VALUES (:id, :owner)"
                ),
                {"id": uuid4(), "owner": owner},
            )
    with pytest.raises(IntegrityError) as error, engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO personal_scope (id, owner_principal_id) VALUES (:id, :owner)"
            ),
            {"id": uuid4(), "owner": None if owner_kind == "null" else owner},
        )
    assert error.value.orig.sqlstate == sqlstate


def test_new_engine_and_session_recover_committed_scope(migrated_database):
    with Session(migrated_database) as session, session.begin():
        principal = Principal()
        session.add(principal)
        session.flush()
        scope = PersonalScope(owner_principal_id=principal.id)
        session.add(scope)
        session.flush()
        owner_id, scope_id = principal.id, scope.id
    migrated_database.dispose()
    engine = make_engine(load_settings())
    try:
        with Session(engine) as session:
            assert session.get(PersonalScope, scope_id).owner_principal_id == owner_id
        with TestClient(create_app()) as client:
            assert client.get("/health/ready").status_code == 200
    finally:
        engine.dispose()


def test_readiness_correct_schema(migrated_database):
    with TestClient(create_app()) as client:
        response = client.get("/health/ready")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}
    with migrated_database.connect() as connection:
        assert (
            connection.execute(text("SELECT count(*) FROM principal")).scalar_one() == 0
        )
        assert (
            connection.execute(text("SELECT count(*) FROM personal_scope")).scalar_one()
            == 0
        )


@pytest.mark.parametrize("revision", ["unknown_revision", "", None])
def test_readiness_wrong_or_missing_schema_is_unavailable(
    migrated_database, revision, caplog
):
    with migrated_database.begin() as connection:
        if revision is None:
            connection.execute(text("DROP TABLE alembic_version"))
        elif revision == "":
            connection.execute(text("DELETE FROM alembic_version"))
        else:
            connection.execute(
                text("UPDATE alembic_version SET version_num = :revision"),
                {"revision": revision},
            )
    with TestClient(create_app()) as client:
        started = time.monotonic()
        response = client.get("/health/ready")
        assert time.monotonic() - started < 2.5
        assert response.status_code == 503
        assert response.json() == {"status": "unavailable"}
        assert client.get("/health/live").status_code == 200
    assert "unknown_revision" not in caplog.text
    assert "postgresql" not in caplog.text.lower()


def test_readiness_does_not_run_migrations(empty_database):
    with TestClient(create_app()) as client:
        assert client.get("/health/ready").status_code == 503
    assert inspect(empty_database).get_table_names() == []


def test_database_connection_failure_and_reconnect(migrated_database):
    settings = load_settings()
    # The validated disposable server's maintenance DB controls ONLY aulalista_test.
    control_engine = make_engine(
        replace(settings, database_url=settings.database_url.set(database="postgres"))
    )
    try:
        with control_engine.connect().execution_options(
            isolation_level="AUTOCOMMIT"
        ) as control:
            with TestClient(create_app()) as client:
                assert client.get("/health/ready").status_code == 200
                control.execute(
                    text("ALTER DATABASE aulalista_test ALLOW_CONNECTIONS false")
                )
                try:
                    started = time.monotonic()
                    response = client.get("/health/ready")
                    assert response.status_code == 503
                    assert response.json() == {"status": "unavailable"}
                    assert time.monotonic() - started < 2.5
                    assert client.get("/health/live").status_code == 200
                finally:
                    control.execute(
                        text("ALTER DATABASE aulalista_test ALLOW_CONNECTIONS true")
                    )
                assert client.get("/health/ready").status_code == 200
    finally:
        control_engine.dispose()


def test_unresponsive_database_connection_has_http_deadline(monkeypatch, caplog):
    # A real TCP listener that never answers the PostgreSQL handshake.
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        port = listener.getsockname()[1]
        monkeypatch.setenv(
            "AULALISTA_DATABASE_URL",
            f"postgresql+psycopg://synthetic:private-negative-test@127.0.0.1:{port}/synthetic",
        )
        with TestClient(create_app()) as client:
            started = time.monotonic()
            response = client.get("/health/ready")
            assert time.monotonic() - started < 2.5
            assert response.status_code == 503
            assert response.json() == {"status": "unavailable"}
            assert client.get("/health/live").status_code == 200
    assert "private-negative-test" not in caplog.text
    assert "postgresql+psycopg" not in caplog.text


def test_lock_timeout_is_bounded_and_connection_recovers(migrated_database):
    with TestClient(create_app()) as client:
        with migrated_database.begin() as lock:
            lock.execute(text("LOCK TABLE alembic_version IN ACCESS EXCLUSIVE MODE"))
            started = time.monotonic()
            assert client.get("/health/ready").status_code == 503
            assert time.monotonic() - started < 2.5
            assert client.get("/health/live").status_code == 200
        deadline = time.monotonic() + 2.5
        while client.get("/health/ready").status_code != 200:
            assert time.monotonic() < deadline
            time.sleep(0.01)


def test_http_deadline_deduplicates_slow_probes(monkeypatch):
    import aulalista_api.database as database

    calls = []

    def delayed_probe(engine):
        calls.append(engine)
        time.sleep(0.15)
        return False

    monkeypatch.setattr(database, "schema_is_ready", delayed_probe)

    async def run():
        probe = Readiness("synthetic engine", 0.02)
        results = await asyncio.gather(*(probe.check() for _ in range(8)))
        assert results == [False] * 8
        assert len(calls) == 1
        assert await probe.check() is False
        assert len(calls) == 1
        await probe.pending

    asyncio.run(run())


@pytest.mark.parametrize(
    ("url", "consent"),
    [
        (None, "1"),
        (TEST_URL, None),
        (TEST_URL.replace("aulalista_test", "production"), "1"),
        (TEST_URL.replace("127.0.0.1", "example.com"), "1"),
        (TEST_URL + "?sslmode=disable", "1"),
    ],
)
def test_cleanup_rejects_unsafe_target_before_connecting(monkeypatch, url, consent):
    import conftest

    def forbidden_connection(*args, **kwargs):
        pytest.fail("An unsafe cleanup target must never be contacted")

    monkeypatch.setattr(conftest, "make_engine", forbidden_connection)
    with pytest.raises(ValueError):
        disposable_engine(url, consent)


def test_cleanup_requires_live_disposable_marker(migrated_database):
    with migrated_database.begin() as connection:
        connection.execute(text("COMMENT ON DATABASE aulalista_test IS NULL"))
    try:
        with pytest.raises(ValueError, match="marker is missing"):
            disposable_engine(
                load_settings().database_url.render_as_string(hide_password=False), "1"
            )
        assert schema_is_ready(migrated_database)
    finally:
        with migrated_database.begin() as connection:
            connection.execute(
                text(f"COMMENT ON DATABASE aulalista_test IS '{DISPOSABLE_MARKER}'")
            )


def test_disposable_schema_can_be_recreated_from_migrations(migrated_database):
    command.downgrade(Config("alembic.ini"), "base")
    assert inspect(migrated_database).get_table_names() == ["alembic_version"]
    assert schema_is_ready(migrated_database) is False
    command.upgrade(Config("alembic.ini"), "head")
    assert schema_is_ready(migrated_database) is True
