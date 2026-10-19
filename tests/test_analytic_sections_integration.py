"""Manual sections and exact derivations against disposable PostgreSQL."""

import json
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
from sqlalchemy.exc import DBAPIError, IntegrityError
from test_analytic_sections import derive_body, section_body
from test_auth_integration import ORIGIN, login
from test_auth_integration import auth_factory as auth_factory
from test_guided_planning_integration import edit_body
from test_materials import actor_app, append, create
from test_planning_edits import write as edit_planning

from aulalista_api.analytic_sections import (
    AnalyticSectionData,
    AnalyticSections,
    DerivePlanningRequest,
)
from aulalista_api.database import SCHEMA_REVISION
from aulalista_api.materials import MaterialError
from aulalista_api.plannings import Plannings
from aulalista_api.water_fixture import FIXTURE_SOURCE


def write(client, scope, data=None, key=None, section=None, expected=1):
    path = f"/scopes/{scope}/analytic-sections"
    payload = section_body() if data is None else data
    if section is not None:
        path += f"/{section}/revisions"
        payload = {
            "contract_version": 1,
            "expected_revision": expected,
            "data": payload,
        }
    return client.post(
        path, json=payload, headers={"Idempotency-Key": str(key or uuid4())}
    )


def derive(client, scope, section, number=1, body=None, key=None):
    return client.post(
        f"/scopes/{scope}/analytic-sections/{section}/revisions/{number}/plannings",
        json=derive_body() if body is None else body,
        headers={"Idempotency-Key": str(key or uuid4())},
    )


def operation(client, scope, key):
    return client.get(f"/scopes/{scope}/analytic-section-operations/{key}")


def test_section_restart_exact_revisions_and_replay_after_new_revision(
    runtime_database, actors
):
    actor, scope = actors[0]
    key = uuid4()
    with TestClient(actor_app(actor)) as client:
        assert client.get(f"/scopes/{scope}/analytic-sections").json() == {
            "items": [],
            "next_cursor": None,
        }
        response = write(client, scope, key=key)
        assert response.status_code == 201
        assert response.headers["cache-control"] == "no-store"
        original = response.json()
        receipt = original["receipt"]
        section = receipt["section_id"]
        assert receipt["namespace"] == "analytic-section-v1"
        assert receipt["revision"] == 1
        assert receipt["scope_id"] == str(scope)
        assert receipt["actor_id"] == str(actor)
        assert receipt["operation_id"] == str(key)
        assert original["data"] == section_body()
        assert original["provenance"] == "manual-v1"
        for field in (
            "source_id",
            "source_version_id",
            "source_version",
            "source_sha256",
        ):
            assert receipt[field] is None
        changed = section_body(situation="Una situación modificada.")
        revised = write(client, scope, changed, section=section)
        assert revised.status_code == 201
        revised = revised.json()
        assert revised["receipt"]["revision"] == 2
        assert revised["data"] == changed
        assert write(client, scope, key=key).json() == original
        assert write(client, scope, changed, key=key).status_code == 409
        assert write(client, scope, section=section).status_code == 409
    runtime_database.dispose()
    with TestClient(actor_app(actor)) as client:
        base = f"/scopes/{scope}/analytic-sections/{section}"
        assert client.get(base).json() == revised
        assert client.get(base + "/revisions/1").json() == original
        assert client.get(base + "/revisions/2").json() == revised
        assert client.get(base + "/revisions/3").status_code == 404
        assert operation(client, scope, key).json() == original
        assert client.get(f"/scopes/{scope}/analytic-sections").json() == {
            "items": [revised],
            "next_cursor": None,
        }


def test_section_catalog_paginates_latest_revisions_and_rejects_foreign_cursors(
    runtime_database, actors
):
    (actor, scope), (other, other_scope) = actors
    with TestClient(actor_app(other)) as client:
        foreign = write(client, other_scope).json()["receipt"]["section_id"]
    with TestClient(actor_app(actor)) as client:
        saved = [
            write(client, scope, section_body(period=f"Periodo {index}")).json()
            for index in range(3)
        ]
        saved[0] = write(
            client,
            scope,
            section_body(period="Periodo corregido"),
            section=saved[0]["receipt"]["section_id"],
        ).json()
        expected = sorted(saved, key=lambda item: item["receipt"]["section_id"])
        base = f"/scopes/{scope}/analytic-sections"
        cursor = None
        actual = []
        for index in range(3):
            params = {"limit": 1, **({"after": cursor} if cursor is not None else {})}
            response = client.get(base, params=params)
            assert response.status_code == 200
            assert response.headers["cache-control"] == "no-store"
            page = response.json()
            assert page["items"] == [expected[index]]
            actual.extend(page["items"])
            cursor = page["next_cursor"]
            assert cursor == (
                expected[index]["receipt"]["section_id"] if index < 2 else None
            )
        assert actual == expected
        for invalid in [foreign, str(uuid4())]:
            denied = client.get(base, params={"after": invalid})
            assert denied.status_code == 422
            assert denied.json() == {"detail": "invalid_request"}
        for invalid in [0, 101]:
            assert client.get(base, params={"limit": invalid}).status_code == 422


def test_exact_reference_and_hypothetical_context_are_retained_across_derivation(
    runtime_database, actors
):
    actor, scope = actors[0]
    with TestClient(actor_app(actor)) as client:
        source = create(client, scope, FIXTURE_SOURCE).json()
        assert append(client, scope, source["source_id"]).status_code == 201
        data = section_body(
            reference={"source_id": source["source_id"], "source_version": 1}
        )
        section = write(client, scope, data).json()
        assert section["receipt"]["source_version_id"] == source["version_id"]
        assert section["receipt"]["source_sha256"] == source["sha256"]
        derived = derive(client, scope, section["receipt"]["section_id"])
        assert derived.status_code == 201
        derived = derived.json()
        assert derived["analytic_origin"] == section
        assert derived["request"]["reference"] == data["reference"]
        assert derived["request"]["context"] == data["context"]
        assert derived["request"]["formative_field"] == data["formative_field"]
        assert derived["request"]["articulating_axes"] == data["articulating_axes"]
        assert derived["receipt"]["source_version_id"] == source["version_id"]
        assert derived["receipt"]["source_version"] == 1
        assert derived["result"]["provenance"] == "synthetic-fixture-v1"
        assert "manual" in derived["result"]["notice"].lower()
        denied = write(
            client,
            scope,
            section_body(
                reference={"source_id": source["source_id"], "source_version": 99}
            ),
        )
        assert denied.status_code == 404


def test_section_and_derived_planning_edits_copies_and_drafts_are_independent(
    runtime_database, actors
):
    actor, scope = actors[0]
    with TestClient(actor_app(actor)) as client:
        original = write(client, scope).json()
        section = original["receipt"]["section_id"]
        derived = derive(client, scope, section).json()
        planning = derived["receipt"]["planning_id"]
        edited = edit_planning(client, scope, planning, payload=edit_body())
        assert edited.status_code == 201
        edited = edited.json()
        copied = edit_planning(
            client,
            scope,
            planning,
            "copy",
            payload=edit_body(
                kind="copy", revision=2, value="Copia de clase independiente."
            ),
        )
        assert copied.status_code == 201
        copied = copied.json()
        draft_id = uuid4()
        draft = edit_planning(
            client,
            scope,
            planning,
            "draft",
            draft_id=draft_id,
            payload=edit_body(kind="draft", value="Borrador independiente."),
        )
        assert draft.status_code == 201
        draft = draft.json()
        for saved in [derived, edited, copied, draft]:
            assert saved["analytic_origin"] == original
        assert (
            client.get(f"/scopes/{scope}/analytic-sections/{section}").json()
            == original
        )
        revised = write(
            client,
            scope,
            section_body(
                situation="Nueva situación.",
                entries=[{"content": "Contenido cambiado.", "pda": "PDA cambiado."}],
                context={"text": "Otro contexto de ejemplo.", "hypothetical": False},
            ),
            section=section,
        )
        assert revised.status_code == 201
        revised = revised.json()
        historical = derive(client, scope, section, 1)
        newest = derive(client, scope, section, 2)
        assert historical.status_code == newest.status_code == 201
        assert historical.json()["analytic_origin"] == original
        assert newest.json()["analytic_origin"] == revised
        assert newest.json()["request"]["context"] == revised["data"]["context"]
    with TestClient(actor_app(actor)) as client:
        assert client.get(f"/scopes/{scope}/plannings/{planning}").json() == edited
        assert (
            client.get(f"/scopes/{scope}/plannings/{planning}/revisions/1").json()
            == derived
        )
        assert client.get(f"/scopes/{scope}/planning-drafts/{draft_id}").json() == draft
        assert (
            client.get(
                f"/scopes/{scope}/plannings/{copied['receipt']['planning_id']}"
            ).json()
            == copied
        )
        assert (
            client.get(f"/scopes/{scope}/analytic-sections/{section}").json() == revised
        )


def test_derivation_replay_keeps_chosen_revision_and_binds_origin_identity(
    runtime_database, actors
):
    actor, scope = actors[0]
    key = uuid4()
    with TestClient(actor_app(actor)) as client:
        original = write(client, scope).json()
        section = original["receipt"]["section_id"]
        another = write(client, scope).json()["receipt"]["section_id"]
        saved = derive(client, scope, section, key=key)
        assert saved.status_code == 201
        saved = saved.json()
        revised = write(
            client, scope, section_body(period="Periodo cambiado"), section=section
        )
        assert revised.status_code == 201
        assert derive(client, scope, section, key=key).json() == saved
        for response in [
            derive(client, scope, section, 2, key=key),
            derive(client, scope, another, key=key),
            derive(
                client, scope, section, body=derive_body(duration_minutes=30), key=key
            ),
        ]:
            assert response.status_code == 409
            assert response.json() == {"detail": "conflict"}
        assert saved["analytic_origin"] == original
        assert client.get(f"/scopes/{scope}/plannings").json()["items"] == [saved]
    with TestClient(actor_app(actor)) as client:
        assert client.get(f"/scopes/{scope}/planning-operations/{key}").json() == saved
        assert derive(client, scope, section, key=key).json() == saved


def test_unsupported_fixture_does_not_erase_or_truncate_full_manual_section(
    runtime_database, actors
):
    actor, scope = actors[0]
    key = uuid4()
    data = section_body(
        name="Un tema manual distinto",
        grade="4.º de primaria",
        entries=[{"content": "c" * 500, "pda": "p" * 500}] * 6,
    )
    with TestClient(actor_app(actor)) as client:
        saved = write(client, scope, data)
        assert saved.status_code == 201
        saved = saved.json()
        section = saved["receipt"]["section_id"]
        denied = derive(client, scope, section, key=key)
        assert denied.status_code == 422
        assert denied.json() == {"detail": "unsupported_fixture"}
        assert (
            client.get(f"/scopes/{scope}/analytic-sections/{section}").json() == saved
        )
        assert saved["data"] == data
        assert client.get(f"/scopes/{scope}/plannings").json()["items"] == []
        assert (
            client.get(f"/scopes/{scope}/planning-operations/{key}").status_code == 404
        )


def test_foreign_sections_operations_and_references_do_not_reveal_identity(
    runtime_database, actors
):
    (actor, scope), (other, other_scope) = actors
    key = uuid4()
    with TestClient(actor_app(actor)) as client:
        original = write(client, scope, key=key).json()
        source = create(client, scope, FIXTURE_SOURCE).json()
    section = original["receipt"]["section_id"]
    with TestClient(actor_app(other)) as client:
        for requested_scope in (scope, other_scope):
            for target in (section, uuid4()):
                base = f"/scopes/{requested_scope}/analytic-sections/{target}"
                for response in [
                    client.get(base),
                    client.get(base + "/revisions/1"),
                    write(client, requested_scope, section=target),
                    derive(client, requested_scope, target),
                ]:
                    assert response.status_code == 404
                    assert response.json() == {"detail": "not_found"}
                    assert response.headers["cache-control"] == "no-store"
            assert operation(client, requested_scope, key).status_code == 404
        assert write(client, scope).status_code == 404
        assert client.get(f"/scopes/{scope}/analytic-sections").status_code == 404
        for source_id in (source["source_id"], str(uuid4())):
            denied = write(
                client,
                other_scope,
                section_body(reference={"source_id": source_id, "source_version": 1}),
            )
            assert denied.status_code == 404
            assert denied.json() == {"detail": "not_found"}
    with pytest.raises(MaterialError) as denied:
        AnalyticSections(runtime_database).write(
            other, scope, uuid4(), AnalyticSectionData.model_validate(section_body())
        )
    assert denied.value.status == 404
    with pytest.raises(MaterialError) as denied:
        Plannings(runtime_database).derive(
            other,
            other_scope,
            uuid4(),
            UUID(section),
            1,
            DerivePlanningRequest.model_validate(derive_body()),
        )
    assert denied.value.status == 404


@pytest.mark.parametrize("kind", ["create", "derive"])
@pytest.mark.parametrize("replay", [False, True])
def test_real_session_csrf_and_revocation_rechecked_inside_section_operation(
    auth_factory, monkeypatch, kind, replay
):
    import aulalista_api.auth as authentication

    instant = authentication.now()
    monkeypatch.setattr(authentication, "now", lambda: instant)
    factory, sender = auth_factory
    reached, release = threading.Event(), threading.Event()
    service, method = (
        (Plannings, "derive") if kind == "derive" else (AnalyticSections, "write")
    )
    original_method = getattr(service, method)
    key = uuid4()

    def delayed(*args, **kwargs):
        reached.set()
        assert release.wait(timeout=10)
        return original_method(*args, **kwargs)

    with factory() as client, factory() as concurrent:
        session = login(client, sender)
        scope = session["scope_id"]
        headers = {
            "Origin": ORIGIN,
            "X-CSRF-Token": session["csrf_token"],
            "Idempotency-Key": str(key),
        }
        path = f"/scopes/{scope}/analytic-sections"
        body = section_body()
        if kind == "derive":
            section = client.post(
                path, json=body, headers={**headers, "Idempotency-Key": str(uuid4())}
            )
            assert section.status_code == 201
            path += f"/{section.json()['receipt']['section_id']}/revisions/1/plannings"
            body = derive_body()
        denied = client.post(
            path, json=body, headers={"Origin": ORIGIN, "Idempotency-Key": str(key)}
        )
        assert denied.status_code == 403
        saved = None
        if replay:
            saved = client.post(path, json=body, headers=headers)
            assert saved.status_code == 201
            saved = saved.json()
        concurrent.cookies.set(
            "__Host-acenta-session", client.cookies.get("__Host-acenta-session")
        )
        monkeypatch.setattr(service, method, delayed)
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(concurrent.post, path, json=body, headers=headers)
            try:
                assert reached.wait(timeout=5)
                assert client.post("/auth/logout", headers=headers).status_code == 204
            finally:
                release.set()
            denied = pending.result(timeout=10)
            assert denied.status_code == 401
            assert denied.headers["cache-control"] == "no-store"
    monkeypatch.setattr(service, method, original_method)
    instant += timedelta(seconds=61)
    with factory() as fresh:
        next_session = login(fresh, sender)
        assert next_session["scope_id"] == scope
        namespace = (
            "planning-operations" if kind == "derive" else "analytic-section-operations"
        )
        receipt = fresh.get(f"/scopes/{scope}/{namespace}/{key}")
        if replay:
            assert receipt.status_code == 200
            assert receipt.json() == saved
        else:
            assert receipt.status_code == 404
        catalog = "plannings" if kind == "derive" else "analytic-sections"
        assert fresh.get(f"/scopes/{scope}/{catalog}").json()["items"] == (
            [saved] if replay else []
        )


@pytest.mark.parametrize("kind", ["create", "edit", "derive"])
def test_lost_response_recovers_original_operation_without_duplicates(
    runtime_database, actors, monkeypatch, kind
):
    actor, scope = actors[0]
    key = uuid4()
    service, method = (
        (Plannings, "derive") if kind == "derive" else (AnalyticSections, "write")
    )
    original_method = getattr(service, method)
    with TestClient(actor_app(actor)) as client:
        section = (
            write(client, scope).json()["receipt"]["section_id"]
            if kind != "create"
            else None
        )

    def lose_response(*args, **kwargs):
        original_method(*args, **kwargs)
        raise ConnectionError("Synthetic response lost after commit")

    def submit(client):
        return (
            derive(client, scope, section, key=key)
            if kind == "derive"
            else write(
                client,
                scope,
                section_body(period="Periodo corregido"),
                key=key,
                section=section,
            )
        )

    monkeypatch.setattr(service, method, lose_response)
    with TestClient(actor_app(actor)) as client, pytest.raises(ConnectionError):
        submit(client)
    monkeypatch.setattr(service, method, original_method)
    with TestClient(actor_app(actor)) as client:
        namespace = (
            "planning-operations" if kind == "derive" else "analytic-section-operations"
        )
        saved = client.get(f"/scopes/{scope}/{namespace}/{key}")
        assert saved.status_code == 200
        assert submit(client).json() == saved.json()
        table = "planning_revision" if kind == "derive" else "analytic_section_revision"
        with runtime_database.connect() as connection:
            assert (
                connection.scalar(
                    text(f"SELECT count(*) FROM {table} WHERE operation_id=:key"),
                    {"key": key},
                )
                == 1
            )


@pytest.mark.parametrize("different", [False, True])
@pytest.mark.parametrize("kind", ["create", "derive"])
def test_same_operation_race_has_one_durable_result(
    runtime_database, actors, kind, different
):
    actor, scope = actors[0]
    key = uuid4()
    with TestClient(actor_app(actor)) as client:
        section = (
            write(client, scope).json()["receipt"]["section_id"]
            if kind == "derive"
            else None
        )
    apps = [actor_app(actor), actor_app(actor)]
    barrier, pids = threading.Barrier(2), set()

    def synchronize(conn, cursor, statement, parameters, context, executemany):
        pid = conn.connection.driver_connection.info.backend_pid
        if statement.startswith("SELECT pg_advisory_xact_lock") and pid not in pids:
            pids.add(pid)
            barrier.wait(timeout=5)

    event.listen(Engine, "before_cursor_execute", synchronize)
    try:

        def contender(index):
            with TestClient(apps[index]) as client:
                if kind == "derive":
                    return derive(
                        client,
                        scope,
                        section,
                        key=key,
                        body=derive_body(
                            duration_minutes=30 if index and different else 50
                        ),
                    )
                return write(
                    client,
                    scope,
                    section_body(period=f"Periodo {index if different else 0}"),
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
        table = "planning_revision" if kind == "derive" else "analytic_section_revision"
        assert (
            connection.scalar(
                text(f"SELECT count(*) FROM {table} WHERE operation_id=:key"),
                {"key": key},
            )
            == 1
        )


def test_two_section_editors_cas_has_one_winner(runtime_database, actors):
    actor, scope = actors[0]
    with TestClient(actor_app(actor)) as client:
        original = write(client, scope).json()
    section = original["receipt"]["section_id"]
    apps = [actor_app(actor), actor_app(actor)]
    barrier, pids = threading.Barrier(2), set()

    def synchronize(conn, cursor, statement, parameters, context, executemany):
        pid = conn.connection.driver_connection.info.backend_pid
        if statement.startswith("SELECT pg_advisory_xact_lock") and pid not in pids:
            pids.add(pid)
            barrier.wait(timeout=5)

    event.listen(Engine, "before_cursor_execute", synchronize)
    try:

        def contender(index):
            with TestClient(apps[index]) as client:
                return write(
                    client,
                    scope,
                    section_body(period=f"Editor {index}"),
                    section=section,
                )

        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(contender, [0, 1]))
    finally:
        event.remove(Engine, "before_cursor_execute", synchronize)
    assert len(pids) == 2
    assert sorted(r.status_code for r in responses) == [201, 409]
    winner = next(r.json() for r in responses if r.status_code == 201)
    with TestClient(actor_app(actor)) as client:
        assert (
            client.get(f"/scopes/{scope}/analytic-sections/{section}").json() == winner
        )
        assert (
            client.get(
                f"/scopes/{scope}/analytic-sections/{section}/revisions/1"
            ).json()
            == original
        )


@pytest.mark.parametrize("kind", ["create", "edit", "derive"])
def test_commit_failure_rolls_back_entire_operation(
    runtime_database, migrated_database, actors, kind
):
    actor, scope = actors[0]
    key = uuid4()
    with TestClient(actor_app(actor)) as client:
        original = write(client, scope).json() if kind != "create" else None
        section = original["receipt"]["section_id"] if original else None
        table = "planning_revision" if kind == "derive" else "analytic_section_revision"
        with migrated_database.begin() as connection:
            connection.execute(
                text(f"""
                CREATE FUNCTION fail_section_commit() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'synthetic failure' USING ERRCODE = '23514'; END; $$;
                CREATE CONSTRAINT TRIGGER fail_section_commit AFTER INSERT ON {table}
                DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_section_commit()
            """)
            )
        failed = (
            derive(client, scope, section, key=key)
            if kind == "derive"
            else write(
                client,
                scope,
                section_body(period="Periodo corregido"),
                key=key,
                section=section,
            )
        )
        assert failed.status_code == 503
        assert failed.json() == {"detail": "unavailable"}
        namespace = (
            "planning-operations" if kind == "derive" else "analytic-section-operations"
        )
        assert client.get(f"/scopes/{scope}/{namespace}/{key}").status_code == 404
        assert client.get(f"/scopes/{scope}/analytic-sections").json()["items"] == (
            [original] if original else []
        )
        assert client.get(f"/scopes/{scope}/plannings").json()["items"] == []
        with migrated_database.begin() as connection:
            connection.execute(
                text(
                    f"DROP TRIGGER fail_section_commit ON {table}; DROP FUNCTION fail_section_commit()"
                )
            )
        retried = (
            derive(client, scope, section, key=key)
            if kind == "derive"
            else write(
                client,
                scope,
                section_body(period="Periodo corregido"),
                key=key,
                section=section,
            )
        )
        assert retried.status_code == 201


def test_section_history_is_immutable_for_owner_and_runtime(
    runtime_database, migrated_database, actors
):
    actor, scope = actors[0]
    with TestClient(actor_app(actor)) as client:
        assert write(client, scope).status_code == 201
    for engine, sqlstate in [(runtime_database, "42501"), (migrated_database, "23514")]:
        for mutation in [
            "UPDATE analytic_section_revision SET number=number",
            "DELETE FROM analytic_section_revision",
            "TRUNCATE analytic_section_revision, planning_revision, planning_draft_revision, planning_generation_attempt",
        ]:
            with pytest.raises(DBAPIError) as rejected, engine.begin() as connection:
                connection.execute(text(mutation))
            assert rejected.value.orig.sqlstate == sqlstate


def test_transport_bounds_and_full_unicode_manual_data(runtime_database, actors):
    actor, scope = actors[0]
    with TestClient(actor_app(actor)) as client:
        base = f"/scopes/{scope}/analytic-sections"
        for content, media, status in [
            (b"x" * 8193, "application/json", 413),
            (b"{", "application/json", 422),
            (b"{}", "text/plain", 415),
        ]:
            denied = client.post(
                base,
                content=content,
                headers={"Content-Type": media, "Idempotency-Key": str(uuid4())},
            )
            assert denied.status_code == status
            assert denied.headers["cache-control"] == "no-store"
        body = section_body(situation="🧪" * 1000)
        saved = client.post(
            base,
            content=json.dumps(body, ensure_ascii=False).encode(),
            headers={
                "Content-Type": "application/json",
                "Idempotency-Key": str(uuid4()),
            },
        )
        assert saved.status_code == 201
        assert saved.json()["data"] == body


def canonical_body(body):
    return json.dumps(
        body, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode()


def section_with_exact_size(size, period="Periodo A"):
    data = section_body(
        period=period, entries=[{"content": "c", "pda": "p"} for _ in range(8)]
    )
    remaining = size - len(canonical_body(data))
    for entry in data["entries"]:
        for field in ("content", "pda"):
            added = min(remaining, 499)
            entry[field] += "x" * added
            remaining -= added
    assert remaining == 0
    assert len(canonical_body(data)) == size
    return data


def test_largest_saved_section_stays_editable_and_excess_preserves_history(
    runtime_database, actors
):
    actor, scope = actors[0]
    base = f"/scopes/{scope}/analytic-sections"
    with TestClient(actor_app(actor)) as client:

        def post(path, body, key=None):
            return client.post(
                path,
                content=canonical_body(body),
                headers={
                    "Content-Type": "application/json",
                    "Idempotency-Key": str(key or uuid4()),
                },
            )

        too_large_key = uuid4()
        denied = post(base, section_with_exact_size(8001), too_large_key)
        assert denied.status_code == 413
        assert operation(client, scope, too_large_key).status_code == 404
        assert client.get(base).json()["items"] == []
        data = section_with_exact_size(8000)
        original = post(base, data)
        assert original.status_code == 201
        original = original.json()
        assert original["data"] == data
        path = f"{base}/{original['receipt']['section_id']}/revisions"
        too_large_edit_key = uuid4()
        denied = post(
            path,
            {
                "contract_version": 1,
                "expected_revision": 1,
                "data": section_with_exact_size(8001, "Periodo B"),
            },
            too_large_edit_key,
        )
        assert denied.status_code == 413
        assert operation(client, scope, too_large_edit_key).status_code == 404
        assert client.get(base).json()["items"] == [original]
        data = section_with_exact_size(8000, "Periodo B")
        revised = post(
            path, {"contract_version": 1, "expected_revision": 1, "data": data}
        )
        assert revised.status_code == 201
        assert revised.json()["data"] == data
        assert revised.json()["receipt"]["revision"] == 2
        assert client.get(path + "/1").json() == original


def test_database_rejects_cross_scope_sections_sources_and_derived_origins(
    runtime_database, migrated_database, actors
):
    (actor, scope), (other, other_scope) = actors
    with TestClient(actor_app(actor)) as client:
        own = write(client, scope).json()
        planning = derive(client, scope, own["receipt"]["section_id"]).json()
    with TestClient(actor_app(other)) as client:
        foreign_source = create(client, other_scope, FIXTURE_SOURCE).json()
        foreign = write(client, other_scope).json()
    for section, source in [
        (foreign["receipt"]["section_id"], None),
        (own["receipt"]["section_id"], foreign_source["version_id"]),
    ]:
        with pytest.raises(IntegrityError), migrated_database.begin() as connection:
            connection.execute(
                text("""
                INSERT INTO analytic_section_revision
                    (id, section_id, scope_id, number, source_version_id, actor_id,
                     operation_id, request_fingerprint, data)
                SELECT :id, :section, scope_id, 2, :source, actor_id, :key,
                    request_fingerprint, data FROM analytic_section_revision WHERE id=:base
            """),
                {
                    "id": uuid4(),
                    "section": UUID(section),
                    "source": UUID(source) if source else None,
                    "key": uuid4(),
                    "base": UUID(own["receipt"]["revision_id"]),
                },
            )
    with pytest.raises(IntegrityError), migrated_database.begin() as connection:
        connection.execute(
            text("""
            INSERT INTO planning_revision
                (id, planning_id, scope_id, number, source_version_id, actor_id,
                 operation_id, request_fingerprint, request, result, analytic_revision_id)
            SELECT :id, planning_id, scope_id, 2, source_version_id, actor_id, :key,
                request_fingerprint, request, result, :foreign FROM planning_revision WHERE id=:base
        """),
            {
                "id": uuid4(),
                "key": uuid4(),
                "foreign": UUID(foreign["receipt"]["revision_id"]),
                "base": UUID(planning["receipt"]["revision_id"]),
            },
        )


def test_database_rejects_replaced_analytic_origin_and_mismatched_reference(
    runtime_database, migrated_database, actors
):
    actor, scope = actors[0]
    with TestClient(actor_app(actor)) as client:
        section = write(client, scope).json()
        other = write(client, scope).json()
        planning = derive(client, scope, section["receipt"]["section_id"]).json()
        source = create(client, scope, FIXTURE_SOURCE).json()
    for analytic, source_version, origin in [
        (other["receipt"]["revision_id"], None, planning["receipt"]["revision_id"]),
        (section["receipt"]["revision_id"], source["version_id"], None),
    ]:
        with pytest.raises(IntegrityError), migrated_database.begin() as connection:
            connection.execute(
                text("""
                INSERT INTO planning_revision
                    (id, planning_id, scope_id, number, source_version_id, actor_id,
                     operation_id, request_fingerprint, request, result,
                     analytic_revision_id, origin_revision_id)
                SELECT :id, planning_id, scope_id, 2, :source, actor_id, :key,
                    request_fingerprint, request, result, :analytic, :origin
                FROM planning_revision WHERE id=:base
            """),
                {
                    "id": uuid4(),
                    "key": uuid4(),
                    "analytic": UUID(analytic),
                    "source": UUID(source_version) if source_version else None,
                    "origin": UUID(origin) if origin else None,
                    "base": UUID(planning["receipt"]["revision_id"]),
                },
            )


def test_service_and_database_bound_manual_data_without_partial_history(
    runtime_database, migrated_database, actors
):
    actor, scope = actors[0]
    oversized = section_body(entries=[{"content": "🧪" * 500, "pda": "🧪" * 500}] * 8)
    with pytest.raises(MaterialError) as denied:
        AnalyticSections(runtime_database).write(
            actor, scope, uuid4(), AnalyticSectionData.model_validate(oversized)
        )
    assert denied.value.status == 413
    with TestClient(actor_app(actor)) as client:
        assert client.get(f"/scopes/{scope}/analytic-sections").json()["items"] == []
        saved = write(client, scope).json()
    with pytest.raises(IntegrityError), migrated_database.begin() as connection:
        connection.execute(
            text("""
            INSERT INTO analytic_section_revision
                (id, section_id, scope_id, number, source_version_id, actor_id,
                 operation_id, request_fingerprint, data)
            SELECT :id, section_id, scope_id, 2, source_version_id, actor_id, :key,
                request_fingerprint, CAST(:data AS jsonb)
            FROM analytic_section_revision WHERE id=:base
        """),
            {
                "id": uuid4(),
                "key": uuid4(),
                "data": json.dumps(oversized),
                "base": UUID(saved["receipt"]["revision_id"]),
            },
        )


@pytest.mark.parametrize("retained", [False, True])
def test_migration_roundtrip_or_safe_refusal_preserves_confirmed_history(
    runtime_database, migrated_database, actors, monkeypatch, retained
):
    actor, scope = actors[0]
    with TestClient(actor_app(actor)) as client:
        saved = write(client, scope).json() if retained else None
    monkeypatch.setenv(
        "AULALISTA_DATABASE_URL",
        migrated_database.url.render_as_string(hide_password=False),
    )
    if retained:
        with pytest.raises(IntegrityError):
            command.downgrade(Config("alembic.ini"), "0007_guided_planning")
        with migrated_database.connect() as connection:
            assert (
                connection.scalar(text("SELECT version_num FROM alembic_version"))
                == SCHEMA_REVISION
            )
    else:
        command.downgrade(Config("alembic.ini"), "0007_guided_planning")
        command.upgrade(Config("alembic.ini"), "head")
    command.check(Config("alembic.ini"))
    monkeypatch.setenv(
        "AULALISTA_DATABASE_URL",
        runtime_database.url.render_as_string(hide_password=False),
    )
    if retained:
        with TestClient(actor_app(actor)) as client:
            assert (
                client.get(
                    f"/scopes/{scope}/analytic-sections/{saved['receipt']['section_id']}"
                ).json()
                == saved
            )
