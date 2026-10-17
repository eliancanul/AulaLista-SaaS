import asyncio
import hashlib
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, select, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import Session
from starlette.requests import Request

from aulalista_api.app import create_app
from aulalista_api.material_routes import bounded_content, require_actor
from aulalista_api.materials import (
    MAX_CONTENT_BYTES,
    MaterialError,
    Materials,
    SourceVersion,
)


def actor_app(actor_id):
    app = create_app()
    app.dependency_overrides[require_actor] = lambda: actor_id
    return app


def create(client, scope, content=b"synthetic\x00\xff", operation=None):
    return client.post(
        f"/scopes/{scope}/sources",
        content=content,
        headers={
            "Content-Type": "application/octet-stream",
            "Idempotency-Key": str(operation or uuid4()),
        },
    )


def append(client, scope, source, expected=1, content=b"version two", operation=None):
    return client.post(
        f"/scopes/{scope}/sources/{source}/versions?expected_version={expected}",
        content=content,
        headers={
            "Content-Type": "application/octet-stream",
            "Idempotency-Key": str(operation or uuid4()),
        },
    )


def exact(client, scope, source, number=1):
    return client.get(f"/scopes/{scope}/sources/{source}/versions/{number}")


def operation(client, scope, key):
    return client.get(f"/scopes/{scope}/operations/{key}")


def state(engine):
    with engine.connect() as connection:
        return (
            connection.execute(
                text("SELECT id, scope_id, current_version FROM source ORDER BY id")
            ).all(),
            connection.execute(text("SELECT * FROM source_version ORDER BY id")).all(),
        )


def test_http_restarts_preserve_bytes_metadata_and_immutable_history(
    runtime_database, actors
):
    actor, scope = actors[0]
    content = bytes(range(256)) + b"\x00\xff synthetic original"
    with TestClient(actor_app(actor)) as first:
        saved = create(first, scope, content)
        assert saved.status_code == 201
        v1 = saved.json()
        assert v1["scope_id"] == str(scope)
        assert v1["actor_id"] == str(actor)
        assert v1["sha256"] == hashlib.sha256(content).hexdigest()
        assert v1["size"] == len(content)
        assert v1["number"] == 1
    # This is a new app, engine, DB connection and Session, using the runtime role.
    with TestClient(actor_app(actor)) as restarted:
        assert restarted.get("/health/ready").status_code == 200
        recovered = exact(restarted, scope, v1["source_id"])
        assert recovered.content == content
        for header, value in {
            "x-content-sha256": v1["sha256"],
            "x-content-size": str(len(content)),
            "x-actor-id": str(actor),
            "x-operation-id": v1["operation_id"],
            "x-created-at": v1["created_at"],
            "x-version": "1",
        }.items():
            assert recovered.headers[header] == value
        before = recovered.headers
        v2 = append(restarted, scope, v1["source_id"], content=b"\xfe\x00 new").json()
        assert v2["number"] == 2
        again = exact(restarted, scope, v1["source_id"])
        assert again.content == content
        assert again.headers == before
        assert exact(restarted, scope, v1["source_id"], 2).content == b"\xfe\x00 new"
        assert operation(restarted, scope, v1["operation_id"]).json() == v1
    rows, versions = state(runtime_database)
    assert len(rows) == 1 and rows[0].current_version == 2
    assert sorted(row.number for row in versions) == [1, 2]


def test_lost_response_old_replay_and_key_scope(runtime_database, actors):
    a, scope_a = actors[0]
    b, scope_b = actors[1]
    key, key2 = uuid4(), uuid4()
    with TestClient(actor_app(a)) as client:
        create(
            client, scope_a, operation=key
        )  # The caller discards a committed response.
    with TestClient(actor_app(a)) as client:
        v1 = operation(client, scope_a, key).json()
        v2 = append(client, scope_a, v1["source_id"], operation=key2).json()
        append(client, scope_a, v1["source_id"], expected=2)
        original = state(runtime_database)
        assert create(client, scope_a, operation=key).json() == v1
        replay = append(client, scope_a, v1["source_id"], operation=key2)
        assert replay.status_code == 201
        assert replay.json() == v2
        assert state(runtime_database) == original
    with TestClient(actor_app(b)) as other:
        # A key is unique within its scope, not a global cross-account oracle.
        assert create(other, scope_b, operation=key).status_code == 201


@pytest.mark.parametrize("change", ["bytes", "destination", "revision", "kind"])
def test_full_fingerprint_conflicts_without_effects(runtime_database, actors, change):
    actor, scope = actors[0]
    key = uuid4()
    with TestClient(actor_app(actor)) as client:
        v1 = create(client, scope).json()
        assert append(client, scope, v1["source_id"], operation=key).status_code == 201
        before = state(runtime_database)
        if change == "kind":
            response = create(client, scope, content=b"version two", operation=key)
        else:
            response = append(
                client,
                scope,
                str(uuid4()) if change == "destination" else v1["source_id"],
                expected=2 if change == "revision" else 1,
                content=b"different" if change == "bytes" else b"version two",
                operation=key,
            )
        assert response.status_code == 409
        assert response.json() == {"detail": "conflict"}
        assert state(runtime_database) == before
        stale = append(client, scope, v1["source_id"])
        assert stale.status_code == 409
        assert state(runtime_database) == before


def test_owner_authority_covers_all_operations_and_manipulated_scope(
    runtime_database, actors
):
    a, scope_a = actors[0]
    b, scope_b = actors[1]
    with TestClient(actor_app(a)) as client:
        saved = create(client, scope_a).json()
    before = state(runtime_database)
    with TestClient(actor_app(b)) as client:
        responses = [
            exact(client, scope_a, saved["source_id"]),
            exact(client, scope_b, saved["source_id"]),
            exact(client, scope_b, uuid4()),
            exact(client, uuid4(), uuid4()),
            append(client, scope_a, saved["source_id"]),
            append(client, scope_b, saved["source_id"]),
            append(client, scope_b, uuid4()),
            operation(client, scope_a, saved["operation_id"]),
            operation(client, scope_b, saved["operation_id"]),
            operation(client, scope_b, uuid4()),
            create(client, scope_a),
            create(client, uuid4()),
        ]
        assert {(r.status_code, r.content) for r in responses} == {
            (404, b'{"detail":"not_found"}')
        }
    assert state(runtime_database) == before
    # Crossing the case-of-use interface directly also enforces authority.
    materials = Materials(runtime_database)
    for call in [
        lambda: materials.read(b, scope_a, UUID(saved["source_id"]), 1),
        lambda: materials.operation(b, scope_a, UUID(saved["operation_id"])),
        lambda: materials.write(b, scope_a, uuid4(), b"denied"),
        lambda: materials.write(
            b,
            scope_b,
            uuid4(),
            b"denied",
            source_id=UUID(saved["source_id"]),
            expected_version=1,
        ),
    ]:
        with pytest.raises(MaterialError) as error:
            call()
        assert error.value.status == 404
    assert state(runtime_database) == before


def test_new_app_never_accepts_client_identity(runtime_database, actors, monkeypatch):
    actor, scope = actors[0]
    with TestClient(actor_app(actor)) as client:
        saved = create(client, scope).json()
    before = state(runtime_database)
    monkeypatch.setenv("AULALISTA_TEST_ACTOR", str(actor))
    monkeypatch.setenv("AULALISTA_AUTH_DISABLED", "true")
    with TestClient(create_app()) as client:
        client.headers.update(
            {
                "Authorization": "Bearer synthetic",
                "X-User-ID": str(actor),
                "X-Principal-ID": str(actor),
                "X-Tenant-ID": str(scope),
            }
        )
        responses = [
            create(client, scope),
            append(client, scope, saved["source_id"]),
            exact(client, scope, saved["source_id"]),
            operation(client, scope, saved["operation_id"]),
        ]
        assert {(r.status_code, r.content) for r in responses} == {
            (401, b'{"detail":"unauthorized"}')
        }
    assert state(runtime_database) == before


@pytest.fixture(params=["read committed", "serializable"])
def role_isolation(request, migrated_database, runtime_database):
    with migrated_database.begin() as connection:
        connection.execute(
            text(
                f"ALTER ROLE aulalista_runtime SET default_transaction_isolation = '{request.param}'"
            )
        )
    try:
        yield request.param
    finally:
        with migrated_database.begin() as connection:
            connection.execute(
                text("ALTER ROLE aulalista_runtime RESET default_transaction_isolation")
            )


@pytest.mark.parametrize("same_key", [False, True])
def test_two_connections_contend_and_third_reads_exact_result(
    runtime_database, actors, same_key, role_isolation
):
    actor, scope = actors[0]
    with TestClient(actor_app(actor)) as setup:
        v1 = create(setup, scope).json()
    key1 = uuid4()
    keys = [key1, key1 if same_key else uuid4()]
    # Build route schemas before racing requests on separate connections.
    apps = [actor_app(actor) for _ in keys]
    barrier = threading.Barrier(2)
    pids = set()
    guard = threading.Lock()

    # Real engine connections hit the write after authorization and before locking.
    def synchronize(conn, cursor, statement, parameters, context, executemany):
        if statement.startswith("SELECT pg_advisory_xact_lock"):
            with guard:
                pids.add(conn.connection.driver_connection.info.backend_pid)
            barrier.wait(timeout=5)

    from sqlalchemy.engine import Engine

    event.listen(Engine, "before_cursor_execute", synchronize)
    try:

        def contender(job):
            key, app = job
            with TestClient(app) as client:
                return append(client, scope, v1["source_id"], operation=key)

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(contender, zip(keys, apps)))
    finally:
        event.remove(Engine, "before_cursor_execute", synchronize)
    assert len(pids) == 2
    assert sorted(r.status_code for r in results) == (
        [201, 201] if same_key else [201, 409]
    )
    if same_key:
        assert results[0].json() == results[1].json()
    with TestClient(actor_app(actor)) as third:
        assert exact(third, scope, v1["source_id"], 2).content == b"version two"
        assert exact(third, scope, v1["source_id"], 3).status_code == 404
    sources, versions = state(runtime_database)
    assert sources[0].current_version == 2
    assert len(versions) == 2


@pytest.mark.parametrize("kind", ["create", "append"])
def test_failure_before_commit_rolls_back_every_effect(
    runtime_database, migrated_database, actors, kind
):
    actor, scope = actors[0]
    key = uuid4()
    with TestClient(actor_app(actor)) as client:
        v1 = create(client, scope).json() if kind == "append" else None
        before = state(runtime_database)
        # A deferred DB trigger fails at COMMIT, after source and version INSERTs.
        with migrated_database.begin() as connection:
            connection.execute(
                text("""
                CREATE FUNCTION fail_synthetic_commit() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'synthetic commit failure' USING ERRCODE = '23514'; END; $$;
                CREATE CONSTRAINT TRIGGER fail_synthetic_commit
                AFTER INSERT ON source_version DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION fail_synthetic_commit()
            """)
            )

        def attempt():
            return (
                create(client, scope, operation=key)
                if v1 is None
                else append(client, scope, v1["source_id"], operation=key)
            )

        failed = attempt()
        assert failed.status_code == 503
        assert failed.json() == {"detail": "unavailable"}
        assert operation(client, scope, key).status_code == 404
        assert state(runtime_database) == before
        with migrated_database.begin() as connection:
            connection.execute(
                text(
                    "DROP TRIGGER fail_synthetic_commit ON source_version; DROP FUNCTION fail_synthetic_commit()"
                )
            )
        success = attempt()
        assert success.status_code == 201
        assert attempt().json() == success.json()
        assert len(state(runtime_database)[1]) == len(before[1]) + 1


@pytest.mark.parametrize(
    "size,status", [(0, 422), (1, 201), (65536, 201), (65537, 413)]
)
def test_byte_limits_at_http_and_case_interface(runtime_database, actors, size, status):
    actor, scope = actors[0]
    with TestClient(actor_app(actor)) as client:
        response = create(client, scope, b"x" * size)
        assert response.status_code == status
        assert len(state(runtime_database)[0]) == (1 if status == 201 else 0)
    if status != 201:
        with pytest.raises(MaterialError) as error:
            Materials(runtime_database).write(actor, scope, uuid4(), b"x" * size)
        assert error.value.status == status


@pytest.mark.parametrize("declared", [None, "1", "65537", "-1", "bad"])
def test_asgi_stream_budget_stops_reading_before_unbounded_buffer(
    runtime_database, actors, declared
):
    actor, scope = actors[0]
    reads = []
    chunks = [b"x" * 32768, b"y" * 32768, b"z", b"MUST NOT BE READ"]
    app = actor_app(actor)
    sent = []

    async def receive():
        index = len(reads)
        reads.append(index)
        assert index < 3, "Reader kept requesting chunks beyond its budget"
        return {"type": "http.request", "body": chunks[index], "more_body": True}

    async def send(message):
        sent.append(message)

    headers = [
        (b"content-type", b"application/octet-stream"),
        (b"idempotency-key", str(uuid4()).encode()),
    ]
    if declared is not None:
        headers.append((b"content-length", declared.encode()))
    scope_asgi = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "method": "POST",
        "scheme": "http",
        "path": f"/scopes/{scope}/sources",
        "query_string": b"",
        "headers": headers,
        "server": ("synthetic", 80),
        "client": ("synthetic", 1),
        "root_path": "",
        "http_version": "1.1",
    }
    asyncio.run(app(scope_asgi, receive, send))
    assert sent[0]["status"] == (422 if declared in {"-1", "bad"} else 413)
    assert len(reads) == (3 if declared in {None, "1"} else 0)
    assert state(runtime_database) == ([], [])


def test_single_huge_chunk_is_never_accumulated():
    async def run():
        reads = 0

        async def receive():
            nonlocal reads
            reads += 1
            return {
                "type": "http.request",
                "body": b"x" * (MAX_CONTENT_BYTES + 1),
                "more_body": True,
            }

        request = Request(
            {
                "type": "http",
                "headers": [(b"content-type", b"application/octet-stream")],
            },
            receive,
        )
        with pytest.raises(MaterialError) as error:
            await bounded_content(request)
        assert error.value.status == 413
        assert reads == 1
        assert not hasattr(request, "_body")

    asyncio.run(run())


@pytest.mark.parametrize(
    "mutation",
    [
        "UPDATE source_version SET number = 4",
        "DELETE FROM source_version",
        "TRUNCATE source_version, planning_revision, planning_draft_revision",
    ],
)
def test_runtime_cannot_mutate_history_and_trigger_is_defense_in_depth(
    runtime_database, migrated_database, actors, mutation
):
    actor, scope = actors[0]
    with TestClient(actor_app(actor)) as client:
        create(client, scope)
    before = state(runtime_database)
    for engine, sqlstate in [(runtime_database, "42501"), (migrated_database, "23514")]:
        with pytest.raises(DBAPIError) as error, engine.begin() as connection:
            connection.execute(text(mutation))
        assert error.value.orig.sqlstate == sqlstate
    assert state(runtime_database) == before


@pytest.mark.parametrize(
    "change,sqlstate",
    [
        ("scope", "23503"),
        ("number", "23505"),
        ("empty", "23514"),
        ("oversize", "23514"),
        ("size", "23514"),
        ("hash", "23514"),
        ("key", "23505"),
    ],
)
def test_database_rejects_invalid_versions_without_case_validation(
    runtime_database, actors, change, sqlstate
):
    actor, scope = actors[0]
    with TestClient(actor_app(actor)) as client:
        create(client, scope)
    with Session(runtime_database) as session:
        row = session.scalar(select(SourceVersion))
        values = {
            column.name: getattr(row, column.name)
            for column in SourceVersion.__table__.columns
        }
    values.update(id=uuid4(), number=2, operation_id=uuid4())
    if change == "scope":
        values["scope_id"] = actors[1][1]
    elif change == "number":
        values["number"] = 1
    elif change == "empty":
        values.update(
            content=b"", size=0, content_sha256=hashlib.sha256(b"").hexdigest()
        )
    elif change == "oversize":
        values.update(
            content=b"x" * 65537,
            size=65537,
            content_sha256=hashlib.sha256(b"x" * 65537).hexdigest(),
        )
    elif change == "size":
        values["size"] = 1
    elif change == "hash":
        values["content_sha256"] = "0" * 64
    elif change == "key":
        values["operation_id"] = row.operation_id
    before = state(runtime_database)
    with pytest.raises(IntegrityError) as error, runtime_database.begin() as connection:
        connection.execute(SourceVersion.__table__.insert().values(**values))
    assert error.value.orig.sqlstate == sqlstate
    assert state(runtime_database) == before


def test_errors_and_logs_never_echo_content_secrets_or_db_details(
    runtime_database, migrated_database, actors, caplog
):
    actor, scope = actors[0]
    secret = "synthetic-private-content-marker"
    with TestClient(actor_app(actor)) as client:
        for headers, path in [
            (
                {"Content-Type": "application/json", "Idempotency-Key": str(uuid4())},
                f"/scopes/{scope}/sources",
            ),
            (
                {"Content-Type": "application/octet-stream", "Idempotency-Key": secret},
                f"/scopes/{scope}/sources",
            ),
            (
                {
                    "Content-Type": "application/octet-stream",
                    "Idempotency-Key": str(uuid4()),
                },
                f"/scopes/{secret}/sources",
            ),
        ]:
            response = client.post(path, content=secret.encode(), headers=headers)
            assert response.status_code in {415, 422}
            assert secret not in response.text
        saved = create(client, scope, content=secret.encode()).json()
        response = client.post(
            f"/scopes/{scope}/sources/{saved['source_id']}/versions?expected_version={secret}",
            content=secret.encode(),
            headers={
                "Content-Type": "application/octet-stream",
                "Idempotency-Key": str(uuid4()),
            },
        )
        assert response.status_code == 422 and secret not in response.text
        with migrated_database.begin() as connection:
            connection.execute(
                text("REVOKE INSERT ON source_version FROM aulalista_runtime")
            )
        response = create(client, scope, content=secret.encode())
        assert response.status_code == 503
        assert response.json() == {"detail": "unavailable"}
    assert secret not in caplog.text
    for forbidden in [
        "postgresql+psycopg",
        "Traceback",
        "INSERT INTO",
        "permission denied",
    ]:
        assert forbidden not in caplog.text


def test_fingerprint_has_documented_deterministic_representation(
    runtime_database, actors
):
    actor, scope = actors[0]
    with TestClient(actor_app(actor)) as client:
        created = create(client, scope, content=b"\x00\xff").json()
        append(client, scope, created["source_id"], content=b"next")
    with Session(runtime_database) as session:
        rows = session.scalars(
            select(SourceVersion).order_by(SourceVersion.number)
        ).all()
        for row, metadata in zip(
            rows,
            [["create", None, 0], ["append", created["source_id"], 1]],
            strict=True,
        ):
            expected = hashlib.sha256(
                b"aulalista-source-request-v1\0"
                + json.dumps(metadata, separators=(",", ":")).encode()
                + b"\0"
                + row.content
            ).hexdigest()
            assert row.request_fingerprint == expected


@pytest.mark.parametrize("different_body", [False, True])
def test_concurrent_create_same_key_never_leaves_extra_source(
    runtime_database, actors, different_body
):
    actor, scope = actors[0]
    key = uuid4()
    # Build route schemas before racing requests on separate connections.
    apps = [actor_app(actor) for _ in range(2)]
    barrier = threading.Barrier(2)
    pids = set()
    guard = threading.Lock()
    from sqlalchemy.engine import Engine

    def synchronize(conn, cursor, statement, parameters, context, executemany):
        if statement.startswith("SELECT pg_advisory_xact_lock"):
            with guard:
                pids.add(conn.connection.driver_connection.info.backend_pid)
            barrier.wait(timeout=5)

    event.listen(Engine, "before_cursor_execute", synchronize)
    try:

        def contender(job):
            body, app = job
            with TestClient(app) as client:
                return create(client, scope, content=body, operation=key)

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(
                pool.map(
                    contender,
                    zip([b"first", b"other" if different_body else b"first"], apps),
                )
            )
    finally:
        event.remove(Engine, "before_cursor_execute", synchronize)
    assert len(pids) == 2
    assert sorted(r.status_code for r in results) == (
        [201, 409] if different_body else [201, 201]
    )
    if not different_body:
        assert results[0].json() == results[1].json()
    assert tuple(map(len, state(runtime_database))) == (1, 1)
    with TestClient(actor_app(actor)) as client:
        recovered = operation(client, scope, key)
        assert recovered.json() in [r.json() for r in results if r.status_code == 201]


def test_response_transport_loss_after_commit_can_be_recovered(
    runtime_database, actors
):
    actor, scope = actors[0]
    key = uuid4()
    app = actor_app(actor)

    async def receive():
        return {
            "type": "http.request",
            "body": b"lost acknowledgement",
            "more_body": False,
        }

    async def send(message):
        if message["type"] == "http.response.start":
            assert message["status"] == 201
            raise OSError("synthetic disconnected caller")

    scope_asgi = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "method": "POST",
        "scheme": "http",
        "path": f"/scopes/{scope}/sources",
        "query_string": b"",
        "headers": [
            (b"content-type", b"application/octet-stream"),
            (b"idempotency-key", str(key).encode()),
        ],
        "server": ("synthetic", 80),
        "client": ("synthetic", 1),
        "root_path": "",
        "http_version": "1.1",
    }
    with pytest.raises(OSError, match="synthetic disconnected caller"):
        asyncio.run(app(scope_asgi, receive, send))
    with TestClient(actor_app(actor)) as restarted:
        saved = operation(restarted, scope, key)
        assert saved.status_code == 200
        retry = create(restarted, scope, content=b"lost acknowledgement", operation=key)
        assert retry.status_code == 201 and retry.json() == saved.json()
    assert tuple(map(len, state(runtime_database))) == (1, 1)


def test_stream_without_content_length_accepts_exact_limit(runtime_database, actors):
    actor, scope = actors[0]
    with TestClient(actor_app(actor)) as client:
        response = create(client, scope, content=iter([b"a" * 32768, b"b" * 32768]))
        assert response.status_code == 201
        assert response.json()["size"] == MAX_CONTENT_BYTES
        saved = exact(client, scope, response.json()["source_id"])
        assert saved.content == b"a" * 32768 + b"b" * 32768


@pytest.mark.parametrize(
    "scope_kind,sqlstate", [("null", "23502"), ("absent", "23503")]
)
def test_database_requires_source_scope(runtime_database, scope_kind, sqlstate):
    with pytest.raises(IntegrityError) as error, runtime_database.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO source (id, scope_id, current_version) VALUES (:id, :scope, 1)"
            ),
            {"id": uuid4(), "scope": None if scope_kind == "null" else uuid4()},
        )
    assert error.value.orig.sqlstate == sqlstate
    assert state(runtime_database) == ([], [])


def test_documented_server_launch_keeps_secrets_out_of_access_logs(
    runtime_database, actors, tmp_path
):
    import socket
    import subprocess
    import sys
    import time

    import httpx2

    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    secret = "synthetic-private-transport-marker"
    log_path = tmp_path / "server.log"
    with log_path.open("w") as log:
        process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "--no-proxy-headers",
                "aulalista_api.app:create_app",
                "--factory",
                "--host",
                "127.0.0.1",
                "--port",
                str(port),
                "--no-access-log",
            ],
            stdout=log,
            stderr=subprocess.STDOUT,
        )
        try:
            with httpx2.Client(
                base_url=f"http://127.0.0.1:{port}", timeout=2, trust_env=False
            ) as client:
                deadline = time.monotonic() + 10
                while True:
                    assert process.poll() is None
                    try:
                        if client.get("/health/live").status_code == 200:
                            break
                    except httpx2.TransportError:
                        pass
                    assert time.monotonic() < deadline
                    time.sleep(0.05)
                assert client.get("/health/ready").status_code == 200
                response = client.post(
                    f"/scopes/{actors[0][1]}/sources?private={secret}",
                    content=secret.encode(),
                    headers={
                        "Authorization": f"Bearer {secret}",
                        "Idempotency-Key": str(uuid4()),
                        "Content-Type": "application/octet-stream",
                    },
                )
                assert response.status_code == 401
                assert secret not in response.text
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
    output = log_path.read_text()
    for forbidden in [
        secret,
        "postgresql+psycopg",
        "Traceback",
        "Authorization",
        "INSERT INTO",
    ]:
        assert forbidden not in output
    assert "Application startup complete" in output


def test_interrupted_upload_has_no_effect(runtime_database, actors):
    actor, scope = actors[0]
    messages = iter(
        [
            {"type": "http.request", "body": b"partial", "more_body": True},
            {"type": "http.disconnect"},
        ]
    )
    sent = []

    async def receive():
        return next(messages)

    async def send(message):
        sent.append(message)

    app = actor_app(actor)
    scope_asgi = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "method": "POST",
        "scheme": "http",
        "path": f"/scopes/{scope}/sources",
        "query_string": b"",
        "headers": [
            (b"content-type", b"application/octet-stream"),
            (b"idempotency-key", str(uuid4()).encode()),
        ],
        "server": ("synthetic", 80),
        "client": ("synthetic", 1),
        "root_path": "",
        "http_version": "1.1",
    }
    asyncio.run(app(scope_asgi, receive, send))
    assert sent[0]["status"] == 422
    assert state(runtime_database) == ([], [])


def test_receipt_is_utc_and_identical_after_database_timezone_change(
    runtime_database, migrated_database, actors
):
    actor, scope = actors[0]
    key = uuid4()
    with TestClient(actor_app(actor)) as first:
        saved = create(first, scope, operation=key).json()
        original = exact(first, scope, saved["source_id"])
        assert saved["created_at"].endswith("+00:00")
        assert original.headers["x-created-at"] == saved["created_at"]
    with migrated_database.begin() as connection:
        connection.execute(
            text("ALTER ROLE aulalista_runtime SET timezone = 'Asia/Tokyo'")
        )
    try:
        with runtime_database.connect() as connection:
            assert (
                connection.execute(text("SHOW timezone")).scalar_one() == "Asia/Tokyo"
            )
        with TestClient(actor_app(actor)) as restarted:
            assert operation(restarted, scope, key).json() == saved
            assert create(restarted, scope, operation=key).json() == saved
            recovered = exact(restarted, scope, saved["source_id"])
            assert recovered.headers == original.headers
            assert recovered.content == original.content
    finally:
        with migrated_database.begin() as connection:
            connection.execute(text("ALTER ROLE aulalista_runtime RESET timezone"))


def test_postgres_privacy_configuration_and_real_failing_row_probe(
    runtime_database, actors
):
    from check_postgres_log import PRIVATE_MARKER

    expected = {
        "log_error_verbosity": "terse",
        "log_min_error_statement": "panic",
        "log_statement": "none",
        "log_min_duration_statement": "-1",
        "log_min_duration_sample": "-1",
        "log_parameter_max_length": "0",
        "log_parameter_max_length_on_error": "0",
    }
    with runtime_database.connect() as connection:
        for name, value in expected.items():
            assert (
                connection.execute(
                    text("SELECT current_setting(:name)"), {"name": name}
                ).scalar_one()
                == value
            )
    actor, scope = actors[0]
    with TestClient(actor_app(actor)) as client:
        saved = create(client, scope).json()
    with Session(runtime_database) as session:
        row = session.get(SourceVersion, UUID(saved["version_id"]))
        values = {
            column.name: getattr(row, column.name)
            for column in SourceVersion.__table__.columns
        }
    values.update(
        id=uuid4(),
        number=2,
        operation_id=uuid4(),
        content=PRIVATE_MARKER,
        size=len(PRIVATE_MARKER),
        content_sha256="0" * 64,
    )
    before = state(runtime_database)
    with pytest.raises(IntegrityError) as error, runtime_database.begin() as connection:
        connection.execute(SourceVersion.__table__.insert().values(**values))
    assert error.value.orig.sqlstate == "23514"
    assert state(runtime_database) == before
    # The mandatory post-test log check reads this server's actual output separately.


@pytest.mark.parametrize(
    "leak", ["Failing row contains", "STATEMENT:", "marker", "hex"]
)
def test_server_log_verifier_detects_leaks(leak):
    from check_postgres_log import PRIVATE_MARKER, verify_log

    leaked = {"marker": PRIVATE_MARKER.decode(), "hex": PRIVATE_MARKER.hex()}.get(
        leak, leak
    )
    with pytest.raises(AssertionError):
        verify_log("ERROR: ck_version_hash\n" + leaked)
    verify_log("ERROR: violates check constraint ck_version_hash\n")
