"""#52 against real disposable PostgreSQL, including source-less B3 history."""

import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import event, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from test_auth_integration import ORIGIN, login
from test_auth_integration import auth_factory as auth_factory
from test_guided_planning import guided_body
from test_materials import actor_app, append, create
from test_planning_edits import write as edit

from aulalista_api.app import create_app
from aulalista_api.database import SCHEMA_REVISION
from aulalista_api.guided_planning import GuidedPlanningRequest
from aulalista_api.materials import MaterialError
from aulalista_api.plannings import Plannings
from aulalista_api.water_fixture import FIXTURE_SOURCE


def submit(client, scope, body=None, key=None):
    return client.post(
        f"/scopes/{scope}/guided-plannings",
        json=guided_body() if body is None else body,
        headers={"Idempotency-Key": str(key or uuid4())},
    )


def edit_body(
    element="purpose",
    value="Propósito corregido.",
    revision=1,
    resource="planning",
    kind="edit",
):
    return {
        "contract_version": 1,
        "resource_key": resource,
        "element_key": element,
        "text": value,
        "expected_revision" if kind == "edit" else "base_revision": revision,
        **({"expected_draft_revision": 0} if kind == "draft" else {}),
    }


def test_source_less_create_library_restart_and_idempotent_receipt(
    runtime_database, actors, monkeypatch
):
    import aulalista_api.plannings as module

    actor, scope = actors[0]
    key = uuid4()
    with TestClient(actor_app(actor)) as client:
        response = submit(client, scope, key=key)
        assert response.status_code == 201
        assert response.headers["cache-control"] == "no-store"
        saved = response.json()
        assert saved["request"] == guided_body()
        assert saved["receipt"]["revision"] == 1
        for field in (
            "source_id",
            "source_version_id",
            "source_version",
            "source_sha256",
        ):
            assert saved["receipt"][field] is None
    runtime_database.dispose()
    monkeypatch.setattr(
        module, "generate_guided", lambda *args: pytest.fail("Recovery regenerated")
    )
    with TestClient(actor_app(actor)) as client:
        assert client.get(f"/scopes/{scope}/plannings").json() == {
            "items": [saved],
            "next_cursor": None,
        }
        assert (
            client.get(
                f"/scopes/{scope}/plannings/{saved['receipt']['planning_id']}"
            ).json()
            == saved
        )
        assert client.get(f"/scopes/{scope}/planning-operations/{key}").json() == saved
        assert submit(client, scope, key=key).json() == saved
        assert (
            submit(client, scope, guided_body(duration_minutes=30), key).status_code
            == 409
        )
    with runtime_database.connect() as connection:
        assert connection.scalar(text("SELECT count(*) FROM source")) == 0
        assert connection.scalar(text("SELECT count(*) FROM planning_revision")) == 1


@pytest.mark.parametrize(
    "change,detail",
    [
        ({"duration_minutes": 14}, "invalid_request"),
        ({"context": {"text": "Hipótesis"}}, "invalid_request"),
        ({"source_id": str(uuid4())}, "invalid_request"),
        ({"subject": "Historia"}, "unsupported_fixture"),
        ({"grade": "4.º de primaria"}, "unsupported_fixture"),
        ({"topic": "Cualquier tema"}, "unsupported_fixture"),
        ({"language": "en"}, "unsupported_fixture"),
        ({"method": "lecture"}, "unsupported_fixture"),
    ],
)
def test_rejected_guided_inputs_leave_no_resource(
    runtime_database, actors, change, detail
):
    actor, scope = actors[0]
    key = uuid4()
    with TestClient(actor_app(actor)) as client:
        denied = submit(client, scope, guided_body(**change), key)
        assert denied.status_code == 422
        assert denied.json() == {"detail": detail}
        assert (
            client.get(f"/scopes/{scope}/planning-operations/{key}").status_code == 404
        )
        assert client.get(f"/scopes/{scope}/plannings").json()["items"] == []
    with runtime_database.connect() as connection:
        assert connection.scalar(text("SELECT count(*) FROM planning")) == 0
        assert connection.scalar(text("SELECT count(*) FROM source")) == 0


def test_exact_historical_reference_is_retained_and_never_interpreted(
    runtime_database, actors
):
    actor, scope = actors[0]
    with TestClient(actor_app(actor)) as client:
        source = create(client, scope, FIXTURE_SOURCE).json()
        assert append(client, scope, source["source_id"]).status_code == 201
        body = guided_body(
            reference={"source_id": source["source_id"], "source_version": 1}
        )
        response = submit(client, scope, body)
        assert response.status_code == 201
        saved = response.json()
        assert saved["receipt"]["source_version_id"] == source["version_id"]
        assert saved["receipt"]["source_sha256"] == source["sha256"]
        assert saved["receipt"]["source_version"] == 1
        assert saved["request"] == body
        missing = submit(
            client,
            scope,
            guided_body(
                reference={"source_id": source["source_id"], "source_version": 99}
            ),
        )
        assert missing.status_code == 404
    with TestClient(actor_app(actor)) as client:
        assert (
            client.get(
                f"/scopes/{scope}/sources/{source['source_id']}/versions/1"
            ).content
            == FIXTURE_SOURCE
        )
        assert (
            client.get(
                f"/scopes/{scope}/plannings/{saved['receipt']['planning_id']}"
            ).json()
            == saved
        )


def test_foreign_scope_planning_reference_and_service_are_closed(
    runtime_database, actors
):
    actor, scope = actors[0]
    other, foreign_scope = actors[1]
    key = uuid4()
    with TestClient(actor_app(actor)) as client:
        saved = submit(client, scope, key=key).json()
        source = create(client, scope, FIXTURE_SOURCE).json()
    with TestClient(actor_app(other)) as client:
        for requested_scope in (scope, foreign_scope):
            assert (
                client.get(
                    f"/scopes/{requested_scope}/plannings/{saved['receipt']['planning_id']}"
                ).status_code
                == 404
            )
            assert (
                client.get(
                    f"/scopes/{requested_scope}/planning-operations/{key}"
                ).status_code
                == 404
            )
            assert (
                edit(
                    client,
                    requested_scope,
                    saved["receipt"]["planning_id"],
                    payload=edit_body(),
                ).status_code
                == 404
            )
        assert submit(client, scope).status_code == 404
        foreign = submit(
            client,
            foreign_scope,
            guided_body(
                reference={"source_id": source["source_id"], "source_version": 1}
            ),
        )
        absent = submit(
            client,
            foreign_scope,
            guided_body(reference={"source_id": str(uuid4()), "source_version": 1}),
        )
        assert foreign.status_code == absent.status_code == 404
        assert foreign.json() == absent.json() == {"detail": "not_found"}
    with pytest.raises(MaterialError) as denied:
        Plannings(runtime_database).write(
            other, scope, key, GuidedPlanningRequest.model_validate(guided_body())
        )
    assert denied.value.status == 404
    with TestClient(create_app()) as client:
        assert submit(client, scope).status_code == 401


def test_all_guided_edits_drafts_copies_and_old_receipts_survive_new_session(
    runtime_database, actors
):
    actor, scope = actors[0]
    with TestClient(actor_app(actor)) as client:
        initial = submit(client, scope).json()
        planning = initial["receipt"]["planning_id"]
        saved = initial
        for revision, (resource, element, value) in enumerate(
            [
                ("planning", "purpose", "Propósito modificado."),
                ("planning", "formative_assessment", "Evaluación modificada."),
                ("planning", "material-0", "Material modificado."),
                ("activity:introduction", "statement", "Actividad modificada."),
                ("activity:exploration", "minutes", "45"),
            ],
            1,
        ):
            changed = edit(
                client,
                scope,
                planning,
                payload=edit_body(element, value, revision, resource),
            )
            assert changed.status_code == 201
            saved = changed.json()
            assert saved["initial_request"] == initial["request"]
            assert saved["receipt"]["source_id"] is None
        assert saved["result"]["duration_minutes"] == 65
        assert (
            submit(
                client, scope, initial["request"], initial["receipt"]["operation_id"]
            ).json()
            == initial
        )
        assert edit(client, scope, planning, payload=edit_body()).status_code == 409
        copied = edit(
            client,
            scope,
            planning,
            "copy",
            payload=edit_body(value="Copia independiente.", revision=6, kind="copy"),
        )
        assert copied.status_code == 201
        copied = copied.json()
        assert copied["origin"]["revision_id"] == saved["receipt"]["revision_id"]
        draft_id = uuid4()
        draft = edit(
            client,
            scope,
            planning,
            "draft",
            draft_id=draft_id,
            payload=edit_body(value="Borrador sobre V1.", kind="draft"),
        )
        assert draft.status_code == 201
        draft = draft.json()
        assert draft["initial_request"] == initial["request"]
    with TestClient(actor_app(actor)) as client:
        assert client.get(f"/scopes/{scope}/plannings/{planning}").json() == saved
        assert (
            client.get(f"/scopes/{scope}/plannings/{planning}/revisions/1").json()
            == initial
        )
        assert (
            client.get(
                f"/scopes/{scope}/planning-operations/{initial['receipt']['operation_id']}"
            ).json()
            == initial
        )
        assert client.get(f"/scopes/{scope}/planning-drafts/{draft_id}").json() == draft
        assert client.get(f"/scopes/{scope}/planning-drafts").json()["items"] == [draft]
        assert sorted(
            x["receipt"]["planning_id"]
            for x in client.get(f"/scopes/{scope}/plannings").json()["items"]
        ) == sorted([planning, copied["receipt"]["planning_id"]])
        assert saved["initial_request"]["context"]["hypothetical"] is True
        assert copied["initial_request"]["context"]["hypothetical"] is True


@pytest.mark.parametrize("different", [False, True])
def test_guided_same_operation_race_uses_distinct_connections(
    runtime_database, actors, different
):
    actor, scope = actors[0]
    key = uuid4()
    apps = [actor_app(actor), actor_app(actor)]
    barrier, pids = threading.Barrier(2), set()

    def synchronize(conn, cursor, statement, parameters, context, executemany):
        if statement.startswith("SELECT pg_advisory_xact_lock"):
            pids.add(conn.connection.driver_connection.info.backend_pid)
            barrier.wait(timeout=5)

    event.listen(Engine, "before_cursor_execute", synchronize)
    try:

        def contender(index):
            with TestClient(apps[index]) as client:
                return submit(
                    client,
                    scope,
                    guided_body(duration_minutes=30 if index and different else 50),
                    key,
                )

        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(contender, [0, 1]))
    finally:
        event.remove(Engine, "before_cursor_execute", synchronize)
    assert len(pids) == 2
    assert sorted(r.status_code for r in responses) == (
        [201, 409] if different else [201, 201]
    )
    if not different:
        assert responses[0].json() == responses[1].json()
    with runtime_database.connect() as connection:
        assert connection.scalar(text("SELECT count(*) FROM planning_revision")) == 1


def test_guided_two_editors_cas_one_winner(runtime_database, actors):
    actor, scope = actors[0]
    with TestClient(actor_app(actor)) as client:
        planning = submit(client, scope).json()["receipt"]["planning_id"]
    apps = [actor_app(actor), actor_app(actor)]
    barrier, pids = threading.Barrier(2), set()

    def synchronize(conn, cursor, statement, parameters, context, executemany):
        if statement.startswith("SELECT pg_advisory_xact_lock"):
            pids.add(conn.connection.driver_connection.info.backend_pid)
            barrier.wait(timeout=5)

    event.listen(Engine, "before_cursor_execute", synchronize)
    try:

        def contender(index):
            with TestClient(apps[index]) as client:
                return edit(
                    client, scope, planning, payload=edit_body(value=f"Editor {index}.")
                )

        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(contender, [0, 1]))
    finally:
        event.remove(Engine, "before_cursor_execute", synchronize)
    assert len(pids) == 2
    assert sorted(r.status_code for r in responses) == [201, 409]
    saved = next(r.json() for r in responses if r.status_code == 201)
    with TestClient(actor_app(actor)) as client:
        assert client.get(f"/scopes/{scope}/plannings/{planning}").json() == saved


def test_guided_commit_failure_rolls_back_and_lost_response_recovers(
    runtime_database, migrated_database, actors, monkeypatch
):
    actor, scope = actors[0]
    key = uuid4()
    with migrated_database.begin() as connection:
        connection.execute(
            text("""
            CREATE FUNCTION fail_guided_commit() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'synthetic failure' USING ERRCODE = '23514'; END; $$;
            CREATE CONSTRAINT TRIGGER fail_guided_commit AFTER INSERT ON planning_revision
            DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_guided_commit()
        """)
        )
    with TestClient(actor_app(actor)) as client:
        failed = submit(client, scope, key=key)
        assert failed.status_code == 503
        assert (
            client.get(f"/scopes/{scope}/planning-operations/{key}").status_code == 404
        )
        assert client.get(f"/scopes/{scope}/plannings").json()["items"] == []
    with migrated_database.begin() as connection:
        connection.execute(
            text(
                "DROP TRIGGER fail_guided_commit ON planning_revision; DROP FUNCTION fail_guided_commit()"
            )
        )
    original = Plannings.write

    def lose_response(*args, **kwargs):
        original(*args, **kwargs)
        raise ConnectionError("synthetic response loss after commit")

    monkeypatch.setattr(Plannings, "write", lose_response)
    with TestClient(actor_app(actor)) as client, pytest.raises(ConnectionError):
        submit(client, scope, key=key)
    monkeypatch.setattr(Plannings, "write", original)
    with TestClient(actor_app(actor)) as client:
        saved = client.get(f"/scopes/{scope}/planning-operations/{key}").json()
        assert submit(client, scope, key=key).json() == saved
        assert len(client.get(f"/scopes/{scope}/plannings").json()["items"]) == 1


def test_null_source_origin_still_enforces_scope_and_exact_source(
    runtime_database, migrated_database, actors, monkeypatch
):
    a, scope_a = actors[0]
    b, scope_b = actors[1]
    with TestClient(actor_app(a)) as client:
        no_source = submit(client, scope_a).json()
        source = create(client, scope_a, FIXTURE_SOURCE).json()
        linked = submit(
            client,
            scope_a,
            guided_body(
                reference={"source_id": source["source_id"], "source_version": 1}
            ),
        ).json()
    with TestClient(actor_app(b)) as client:
        foreign = submit(client, scope_b).json()
    for origin in (foreign, linked):
        with pytest.raises(IntegrityError), migrated_database.begin() as connection:
            connection.execute(
                text("""
                INSERT INTO planning_revision (id, planning_id, scope_id, number, source_version_id,
                    actor_id, operation_id, request_fingerprint, request, result, origin_revision_id)
                SELECT :id, planning_id, scope_id, 2, NULL, actor_id, :op, request_fingerprint,
                    request, result, :origin FROM planning_revision WHERE id=:base
            """),
                {
                    "id": uuid4(),
                    "op": uuid4(),
                    "origin": UUID(origin["receipt"]["revision_id"]),
                    "base": UUID(no_source["receipt"]["revision_id"]),
                },
            )
    # Nullable source must not let a source-backed copy claim source-less origin.
    with pytest.raises(IntegrityError), migrated_database.begin() as connection:
        connection.execute(
            text("""
            INSERT INTO planning_revision (id, planning_id, scope_id, number, source_version_id,
                actor_id, operation_id, request_fingerprint, request, result, origin_revision_id)
            SELECT :id, planning_id, scope_id, 2, source_version_id, actor_id, :op, request_fingerprint,
                request, result, :origin FROM planning_revision WHERE id=:base
        """),
            {
                "id": uuid4(),
                "op": uuid4(),
                "origin": UUID(no_source["receipt"]["revision_id"]),
                "base": UUID(linked["receipt"]["revision_id"]),
            },
        )
    monkeypatch.setenv(
        "AULALISTA_DATABASE_URL",
        migrated_database.url.render_as_string(hide_password=False),
    )
    command.check(Config("alembic.ini"))
    # A rollback cannot silently destroy rows that the previous NOT NULL schema cannot represent.
    with pytest.raises(IntegrityError):
        command.downgrade(Config("alembic.ini"), "0006_editor_recovery")
    with migrated_database.connect() as connection:
        assert (
            connection.scalar(text("SELECT version_num FROM alembic_version"))
            == SCHEMA_REVISION
        )
        assert connection.scalar(text("SELECT count(*) FROM planning_revision")) == 3


def test_real_new_auth_session_recovers_only_confirmed_guided_work(
    auth_factory, monkeypatch
):
    import aulalista_api.auth as authentication

    factory, sender = auth_factory
    instant = authentication.now()
    monkeypatch.setattr(authentication, "now", lambda: instant)
    with factory() as client:
        first = login(client, sender)
        headers = {
            "Origin": ORIGIN,
            "X-CSRF-Token": first["csrf_token"],
            "Idempotency-Key": str(uuid4()),
        }
        saved = client.post(
            f"/scopes/{first['scope_id']}/guided-plannings",
            json=guided_body(),
            headers=headers,
        )
        assert saved.status_code == 201
        saved = saved.json()
        assert client.post("/auth/logout", headers=headers).status_code == 204
        assert client.get(f"/scopes/{first['scope_id']}/plannings").status_code == 401
    instant += timedelta(seconds=61)
    with factory() as fresh:
        second = login(fresh, sender)
        assert second["scope_id"] == first["scope_id"]
        assert second["recovery_context_id"] != first["recovery_context_id"]
        assert fresh.get(f"/scopes/{second['scope_id']}/plannings").json()["items"] == [
            saved
        ]
        assert saved["request"]["context"]["hypothetical"] is True


def test_guided_creation_revalidates_authority_inside_operation(
    auth_factory, monkeypatch
):
    factory, sender = auth_factory
    reached, release = threading.Event(), threading.Event()
    original = Plannings.write

    def delayed(*args, **kwargs):
        reached.set()
        assert release.wait(timeout=10)
        return original(*args, **kwargs)

    monkeypatch.setattr(Plannings, "write", delayed)
    with factory() as client, factory() as concurrent:
        session = login(client, sender)
        concurrent.cookies.set(
            "__Host-acenta-session", client.cookies.get("__Host-acenta-session")
        )
        headers = {
            "Origin": ORIGIN,
            "X-CSRF-Token": session["csrf_token"],
            "Idempotency-Key": str(uuid4()),
        }
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(
                concurrent.post,
                f"/scopes/{session['scope_id']}/guided-plannings",
                json=guided_body(),
                headers=headers,
            )
            try:
                assert reached.wait(timeout=5)
                assert client.post("/auth/logout", headers=headers).status_code == 204
            finally:
                release.set()
            assert pending.result(timeout=10).status_code == 401


def test_guided_transport_limits_and_versioned_route_separation(
    runtime_database, actors
):
    import json

    actor, scope = actors[0]
    with TestClient(actor_app(actor)) as client:
        # Legacy B2 remains source-required and does not silently reinterpret a new DTO.
        assert (
            client.post(
                f"/scopes/{scope}/plannings",
                json=guided_body(),
                headers={"Idempotency-Key": str(uuid4())},
            ).status_code
            == 422
        )
        body = json.dumps(guided_body(), ensure_ascii=False).encode()
        for content, media, status in [
            (body + b" " * (4096 - len(body)), "application/json", 201),
            (body + b" " * 4096, "application/json", 413),
            (b"{", "application/json", 422),
            (body, "text/plain", 415),
        ]:
            response = client.post(
                f"/scopes/{scope}/guided-plannings",
                content=content,
                headers={"Idempotency-Key": str(uuid4()), "Content-Type": media},
            )
            assert response.status_code == status
        too_large = GuidedPlanningRequest.model_validate(
            guided_body(context={"text": "🧪" * 1000, "hypothetical": True})
        )
        with pytest.raises(MaterialError) as denied:
            Plannings(runtime_database).write(actor, scope, uuid4(), too_large)
        assert denied.value.status == 413
        assert len(client.get(f"/scopes/{scope}/plannings").json()["items"]) == 1


def test_guided_missing_receipt_before_commit_is_not_success(runtime_database, actors):
    actor, scope = actors[0]
    key = uuid4()
    inserted, release = threading.Event(), threading.Event()
    app = actor_app(actor)

    def pause(conn, cursor, statement, parameters, context, executemany):
        if statement.startswith("INSERT INTO planning_revision"):
            inserted.set()
            assert release.wait(timeout=5)

    def writer():
        with TestClient(app) as client:
            return submit(client, scope, key=key)

    event.listen(Engine, "after_cursor_execute", pause)
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
                    assert (
                        client.get(f"/scopes/{scope}/plannings").json()["items"] == []
                    )
                assert not pending.done()
            finally:
                release.set()
            saved = pending.result(timeout=5)
            assert saved.status_code == 201
    finally:
        release.set()
        event.remove(Engine, "after_cursor_execute", pause)
    with TestClient(actor_app(actor)) as client:
        assert submit(client, scope, key=key).json() == saved.json()
