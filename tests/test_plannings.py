import hashlib
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from test_materials import actor_app, create

from aulalista_api.planning_fixture import FIXTURE_SOURCE, SUPPORTED_PROMPT, generate


def request(source):
    return {
        "contract_version": 1,
        "fixture_context": "timing-example-v1",
        "prompt": SUPPORTED_PROMPT,
        "source_id": source["source_id"],
        "expected_source_version": 1,
    }


def submit(client, scope, payload, key):
    return client.post(
        f"/scopes/{scope}/plannings",
        json=payload,
        headers={"Idempotency-Key": str(key)},
    )


def test_fixture_is_deterministic_explicit_and_narrow():
    first = generate("timing-example-v1", SUPPORTED_PROMPT, FIXTURE_SOURCE)
    assert first == generate("timing-example-v1", SUPPORTED_PROMPT, FIXTURE_SOURCE)
    assert first["provenance"] == "synthetic-fixture-v1"
    assert sum(item["minutes"] for item in first["activities"]) == 40
    first["activities"].clear()
    assert (
        len(
            generate("timing-example-v1", SUPPORTED_PROMPT, FIXTURE_SOURCE)[
                "activities"
            ]
        )
        == 3
    )
    for context, prompt, source in [
        ("other", SUPPORTED_PROMPT, FIXTURE_SOURCE),
        ("timing-example-v1", "Resuelve cualquier tarea", FIXTURE_SOURCE),
        ("timing-example-v1", SUPPORTED_PROMPT, b"opaque"),
    ]:
        with pytest.raises(ValueError):
            generate(context, prompt, source)


def test_durable_result_namespace_replay_restart_and_original(runtime_database, actors):
    actor, scope = actors[0]
    key = uuid4()
    with TestClient(actor_app(actor)) as client:
        source = create(client, scope, FIXTURE_SOURCE, key).json()
        payload = request(source)
        response = submit(client, scope, payload, key)
        assert response.status_code == 201
        saved = response.json()
        receipt = saved["receipt"]
        assert receipt["namespace"] == "planning-v1"
        assert receipt["source_sha256"] == hashlib.sha256(FIXTURE_SOURCE).hexdigest()
        assert (
            len(
                {
                    receipt["planning_id"],
                    receipt["revision_id"],
                    str(key),
                    source["source_id"],
                }
            )
            == 4
        )
        assert saved["request"] == payload
        assert receipt["revision"] == 1
        assert response.headers["cache-control"] == "no-store"
    with TestClient(actor_app(actor)) as client:
        assert client.get(f"/scopes/{scope}/planning-operations/{key}").json() == saved
        assert (
            client.get(f"/scopes/{scope}/plannings/{receipt['planning_id']}").json()
            == saved
        )
        assert client.get(f"/scopes/{scope}/operations/{key}").json() == source
        assert submit(client, scope, payload, key).json() == saved
        assert (
            client.get(
                f"/scopes/{scope}/sources/{source['source_id']}/versions/1"
            ).content
            == FIXTURE_SOURCE
        )
        changed = dict(payload, prompt="otra petición")
        assert submit(client, scope, changed, key).status_code == 409


def test_replay_precedes_cas_and_never_regenerates(
    runtime_database, actors, monkeypatch
):
    from test_materials import append

    import aulalista_api.plannings as module

    actor, scope = actors[0]
    key = uuid4()
    with TestClient(actor_app(actor)) as client:
        source = create(client, scope, FIXTURE_SOURCE).json()
        payload = request(source)
        saved = submit(client, scope, payload, key).json()
        assert append(client, scope, source["source_id"]).status_code == 201
        assert submit(client, scope, payload, uuid4()).status_code == 409

        def unexpected(*args):
            raise AssertionError("Recovery must never generate")

        monkeypatch.setattr(module, "generate", unexpected)
        assert submit(client, scope, payload, key).json() == saved
        assert client.get(f"/scopes/{scope}/planning-operations/{key}").json() == saved
        assert (
            client.get(
                f"/scopes/{scope}/plannings/{saved['receipt']['planning_id']}"
            ).json()
            == saved
        )


def test_isolation_inside_service_and_http(runtime_database, actors):
    from uuid import UUID

    from aulalista_api.materials import MaterialError
    from aulalista_api.plannings import PlanningRequest, Plannings

    a, scope_a = actors[0]
    b, scope_b = actors[1]
    key = uuid4()
    with TestClient(actor_app(a)) as client:
        payload = request(create(client, scope_a, FIXTURE_SOURCE).json())
        saved = submit(client, scope_a, payload, key).json()
    with TestClient(actor_app(b)) as client:
        foreign = submit(client, scope_a, payload, key)
        missing = submit(
            client, scope_b, dict(payload, source_id=str(uuid4())), uuid4()
        )
        cross = submit(client, scope_b, payload, uuid4())
        assert foreign.status_code == missing.status_code == cross.status_code == 404
        assert (
            foreign.json() == missing.json() == cross.json() == {"detail": "not_found"}
        )
        for scope in [scope_a, scope_b]:
            for path in [
                f"planning-operations/{key}",
                f"plannings/{saved['receipt']['planning_id']}",
            ]:
                assert client.get(f"/scopes/{scope}/{path}").status_code == 404
        own = request(create(client, scope_b, FIXTURE_SOURCE).json())
        assert submit(client, scope_b, own, key).status_code == 201
    service = Plannings(runtime_database)
    for action in [
        lambda: service.write(b, scope_a, key, PlanningRequest.model_validate(payload)),
        lambda: service.read(b, scope_a, operation_id=key),
        lambda: service.read(
            b, scope_b, planning_id=UUID(saved["receipt"]["planning_id"])
        ),
    ]:
        with pytest.raises(MaterialError) as denied:
            action()
        assert denied.value.status == 404


def test_runtime_remains_closed_with_invented_identity(runtime_database, actors):
    from aulalista_api.app import create_app

    actor, scope = actors[0]
    with TestClient(create_app()) as client:
        client.headers.update(
            {"X-Actor-Id": str(actor), "Authorization": f"Bearer {actor}"}
        )
        assert submit(client, scope, {}, uuid4()).status_code == 401
        for path in [f"plannings/{uuid4()}", f"planning-operations/{uuid4()}"]:
            assert client.get(f"/scopes/{scope}/{path}").status_code == 401


@pytest.mark.parametrize(
    "change",
    [
        {"contract_version": 2},
        {"contract_version": True},
        {"prompt": ""},
        {"prompt": "x" * 257},
        {"prompt": 1},
        {"fixture_context": "other"},
        {"expected_source_version": 0},
        {"expected_source_version": True},
        {"expected_source_version": "1"},
        {"source_id": "invalid"},
        {"private_document": "not permitted"},
    ],
)
def test_invalid_payload_has_no_effect(runtime_database, actors, change):
    from sqlalchemy import text

    actor, scope = actors[0]
    with TestClient(actor_app(actor)) as client:
        payload = request(create(client, scope, FIXTURE_SOURCE).json())
        response = submit(client, scope, dict(payload, **change), uuid4())
        assert response.status_code == 422
        assert response.json() == {"detail": "invalid_request"}
    with runtime_database.connect() as connection:
        assert connection.scalar(text("SELECT count(*) FROM planning")) == 0


@pytest.mark.parametrize("unsupported", ["prompt", "source"])
def test_unsupported_is_honest_without_result(runtime_database, actors, unsupported):
    actor, scope = actors[0]
    with TestClient(actor_app(actor)) as client:
        payload = request(
            create(
                client, scope, b"opaque" if unsupported == "source" else FIXTURE_SOURCE
            ).json()
        )
        if unsupported == "prompt":
            payload["prompt"] = "Resume un documento cualquiera"
        key = uuid4()
        response = submit(client, scope, payload, key)
        assert response.status_code == 422
        assert response.json() == {"detail": "unsupported_fixture"}
        assert (
            client.get(f"/scopes/{scope}/planning-operations/{key}").status_code == 404
        )


def test_json_transport_limits(runtime_database, actors):
    import json

    actor, scope = actors[0]
    with TestClient(actor_app(actor)) as client:
        payload = request(create(client, scope, FIXTURE_SOURCE).json())
        content = json.dumps(payload).encode()
        for body, content_type, expected in [
            (content + b" " * (4096 - len(content)), "application/json", 201),
            (b"x" * 4097, "application/json", 413),
            (b"{", "application/json", 422),
            (content, "text/plain", 415),
        ]:
            response = client.post(
                f"/scopes/{scope}/plannings",
                content=body,
                headers={"Content-Type": content_type, "Idempotency-Key": str(uuid4())},
            )
            assert response.status_code == expected


def test_deferred_commit_failure_leaves_no_result(
    runtime_database, migrated_database, actors
):
    from sqlalchemy import text

    actor, scope = actors[0]
    key = uuid4()
    with TestClient(actor_app(actor)) as client:
        payload = request(create(client, scope, FIXTURE_SOURCE).json())
        with migrated_database.begin() as connection:
            connection.execute(
                text("""
                CREATE FUNCTION fail_planning_commit() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'synthetic failure' USING ERRCODE = '23514'; END; $$;
                CREATE CONSTRAINT TRIGGER fail_planning_commit AFTER INSERT ON planning_revision
                DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_planning_commit()
            """)
            )
        failed = submit(client, scope, payload, key)
        assert failed.status_code == 503
        assert failed.json() == {"detail": "unavailable"}
        assert (
            client.get(f"/scopes/{scope}/planning-operations/{key}").status_code == 404
        )
        with runtime_database.connect() as connection:
            assert connection.scalar(text("SELECT count(*) FROM planning")) == 0
            assert (
                connection.scalar(text("SELECT count(*) FROM planning_revision")) == 0
            )
        with migrated_database.begin() as connection:
            connection.execute(
                text(
                    "DROP TRIGGER fail_planning_commit ON planning_revision; DROP FUNCTION fail_planning_commit()"
                )
            )
        saved = submit(client, scope, payload, key)
        assert saved.status_code == 201
        assert submit(client, scope, payload, key).json() == saved.json()


@pytest.mark.parametrize("different", [False, True])
def test_same_key_concurrency_uses_two_connections(runtime_database, actors, different):
    import threading
    from concurrent.futures import ThreadPoolExecutor

    from sqlalchemy import event, text
    from sqlalchemy.engine import Engine

    actor, scope = actors[0]
    key = uuid4()
    with TestClient(actor_app(actor)) as client:
        payload = request(create(client, scope, FIXTURE_SOURCE).json())
        alternative = request(create(client, scope, FIXTURE_SOURCE).json())
    # Build route schemas before racing requests on separate connections.
    apps = [actor_app(actor) for _ in range(2)]
    barrier = threading.Barrier(2)
    pids = set()

    def synchronize(conn, cursor, statement, parameters, context, executemany):
        if statement.startswith("SELECT pg_advisory_xact_lock"):
            pids.add(conn.connection.driver_connection.info.backend_pid)
            barrier.wait(timeout=5)

    event.listen(Engine, "before_cursor_execute", synchronize)
    try:

        def contender(index):
            with TestClient(apps[index]) as client:
                body = alternative if different and index else payload
                return submit(client, scope, body, key)

        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(contender, [0, 1]))
    finally:
        event.remove(Engine, "before_cursor_execute", synchronize)
    assert len(pids) == 2
    if different:
        assert sorted(r.status_code for r in responses) == [201, 409]
    else:
        assert [r.status_code for r in responses] == [201, 201]
        assert responses[0].json() == responses[1].json()
    with runtime_database.connect() as connection:
        assert connection.scalar(text("SELECT count(*) FROM planning_revision")) == 1


def test_integrity_and_immutable_history(runtime_database, migrated_database, actors):
    from sqlalchemy import text
    from sqlalchemy.exc import DBAPIError, IntegrityError

    actor, scope = actors[0]
    with TestClient(actor_app(actor)) as client:
        payload = request(create(client, scope, FIXTURE_SOURCE).json())
        saved = submit(client, scope, payload, uuid4()).json()
    with TestClient(actor_app(actors[1][0])) as other:
        foreign = create(other, actors[1][1], FIXTURE_SOURCE).json()
    for engine in [runtime_database, migrated_database]:
        for verb in [
            "UPDATE planning_revision SET number=number",
            "DELETE FROM planning_revision",
            "TRUNCATE planning_revision",
        ]:
            with pytest.raises(DBAPIError), engine.begin() as connection:
                connection.execute(text(verb))
    for column, value in [
        ("source_version_id", foreign["version_id"]),
        ("planning_id", str(uuid4())),
    ]:
        with pytest.raises(IntegrityError), migrated_database.begin() as connection:
            connection.execute(
                text(f"""
                INSERT INTO planning_revision
                SELECT :id, {":value" if column == "planning_id" else "planning_id"}, scope_id, number+1,
                {":value" if column == "source_version_id" else "source_version_id"},
                actor_id, created_at, :op, request_fingerprint, request, result
                FROM planning_revision
            """),
                {"id": uuid4(), "op": uuid4(), "value": value},
            )
    with runtime_database.connect() as connection:
        assert connection.scalar(text("SELECT count(*) FROM planning_revision")) == 1
    assert saved["receipt"]["revision"] == 1


def test_transport_loss_after_commit_and_timezone_restart(
    runtime_database, migrated_database, actors
):
    import asyncio
    import json

    from sqlalchemy import text

    actor, scope = actors[0]
    key = uuid4()
    with TestClient(actor_app(actor)) as client:
        payload = request(create(client, scope, FIXTURE_SOURCE).json())

    async def receive():
        return {
            "type": "http.request",
            "body": json.dumps(payload).encode(),
            "more_body": False,
        }

    async def send(message):
        if message["type"] == "http.response.start":
            assert message["status"] == 201
            raise OSError("synthetic transport loss")

    asgi = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "method": "POST",
        "scheme": "http",
        "path": f"/scopes/{scope}/plannings",
        "query_string": b"",
        "headers": [
            (b"content-type", b"application/json"),
            (b"idempotency-key", str(key).encode()),
        ],
        "server": ("synthetic", 80),
        "client": ("synthetic", 1),
        "root_path": "",
        "http_version": "1.1",
    }
    with pytest.raises(OSError, match="synthetic transport loss"):
        asyncio.run(actor_app(actor)(asgi, receive, send))
    with TestClient(actor_app(actor)) as client:
        saved = client.get(f"/scopes/{scope}/planning-operations/{key}").json()
    with migrated_database.begin() as connection:
        connection.execute(
            text("ALTER ROLE aulalista_runtime SET timezone = 'Asia/Tokyo'")
        )
    try:
        with TestClient(actor_app(actor)) as client:
            assert submit(client, scope, payload, key).json() == saved
            assert (
                client.get(f"/scopes/{scope}/planning-operations/{key}").json() == saved
            )
    finally:
        with migrated_database.begin() as connection:
            connection.execute(text("ALTER ROLE aulalista_runtime RESET timezone"))


@pytest.mark.parametrize("declared", [None, "1", "4097", "-1"])
def test_unbounded_json_stream_is_cut_off(runtime_database, actors, declared):
    import asyncio

    actor, scope = actors[0]
    reads = []
    sent = []

    async def receive():
        reads.append(1)
        assert len(reads) <= 2, "Read past request budget"
        return {
            "type": "http.request",
            "body": b"x" * 4096 if len(reads) == 1 else b"y",
            "more_body": True,
        }

    async def send(message):
        sent.append(message)

    headers = [
        (b"content-type", b"application/json"),
        (b"idempotency-key", str(uuid4()).encode()),
    ]
    if declared is not None:
        headers.append((b"content-length", declared.encode()))
    asgi = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "method": "POST",
        "scheme": "http",
        "path": f"/scopes/{scope}/plannings",
        "query_string": b"",
        "headers": headers,
        "server": ("synthetic", 80),
        "client": ("synthetic", 1),
        "root_path": "",
        "http_version": "1.1",
    }
    asyncio.run(actor_app(actor)(asgi, receive, send))
    assert sent[0]["status"] == (422 if declared == "-1" else 413)
    assert len(reads) == (2 if declared in [None, "1"] else 0)


def test_source_cas_serializes_with_t2_append(runtime_database, actors):
    import threading
    from concurrent.futures import ThreadPoolExecutor

    from sqlalchemy import event, text
    from sqlalchemy.engine import Engine
    from test_materials import append

    actor, scope = actors[0]
    with TestClient(actor_app(actor)) as client:
        source = create(client, scope, FIXTURE_SOURCE).json()
    # Build route schemas before racing requests on separate connections.
    apps = {kind: actor_app(actor) for kind in ["planning", "append"]}
    barrier = threading.Barrier(2)
    pids = set()

    def synchronize(conn, cursor, statement, parameters, context, executemany):
        if (
            "FOR UPDATE" in statement and "source." in statement
        ) or statement.startswith("UPDATE source SET"):
            pids.add(conn.connection.driver_connection.info.backend_pid)
            barrier.wait(timeout=5)

    event.listen(Engine, "before_cursor_execute", synchronize)
    try:

        def contender(kind):
            with TestClient(apps[kind]) as client:
                return (
                    submit(client, scope, request(source), uuid4())
                    if kind == "planning"
                    else append(client, scope, source["source_id"])
                )

        with ThreadPoolExecutor(max_workers=2) as pool:
            planning, appended = list(pool.map(contender, ["planning", "append"]))
    finally:
        event.remove(Engine, "before_cursor_execute", synchronize)
    assert len(pids) == 2
    assert appended.status_code == 201
    assert planning.status_code in [201, 409]
    with runtime_database.connect() as connection:
        assert connection.scalar(text("SELECT current_version FROM source")) == 2
        assert connection.scalar(text("SELECT count(*) FROM planning_revision")) == (
            1 if planning.status_code == 201 else 0
        )
    if planning.status_code == 201:
        assert planning.json()["receipt"]["source_version_id"] == source["version_id"]


def test_migration_preserves_t2_history_and_roundtrips(migrated_database):
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import inspect, text
    from sqlalchemy.orm import Session

    from aulalista_api.database import PersonalScope, Principal
    from aulalista_api.materials import Materials

    with Session(migrated_database) as session, session.begin():
        actor = Principal()
        session.add(actor)
        session.flush()
        scope = PersonalScope(owner_principal_id=actor.id)
        session.add(scope)
        session.flush()
        actor_id, scope_id = actor.id, scope.id
    source = Materials(migrated_database).write(
        actor_id, scope_id, uuid4(), FIXTURE_SOURCE
    )
    command.downgrade(Config("alembic.ini"), "0002_source_versions")
    assert "planning" not in inspect(migrated_database).get_table_names()
    command.upgrade(Config("alembic.ini"), "head")
    command.upgrade(Config("alembic.ini"), "head")
    command.check(Config("alembic.ini"))
    with migrated_database.connect() as connection:
        assert connection.scalar(text("SELECT id FROM source_version")) == UUID(
            source["version_id"]
        )
        assert (
            connection.scalar(text("SELECT content FROM source_version"))
            == FIXTURE_SOURCE
        )


def test_missing_receipt_does_not_mean_concurrent_write_finished(
    runtime_database, actors
):
    import threading
    from concurrent.futures import ThreadPoolExecutor

    from sqlalchemy import event
    from sqlalchemy.engine import Engine

    actor, scope = actors[0]
    key = uuid4()
    with TestClient(actor_app(actor)) as client:
        payload = request(create(client, scope, FIXTURE_SOURCE).json())
    inserted, release = threading.Event(), threading.Event()

    def pause_before_commit(conn, cursor, statement, parameters, context, executemany):
        if statement.startswith("INSERT INTO planning_revision"):
            inserted.set()
            assert release.wait(timeout=5)

    def writer():
        with TestClient(actor_app(actor)) as client:
            return submit(client, scope, payload, key)

    event.listen(Engine, "after_cursor_execute", pause_before_commit)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(writer)
            try:
                assert inserted.wait(timeout=5)
                with TestClient(actor_app(actor)) as client:
                    assert (
                        client.get(
                            f"/scopes/{scope}/planning-operations/{key}"
                        ).status_code
                        == 404
                    )
                assert not pending.done()
            finally:
                release.set()
            saved = pending.result(timeout=5)
            assert saved.status_code == 201
    finally:
        release.set()
        event.remove(Engine, "after_cursor_execute", pause_before_commit)
    with TestClient(actor_app(actor)) as client:
        assert submit(client, scope, payload, key).json() == saved.json()
        assert (
            client.get(f"/scopes/{scope}/planning-operations/{key}").json()
            == saved.json()
        )
