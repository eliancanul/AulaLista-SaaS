import json
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import text
from test_materials import actor_app, append, create
from test_plannings import submit
from test_water_fixture import water_request

from aulalista_api.app import create_app
from aulalista_api.materials import MaterialError
from aulalista_api.planning_edits import (
    DraftRequest,
    EditRequest,
    PlanningEdits,
    fingerprint,
)
from aulalista_api.water_fixture import FIXTURE_SOURCE


def seed(client, scope):
    source = create(client, scope, FIXTURE_SOURCE).json()
    response = submit(client, scope, water_request(source), uuid4())
    assert response.status_code == 201
    return response.json()


def body(
    kind="edit",
    value="Describe el vaso con tus propias palabras.",
    base=1,
    draft_revision=0,
):
    payload = {
        "contract_version": 1,
        "resource_key": "observation-sheet",
        "element_key": "instruction",
        "text": value,
    }
    payload["expected_revision" if kind == "edit" else "base_revision"] = base
    if kind == "draft":
        payload["expected_draft_revision"] = draft_revision
    return payload


def write(
    client, scope, planning_id, kind="edit", *, payload=None, key=None, draft_id=None
):
    path = f"/scopes/{scope}/plannings/{planning_id}"
    if kind == "draft":
        method, path = client.put, path + f"/drafts/{draft_id}"
    else:
        method, path = (
            client.post,
            path + ("/copies" if kind == "copy" else "/revisions"),
        )
    return method(
        path,
        json=payload or body(kind),
        headers={"Idempotency-Key": str(key or uuid4())},
    )


def value(document):
    return document["result"]["resources"][0]["elements"][0]["text"]


def operation(client, scope, key, kind="edit"):
    namespace = (
        "planning-draft-operations" if kind == "draft" else "planning-operations"
    )
    return client.get(f"/scopes/{scope}/{namespace}/{key}")


@pytest.mark.parametrize(
    "change",
    [
        {"contract_version": True},
        {"contract_version": 2},
        {"expected_revision": True},
        {"expected_revision": 0},
        {"expected_revision": "1"},
        {"expected_revision": 2_147_483_647},
        {"text": ""},
        {"text": " "},
        {"text": "x" * 1001},
        {"text": "nul\0"},
        {"text": "\ud800"},
        {"text": 12},
        {"resource_key": ""},
        {"element_key": "x" * 65},
        {"actor_id": str(uuid4())},
        {"result": {"editable": True}},
        {"initial_request": {"prompt": "invented"}},
    ],
)
def test_edit_request_is_strict_and_text_safe(change):
    with pytest.raises(ValidationError):
        EditRequest.model_validate(dict(body(), **change))


def test_operation_fingerprint_binds_kind_target_base_and_full_payload():
    planning, other, draft = uuid4(), uuid4(), uuid4()
    request = EditRequest.model_validate(body(value="á 🧪"))
    original = fingerprint("edit", planning, request)
    assert original == fingerprint(
        "edit", planning, EditRequest.model_validate(body(value="á 🧪"))
    )
    assert (
        len(
            {
                original,
                fingerprint("copy", planning, request),
                fingerprint("edit", other, request),
                fingerprint(
                    "edit", planning, EditRequest.model_validate(body(value="á 🧪 "))
                ),
                fingerprint(
                    "edit",
                    planning,
                    EditRequest.model_validate(body(value="á 🧪", base=2)),
                ),
                fingerprint("edit", planning, request, draft),
            }
        )
        == 6
    )


def test_all_edit_routes_fail_closed_without_identity():
    scope, planning, draft = uuid4(), uuid4(), uuid4()
    with TestClient(create_app()) as client:
        client.headers.update(
            {"X-Actor-Id": str(uuid4()), "Authorization": "Bearer invented"}
        )
        for kind in ["edit", "copy", "draft"]:
            denied = write(client, scope, planning, kind, draft_id=draft)
            assert denied.status_code == 401
            assert denied.headers["cache-control"] == "no-store"
        for path in [
            f"plannings/{planning}/revisions/1",
            f"planning-drafts/{draft}",
            f"planning-draft-operations/{uuid4()}",
            "plannings",
            "planning-drafts",
        ]:
            assert client.get(f"/scopes/{scope}/{path}").status_code == 401


def test_edit_is_durable_exact_history_and_old_receipts_survive(
    runtime_database, actors, monkeypatch
):
    import aulalista_api.plannings as generator

    actor, scope = actors[0]
    key = uuid4()
    with TestClient(actor_app(actor)) as client:
        original = seed(client, scope)
        planning = original["receipt"]["planning_id"]
        assert (
            append(client, scope, original["receipt"]["source_id"]).status_code == 201
        )
        response = write(client, scope, planning, key=key)
        assert response.status_code == 201
        saved = response.json()
        assert response.headers["cache-control"] == "no-store"
        assert saved["receipt"]["revision"] == 2
        assert (
            saved["receipt"]["source_version_id"]
            == original["receipt"]["source_version_id"]
        )
        assert value(saved) == body()["text"]
        assert saved["initial_request"] == original["request"]
        unchanged = saved["result"]["resources"][0]["elements"][1]
        assert unchanged == original["result"]["resources"][0]["elements"][1]

    def never_generate(*args):
        raise AssertionError("Reading/editing cannot regenerate a fixture")

    monkeypatch.setattr(generator, "generate", never_generate)
    with TestClient(actor_app(actor)) as client:
        assert client.get(f"/scopes/{scope}/plannings/{planning}").json() == saved
        assert (
            client.get(f"/scopes/{scope}/plannings/{planning}/revisions/1").json()
            == original
        )
        assert (
            operation(client, scope, original["receipt"]["operation_id"]).json()
            == original
        )
        assert operation(client, scope, key).json() == saved
        assert write(client, scope, planning, key=key).json() == saved
        assert (
            write(
                client, scope, planning, key=key, payload=body(value="Different")
            ).status_code
            == 409
        )
        assert write(client, scope, planning).status_code == 409
        assert (
            write(
                client, scope, planning, payload=body(value=value(original))
            ).status_code
            == 409
        )
        assert write(client, scope, planning, payload=body(base=2)).status_code == 422
        assert (
            client.get(
                f"/scopes/{scope}/sources/{original['receipt']['source_id']}/versions/1"
            ).content
            == FIXTURE_SOURCE
        )


@pytest.mark.parametrize("kind", ["edit", "copy", "draft"])
def test_unsupported_targets_cannot_change_readonly_or_create_arbitrary_fields(
    runtime_database, actors, kind
):
    actor, scope = actors[0]
    with TestClient(actor_app(actor)) as client:
        planning = seed(client, scope)["receipt"]["planning_id"]
        for changes in [
            {"element_key": "question"},
            {"resource_key": "invented"},
            {"element_key": "invented"},
        ]:
            response = write(
                client,
                scope,
                planning,
                kind,
                payload=dict(body(kind), **changes),
                draft_id=uuid4(),
            )
            assert response.status_code == 422
            assert response.json() == {"detail": "unsupported_target"}
        assert (
            client.get(f"/scopes/{scope}/plannings/{planning}").json()["receipt"][
                "revision"
            ]
            == 1
        )


def test_edit_copy_keys_share_namespace_without_cross_operation_replay(
    runtime_database, actors
):
    actor, scope = actors[0]
    with TestClient(actor_app(actor)) as client:
        original = seed(client, scope)
        planning = original["receipt"]["planning_id"]
        create_key = original["receipt"]["operation_id"]
        assert write(client, scope, planning, key=create_key).status_code == 409
        edit_key = uuid4()
        saved = write(client, scope, planning, key=edit_key).json()
        assert write(client, scope, planning, "copy", key=edit_key).status_code == 409
        assert submit(client, scope, original["request"], edit_key).status_code == 409
        assert operation(client, scope, edit_key).json() == saved
        # Drafts have a separate explicit namespace; its receipt cannot impersonate an edit.
        draft = write(
            client, scope, planning, "draft", key=edit_key, draft_id=uuid4()
        ).json()
        assert operation(client, scope, edit_key, "draft").json() == draft
        assert operation(client, scope, edit_key).json() == saved


def test_versioned_draft_survives_restart_with_old_base_and_never_publishes(
    runtime_database, actors
):
    actor, scope = actors[0]
    draft_id, key = uuid4(), uuid4()
    with TestClient(actor_app(actor)) as client:
        original = seed(client, scope)
        planning = original["receipt"]["planning_id"]
        current = write(client, scope, planning, payload=body(value="Publicado")).json()
        response = write(client, scope, planning, "draft", key=key, draft_id=draft_id)
        assert response.status_code == 201
        draft = response.json()
        assert draft["receipt"]["base_revision"] == 1
        assert (
            draft["receipt"]["base_revision_id"] == original["receipt"]["revision_id"]
        )
        assert draft["receipt"]["draft_revision"] == 1
        assert draft["initial_request"] == original["request"]
    with TestClient(actor_app(actor)) as client:
        assert client.get(f"/scopes/{scope}/planning-drafts/{draft_id}").json() == draft
        assert client.get(f"/scopes/{scope}/planning-drafts").json() == {
            "items": [draft],
            "next_cursor": None,
        }
        assert operation(client, scope, key, "draft").json() == draft
        assert (
            write(client, scope, planning, "draft", key=key, draft_id=draft_id).json()
            == draft
        )
        assert client.get(f"/scopes/{scope}/plannings/{planning}").json() == current
        assert (
            write(client, scope, planning, "draft", draft_id=draft_id).status_code
            == 409
        )
        second_payload = body("draft", value="Otro borrador", draft_revision=1)
        second = write(
            client, scope, planning, "draft", payload=second_payload, draft_id=draft_id
        ).json()
        assert second["receipt"]["draft_revision"] == 2
        assert value(second) == "Otro borrador"
        assert operation(client, scope, key, "draft").json() == draft
        assert (
            write(client, scope, planning, "draft", key=key, draft_id=draft_id).json()
            == draft
        )
        assert (
            client.get(f"/scopes/{scope}/planning-drafts/{draft_id}").json() == second
        )


def test_conflict_copy_is_independent_idempotent_and_keeps_exact_origin(
    runtime_database, actors
):
    actor, scope = actors[0]
    key = uuid4()
    with TestClient(actor_app(actor)) as client:
        original = seed(client, scope)
        planning = original["receipt"]["planning_id"]
        current = write(
            client, scope, planning, payload=body(value="Otra pestaña")
        ).json()
        assert write(client, scope, planning).status_code == 409
        response = write(client, scope, planning, "copy", key=key)
        assert response.status_code == 201
        copy = response.json()
        copy_id = copy["receipt"]["planning_id"]
        assert copy_id != planning
        assert copy["origin"] == {
            "planning_id": planning,
            "revision_id": original["receipt"]["revision_id"],
            "revision": 1,
        }
        assert copy["receipt"]["revision"] == 1
        assert copy["initial_request"] == original["request"]
        assert (
            copy["receipt"]["source_version_id"]
            == original["receipt"]["source_version_id"]
        )
    with TestClient(actor_app(actor)) as client:
        assert write(client, scope, planning, "copy", key=key).json() == copy
        assert operation(client, scope, key).json() == copy
        assert client.get(f"/scopes/{scope}/plannings/{planning}").json() == current
        items = client.get(f"/scopes/{scope}/plannings").json()["items"]
        assert {item["receipt"]["planning_id"] for item in items} == {planning, copy_id}
        edited = write(
            client, scope, copy_id, payload=body(value="Mi copia editada")
        ).json()
        assert edited["origin"] == copy["origin"]
        assert edited["initial_request"] == original["request"]
        assert operation(client, scope, key).json() == copy
        assert client.get(f"/scopes/{scope}/plannings/{planning}").json() == current


@pytest.mark.parametrize("kind", ["edit", "copy", "draft"])
def test_scope_and_missing_targets_are_uniform_in_http_and_service(
    runtime_database, actors, kind
):
    actor, scope = actors[0]
    other, other_scope = actors[1]
    key, draft_id = uuid4(), uuid4()
    with TestClient(actor_app(actor)) as client:
        original = seed(client, scope)
        planning = original["receipt"]["planning_id"]
        saved = write(client, scope, planning, kind, key=key, draft_id=draft_id)
        assert saved.status_code == 201
    with TestClient(actor_app(other)) as client:
        for requested_scope, requested_id in [
            (scope, planning),
            (other_scope, planning),
            (other_scope, uuid4()),
        ]:
            response = write(
                client, requested_scope, requested_id, kind, key=key, draft_id=draft_id
            )
            assert response.status_code == 404
            assert response.json() == {"detail": "not_found"}
        for requested_scope in [scope, other_scope]:
            assert operation(client, requested_scope, key, kind).status_code == 404
            assert (
                client.get(
                    f"/scopes/{requested_scope}/planning-drafts/{draft_id}"
                ).status_code
                == 404
            )
            assert (
                client.get(
                    f"/scopes/{requested_scope}/plannings/{planning}/revisions/1"
                ).status_code
                == 404
            )
        assert client.get(f"/scopes/{other_scope}/plannings").json()["items"] == []
        assert (
            client.get(f"/scopes/{other_scope}/planning-drafts").json()["items"] == []
        )
    service = PlanningEdits(runtime_database)
    with pytest.raises(MaterialError) as error:
        service.read_revision(other, scope, UUID(planning), 1)
    assert error.value.status == 404
    with pytest.raises(MaterialError) as error:
        service.preserve_draft(
            other,
            scope,
            UUID(planning),
            draft_id,
            key,
            DraftRequest.model_validate(body("draft")),
        )
    assert error.value.status == 404


def test_draft_id_cannot_move_to_another_planning_and_keys_bind_target(
    runtime_database, actors
):
    actor, scope = actors[0]
    draft_id, key = uuid4(), uuid4()
    with TestClient(actor_app(actor)) as client:
        first = seed(client, scope)["receipt"]["planning_id"]
        second = seed(client, scope)["receipt"]["planning_id"]
        assert (
            write(client, scope, first, "draft", key=key, draft_id=draft_id).status_code
            == 201
        )
        assert (
            write(
                client, scope, second, "draft", key=key, draft_id=draft_id
            ).status_code
            == 409
        )
        assert (
            write(client, scope, second, "draft", draft_id=draft_id).status_code == 404
        )
        assert (
            write(client, scope, first, "draft", key=key, draft_id=uuid4()).status_code
            == 409
        )
        assert (
            write(
                client,
                scope,
                first,
                "draft",
                key=key,
                draft_id=draft_id,
                payload=body("draft", value="changed"),
            ).status_code
            == 409
        )


def test_list_pagination_is_scoped_and_stable(runtime_database, actors):
    actor, scope = actors[0]
    with TestClient(actor_app(actor)) as client:
        originals = [seed(client, scope) for _ in range(3)]
        for item in originals:
            assert (
                write(
                    client,
                    scope,
                    item["receipt"]["planning_id"],
                    "draft",
                    draft_id=uuid4(),
                ).status_code
                == 201
            )
        for route, identity in [
            ("plannings", "planning_id"),
            ("planning-drafts", "draft_id"),
        ]:
            cursor, identities = None, []
            for _ in range(3):
                response = client.get(
                    f"/scopes/{scope}/{route}",
                    params={"limit": 1, **({"after": cursor} if cursor else {})},
                )
                assert response.status_code == 200
                assert response.headers["cache-control"] == "no-store"
                page = response.json()
                identities += [item["receipt"][identity] for item in page["items"]]
                cursor = page["next_cursor"]
            assert cursor is None
            assert len(set(identities)) == 3
            assert identities == sorted(identities)
            assert client.get(f"/scopes/{scope}/{route}?limit=0").status_code == 422
            assert client.get(f"/scopes/{scope}/{route}?limit=101").status_code == 422
            assert client.get(f"/scopes/{actors[1][1]}/{route}").status_code == 404


@pytest.mark.parametrize("kind", ["edit", "copy", "draft"])
def test_commit_failure_rolls_back_pointer_content_and_receipt(
    runtime_database, migrated_database, actors, kind
):
    actor, scope = actors[0]
    key, draft_id = uuid4(), uuid4()
    table = "planning_draft_revision" if kind == "draft" else "planning_revision"
    with TestClient(actor_app(actor)) as client:
        original = seed(client, scope)
        planning = original["receipt"]["planning_id"]
        with migrated_database.begin() as connection:
            connection.execute(
                text(f"""
                CREATE FUNCTION fail_b3_commit() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'synthetic failure' USING ERRCODE = '23514'; END; $$;
                CREATE CONSTRAINT TRIGGER fail_b3_commit AFTER INSERT ON {table}
                DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_b3_commit()
            """)
            )
        failed = write(client, scope, planning, kind, key=key, draft_id=draft_id)
        assert failed.status_code == 503
        assert failed.json() == {"detail": "unavailable"}
        assert failed.headers["cache-control"] == "no-store"
        assert operation(client, scope, key, kind).status_code == 404
        assert client.get(f"/scopes/{scope}/plannings/{planning}").json() == original
        assert len(client.get(f"/scopes/{scope}/plannings").json()["items"]) == 1
        assert client.get(f"/scopes/{scope}/planning-drafts").json()["items"] == []
        with migrated_database.begin() as connection:
            connection.execute(
                text(
                    f"DROP TRIGGER fail_b3_commit ON {table}; DROP FUNCTION fail_b3_commit()"
                )
            )
        retry = write(client, scope, planning, kind, key=key, draft_id=draft_id)
        assert retry.status_code == 201
        assert operation(client, scope, key, kind).json() == retry.json()


@pytest.mark.parametrize("kind", ["edit", "copy", "draft"])
def test_lost_response_after_commit_is_recovered_without_new_operation(
    runtime_database, actors, monkeypatch, kind
):
    actor, scope = actors[0]
    key, draft_id = uuid4(), uuid4()
    method = "preserve_draft" if kind == "draft" else "write"
    original_method = getattr(PlanningEdits, method)

    def lose_response(*args, **kwargs):
        original_method(*args, **kwargs)
        raise ConnectionError("Synthetic response lost after commit")

    with TestClient(actor_app(actor)) as client:
        planning = seed(client, scope)["receipt"]["planning_id"]
        monkeypatch.setattr(PlanningEdits, method, lose_response)
        with pytest.raises(ConnectionError):
            write(client, scope, planning, kind, key=key, draft_id=draft_id)
        monkeypatch.setattr(PlanningEdits, method, original_method)
    with TestClient(actor_app(actor)) as client:
        saved = operation(client, scope, key, kind)
        assert saved.status_code == 200
        assert (
            write(client, scope, planning, kind, key=key, draft_id=draft_id).json()
            == saved.json()
        )


@pytest.mark.parametrize("kind", ["edit", "copy", "draft"])
@pytest.mark.parametrize("different", [False, True])
def test_same_operation_race_uses_distinct_connections(
    runtime_database, actors, kind, different
):
    import threading
    from concurrent.futures import ThreadPoolExecutor

    from sqlalchemy import event
    from sqlalchemy.engine import Engine

    actor, scope = actors[0]
    key, draft_id = uuid4(), uuid4()
    with TestClient(actor_app(actor)) as client:
        planning = seed(client, scope)["receipt"]["planning_id"]
        if kind == "copy":
            assert write(client, scope, planning).status_code == 201
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
                payload = body(kind, value=f"Text {index if different else 0}")
                return write(
                    client,
                    scope,
                    planning,
                    kind,
                    key=key,
                    draft_id=draft_id,
                    payload=payload,
                )

        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(contender, [0, 1]))
    finally:
        event.remove(Engine, "before_cursor_execute", synchronize)
    assert len(pids) == 2
    assert sorted(response.status_code for response in responses) == (
        [201, 409] if different else [201, 201]
    )
    if not different:
        assert responses[0].json() == responses[1].json()
    with runtime_database.connect() as connection:
        table = "planning_draft_revision" if kind == "draft" else "planning_revision"
        assert (
            connection.scalar(
                text(f"SELECT count(*) FROM {table} WHERE operation_id=:key"),
                {"key": key},
            )
            == 1
        )


@pytest.mark.parametrize("kind", ["edit", "draft"])
@pytest.mark.parametrize("existing_draft", [False, True])
def test_distinct_keys_cas_only_one_connection_wins(
    runtime_database, actors, kind, existing_draft
):
    import threading
    from concurrent.futures import ThreadPoolExecutor

    from sqlalchemy import event
    from sqlalchemy.engine import Engine

    actor, scope = actors[0]
    draft_id = uuid4()
    with TestClient(actor_app(actor)) as client:
        planning = seed(client, scope)["receipt"]["planning_id"]
        if kind == "draft" and existing_draft:
            assert (
                write(client, scope, planning, kind, draft_id=draft_id).status_code
                == 201
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
                return write(
                    client,
                    scope,
                    planning,
                    kind,
                    draft_id=draft_id,
                    payload=body(
                        kind, value=f"Tab {index}", draft_revision=int(existing_draft)
                    ),
                )

        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(contender, [0, 1]))
    finally:
        event.remove(Engine, "before_cursor_execute", synchronize)
    assert len(pids) == 2
    assert sorted(response.status_code for response in responses) == [201, 409]


@pytest.mark.parametrize("table", ["planning_revision", "planning_draft_revision"])
def test_runtime_and_owner_cannot_rewrite_confirmed_history(
    runtime_database, migrated_database, actors, table
):
    from sqlalchemy.exc import DBAPIError

    actor, scope = actors[0]
    with TestClient(actor_app(actor)) as client:
        planning = seed(client, scope)["receipt"]["planning_id"]
        assert write(client, scope, planning).status_code == 201
        assert (
            write(client, scope, planning, "draft", draft_id=uuid4()).status_code == 201
        )
    for engine in [runtime_database, migrated_database]:
        for mutation in [
            f"UPDATE {table} SET number=number",
            f"DELETE FROM {table}",
            f"TRUNCATE {table}",
        ]:
            with pytest.raises(DBAPIError), engine.begin() as connection:
                connection.execute(text(mutation))
    with pytest.raises(DBAPIError), runtime_database.begin() as connection:
        connection.execute(text("UPDATE planning_draft SET planning_id=planning_id"))


def test_foreign_origin_and_cross_target_draft_base_fail_database_constraints(
    runtime_database, migrated_database, actors
):
    from sqlalchemy.exc import IntegrityError

    actor, scope = actors[0]
    with TestClient(actor_app(actor)) as client:
        own = seed(client, scope)
        another = seed(client, scope)
        draft = write(
            client, scope, own["receipt"]["planning_id"], "draft", draft_id=uuid4()
        ).json()
    with TestClient(actor_app(actors[1][0])) as client:
        foreign = seed(client, actors[1][1])
    for invalid in [another, foreign]:
        with pytest.raises(IntegrityError), migrated_database.begin() as connection:
            connection.execute(
                text("""
            INSERT INTO planning_revision (id, planning_id, scope_id, number, source_version_id, actor_id,
                operation_id, request_fingerprint, request, result, origin_revision_id)
            SELECT :id, planning_id, scope_id, 2, source_version_id, actor_id, :key,
                request_fingerprint, request, result, :foreign FROM planning_revision WHERE id=:base
        """),
                {
                    "id": uuid4(),
                    "key": uuid4(),
                    "foreign": UUID(invalid["receipt"]["revision_id"]),
                    "base": UUID(own["receipt"]["revision_id"]),
                },
            )
    for invalid in [another, foreign]:
        with pytest.raises(IntegrityError), migrated_database.begin() as connection:
            connection.execute(
                text("""
                INSERT INTO planning_draft_revision (id, draft_id, planning_id, scope_id, number,
                    base_revision_id, actor_id, operation_id, request_fingerprint, request, result)
                SELECT :id, draft_id, planning_id, scope_id, 2, :base, actor_id, :key,
                    request_fingerprint, request, result FROM planning_draft_revision WHERE id=:draft
            """),
                {
                    "id": uuid4(),
                    "key": uuid4(),
                    "base": UUID(invalid["receipt"]["revision_id"]),
                    "draft": UUID(draft["receipt"]["revision_id"]),
                },
            )


def test_transport_bounds_and_max_unicode_text_are_supported(runtime_database, actors):
    actor, scope = actors[0]
    with TestClient(actor_app(actor)) as client:
        planning = seed(client, scope)["receipt"]["planning_id"]
        path = f"/scopes/{scope}/plannings/{planning}/revisions"
        for content, media, expected in [
            (b"x" * 8193, "application/json", 413),
            (b"{", "application/json", 422),
            (b"{}", "text/plain", 415),
        ]:
            assert (
                client.post(
                    path,
                    content=content,
                    headers={"Content-Type": media, "Idempotency-Key": str(uuid4())},
                ).status_code
                == expected
            )
        payload = body(value="🧪" * 1000)
        content = json.dumps(payload, ensure_ascii=False).encode()
        response = client.post(
            path,
            content=content,
            headers={
                "Content-Type": "application/json",
                "Idempotency-Key": str(uuid4()),
            },
        )
        assert response.status_code == 201
        assert value(response.json()) == payload["text"]


def test_b3_migration_keeps_existing_b2_history(
    runtime_database, migrated_database, actors, monkeypatch
):
    from alembic import command
    from alembic.config import Config

    actor, scope = actors[0]
    with TestClient(actor_app(actor)) as client:
        original = seed(client, scope)
    monkeypatch.setenv(
        "AULALISTA_DATABASE_URL",
        migrated_database.url.render_as_string(hide_password=False),
    )
    command.downgrade(Config("alembic.ini"), "0003_planning_fixture")
    with migrated_database.connect() as connection:
        assert connection.scalar(text("SELECT count(*) FROM planning_revision")) == 1
        assert (
            connection.scalar(text("SELECT content FROM source_version"))
            == FIXTURE_SOURCE
        )
    command.upgrade(Config("alembic.ini"), "head")
    command.check(Config("alembic.ini"))
    # Downgrade removed the tables and their grants; migration deliberately does
    # not provision runtime roles. Regrant the new origin read before serving.
    with migrated_database.begin() as connection:
        connection.execute(
            text("GRANT SELECT ON analytic_section_revision TO aulalista_runtime")
        )
    monkeypatch.setenv(
        "AULALISTA_DATABASE_URL",
        runtime_database.url.render_as_string(hide_password=False),
    )
    with TestClient(actor_app(actor)) as client:
        assert (
            operation(client, scope, original["receipt"]["operation_id"]).json()
            == original
        )


@pytest.mark.parametrize("kind", ["edit", "copy", "draft"])
def test_receipt_can_be_missing_while_transaction_is_still_pending(
    runtime_database, actors, kind
):
    import threading
    from concurrent.futures import ThreadPoolExecutor

    from sqlalchemy import event
    from sqlalchemy.engine import Engine

    actor, scope = actors[0]
    key, draft_id = uuid4(), uuid4()
    with TestClient(actor_app(actor)) as client:
        planning = seed(client, scope)["receipt"]["planning_id"]
    inserted, release = threading.Event(), threading.Event()
    table = "planning_draft_revision" if kind == "draft" else "planning_revision"

    def pause(conn, cursor, statement, parameters, context, executemany):
        if statement.startswith(f"INSERT INTO {table} "):
            inserted.set()
            assert release.wait(timeout=5)

    event.listen(Engine, "after_cursor_execute", pause)
    try:

        def submit_pending():
            with TestClient(actor_app(actor)) as client:
                return write(client, scope, planning, kind, key=key, draft_id=draft_id)

        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(submit_pending)
            try:
                assert inserted.wait(timeout=5)
                with TestClient(actor_app(actor)) as client:
                    missing = operation(client, scope, key, kind)
                    assert missing.status_code == 404
                    assert missing.headers["cache-control"] == "no-store"
                assert not pending.done()
            finally:
                release.set()
            saved = pending.result(timeout=5)
            assert saved.status_code == 201
    finally:
        release.set()
        event.remove(Engine, "after_cursor_execute", pause)
    with TestClient(actor_app(actor)) as client:
        confirmed = operation(client, scope, key, kind)
        assert confirmed.status_code == 200
        assert confirmed.headers["cache-control"] == "no-store"
        assert confirmed.json() == saved.json()
        assert (
            write(client, scope, planning, kind, key=key, draft_id=draft_id).json()
            == saved.json()
        )


def test_failed_draft_update_keeps_last_confirmed_working_copy(
    runtime_database, migrated_database, actors
):
    actor, scope = actors[0]
    draft_id, key = uuid4(), uuid4()
    with TestClient(actor_app(actor)) as client:
        planning = seed(client, scope)["receipt"]["planning_id"]
        original = write(client, scope, planning, "draft", draft_id=draft_id).json()
        with migrated_database.begin() as connection:
            connection.execute(
                text("""
                CREATE FUNCTION fail_draft_update() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'synthetic failure' USING ERRCODE = '23514'; END; $$;
                CREATE CONSTRAINT TRIGGER fail_draft_update AFTER INSERT ON planning_draft_revision
                DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_draft_update()
            """)
            )
        payload = body("draft", value="New local text", draft_revision=1)
        assert (
            write(
                client,
                scope,
                planning,
                "draft",
                key=key,
                draft_id=draft_id,
                payload=payload,
            ).status_code
            == 503
        )
        assert (
            client.get(f"/scopes/{scope}/planning-drafts/{draft_id}").json() == original
        )
        assert operation(client, scope, key, "draft").status_code == 404


@pytest.mark.parametrize("expected_revision", [1, 7])
def test_draft_update_hides_foreign_missing_and_wrong_target_identity(
    runtime_database, actors, expected_revision
):
    (actor_a, scope_a), (actor_b, scope_b) = actors
    foreign_id, own_id = uuid4(), uuid4()
    with TestClient(actor_app(actor_a)) as client:
        planning_a = seed(client, scope_a)["receipt"]["planning_id"]
        foreign = write(
            client, scope_a, planning_a, "draft", draft_id=foreign_id
        ).json()
    with TestClient(actor_app(actor_b)) as client:
        planning_b = seed(client, scope_b)["receipt"]["planning_id"]
        another_b = seed(client, scope_b)["receipt"]["planning_id"]
        own = write(client, scope_b, another_b, "draft", draft_id=own_id).json()
        payload = body("draft", draft_revision=expected_revision)
        for draft_id in [foreign_id, uuid4(), own_id]:
            denied = write(
                client, scope_b, planning_b, "draft", draft_id=draft_id, payload=payload
            )
            assert denied.status_code == 404
            assert denied.json() == {"detail": "not_found"}
            assert denied.headers["cache-control"] == "no-store"
            with pytest.raises(MaterialError) as error:
                PlanningEdits(runtime_database).preserve_draft(
                    actor_b,
                    scope_b,
                    UUID(planning_b),
                    draft_id,
                    uuid4(),
                    DraftRequest.model_validate(payload),
                )
            assert (error.value.status, error.value.detail) == (404, "not_found")
        conflict = write(
            client,
            scope_b,
            another_b,
            "draft",
            draft_id=own_id,
            payload=body("draft", draft_revision=7),
        )
        assert conflict.status_code == 409
        assert conflict.json() == {"detail": "conflict"}
        assert conflict.headers["cache-control"] == "no-store"
        assert client.get(f"/scopes/{scope_b}/planning-drafts/{own_id}").json() == own
        assert (
            write(client, scope_b, planning_b, "draft", draft_id=foreign_id).status_code
            == 404
        )
        assert (
            write(client, scope_b, planning_b, "draft", draft_id=uuid4()).status_code
            == 201
        )
    with TestClient(actor_app(actor_a)) as client:
        assert (
            client.get(f"/scopes/{scope_a}/planning-drafts/{foreign_id}").json()
            == foreign
        )


@pytest.mark.parametrize(
    "route", ["operations", "planning-operations", "planning-draft-operations"]
)
def test_missing_and_invalid_private_receipts_are_not_cacheable(
    runtime_database, actors, route
):
    actor, scope = actors[0]
    with TestClient(actor_app(actor)) as client:
        missing = client.get(f"/scopes/{scope}/{route}/{uuid4()}")
        assert missing.status_code == 404
        assert missing.json() == {"detail": "not_found"}
        assert missing.headers["cache-control"] == "no-store"
        invalid = client.get(f"/scopes/{scope}/{route}/invalid")
        assert invalid.status_code == 422
        assert invalid.headers["cache-control"] == "no-store"
