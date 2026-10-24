"""#98: real HTTP sessions on one recycled runtime PostgreSQL connection.

PYTEST_DONT_REWRITE: do not expand session cookies or CSRF arguments on failure.
"""

import json
import re
from dataclasses import dataclass, field
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.pool import QueuePool
from test_analytic_sections import derive_body, section_body
from test_auth_integration import ORIGIN, login
from test_auth_integration import auth_factory as auth_factory
from test_generated_contract import generated_body, provider_output
from test_guided_planning import guided_body
from test_guided_planning_integration import edit_body
from test_openai_chat import chat_response
from test_openai_planning import Transport, completed, reply
from test_pilot_composition import composed as composed
from test_pilot_composition import sign_in
from test_planning_edits import body as edit_request
from test_water_fixture import water_request
from test_window_generation import window_app

from aulalista_api.water_fixture import FIXTURE_SOURCE

PRIVATE_TABLES = (
    "source",
    "source_version",
    "planning",
    "planning_revision",
    "planning_draft",
    "planning_draft_revision",
    "analytic_section",
    "analytic_section_revision",
    "planning_generation_attempt",
    "ai_budget_reservation",
    "chat_conversation",
    "chat_turn",
    "chat_active_conversation",
    "chat_open_operation",
    "chat_context_revision",
)


def private_state(engine):
    # Static table names; auth idle timestamps legitimately change on admitted reads.
    with engine.connect() as connection:
        return {
            table: connection.execute(
                text(f"SELECT row_to_json(t)::text FROM {table} t ORDER BY 1")
            ).all()
            for table in PRIVATE_TABLES
        }


def denied(response, status=404):
    assert response.status_code == status
    assert response.json() == {
        "detail": "not_found" if status == 404 else "unauthorized"
    }
    assert response.headers["cache-control"] == "no-store"
    assert not any(
        header in response.headers
        for header in (
            "x-source-id",
            "x-version",
            "x-content-sha256",
            "x-content-size",
            "x-actor-id",
            "x-created-at",
            "x-operation-id",
            "etag",
        )
    )


@dataclass
class Scenario:
    owner: TestClient
    other: TestClient
    scope: str
    other_scope: str
    engine: object
    trace: list
    transport: Transport
    invalidation: str
    writes: list = field(default_factory=list)

    def call(self, client, method, path, *, scope=None, **kwargs):
        start = len(self.trace)
        response = client.request(
            method, f"/scopes/{scope or self.scope}/{path}", **kwargs
        )
        # Valid-session requests must actually execute against the tracked pool.
        if response.status_code != 401:
            assert len(self.trace) > start
        return response

    def save(self, path, *, payload=None, content=None, targeted=True, method="POST"):
        key = str(uuid4())
        kwargs = {"headers": {"Idempotency-Key": key}}
        if content is not None:
            kwargs["content"] = content
            kwargs["headers"]["Content-Type"] = "application/octet-stream"
        else:
            kwargs["json"] = payload
        response = self.call(self.owner, method, path, **kwargs)
        assert response.status_code == 201
        self.writes.append((method, path, kwargs, targeted, response.json()))
        return response.json(), key

    def cursor(self, path, identity, *, parameter="after", status=422):
        assert (
            self.call(
                self.owner, "GET", path, params={parameter: str(identity)}
            ).status_code
            == 200
        )
        for value in (str(identity), str(uuid4())):
            response = self.call(
                self.other,
                "GET",
                path,
                scope=self.other_scope,
                params={parameter: value},
            )
            assert response.status_code == status
            assert response.json() == (
                {"items": [], "next_cursor": None}
                if status == 200
                else {"detail": "not_found" if status == 404 else "invalid_request"}
            )
            assert response.headers["cache-control"] == "no-store"

    def verify(self, reads, listings):
        before = private_state(self.engine)
        calls = len(self.transport.calls)
        snapshots = []
        for path in reads:
            response = self.call(self.owner, "GET", path)
            assert response.status_code == 200
            snapshots.append(response.content)
            # Immediate A -> B on the SAME physical connection for every read.
            denied(self.call(self.other, "GET", path))
            denied(self.call(self.other, "GET", path, scope=self.other_scope))
            missing = re.sub(
                r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}",
                lambda _: str(uuid4()),
                path,
            )
            if missing != path:
                denied(self.call(self.other, "GET", missing, scope=self.other_scope))
        for path in listings:
            assert self.call(self.owner, "GET", path).status_code == 200
            denied(self.call(self.other, "GET", path))
            response = self.call(self.other, "GET", path, scope=self.other_scope)
            assert response.status_code == 200
            assert response.json() == {"items": [], "next_cursor": None}
        for method, path, kwargs, targeted, saved in self.writes:
            replay = self.call(self.owner, method, path, **kwargs)
            assert replay.status_code == 201
            if path == "conversations":
                assert (
                    replay.json()["conversation"]["id"] == saved["conversation"]["id"]
                )
            elif path.endswith("/turns"):
                assert replay.json()["turns"] == saved["turns"]
            elif path.endswith("/context"):
                assert replay.json()["context"] == saved["context"]
            else:
                assert replay.json() == saved
            for scope in [self.scope, self.other_scope] if targeted else [self.scope]:
                # Both a known receipt key and a new write must reauthorize.
                for key in (kwargs["headers"]["Idempotency-Key"], str(uuid4())):
                    assert self.call(self.owner, "GET", reads[0]).status_code == 200
                    denied(
                        self.call(
                            self.other,
                            method,
                            path,
                            scope=scope,
                            **{
                                **kwargs,
                                "headers": {
                                    **kwargs["headers"],
                                    "Idempotency-Key": key,
                                },
                            },
                        )
                    )
        assert private_state(self.engine) == before
        assert len(self.transport.calls) == calls
        for path, snapshot in zip(reads, snapshots, strict=True):
            assert self.call(self.owner, "GET", path).content == snapshot

        # Preserve the stolen cookie after logout so this tests server revocation.
        cookie = self.owner.cookies.get("__Host-acenta-session")
        if self.invalidation == "revoked":
            assert self.owner.post("/auth/logout").status_code == 204
        else:
            cookie = (
                "x" * 43
            )  # well-formed but unknown token, never a DB actor override
        self.owner.cookies.clear()
        self.owner.cookies.set("__Host-acenta-session", cookie)
        for path in [*reads, *listings]:
            denied(self.call(self.owner, "GET", path), 401)
        for method, path, kwargs, _, _ in self.writes:
            for key in (kwargs["headers"]["Idempotency-Key"], str(uuid4())):
                denied(
                    self.call(
                        self.owner,
                        method,
                        path,
                        **{
                            **kwargs,
                            "headers": {**kwargs["headers"], "Idempotency-Key": key},
                        },
                    ),
                    401,
                )
        assert private_state(self.engine) == before
        assert len(self.transport.calls) == calls
        assert self.other.get("/auth/session").status_code == 200


@pytest.fixture(params=["revoked", "invalid"])
def scenario(request, monkeypatch, composed, runtime_database):
    import aulalista_api.app as application

    trace = []
    engines = []

    def pooled_engine(settings):
        engine = create_engine(
            settings.database_url,
            poolclass=QueuePool,
            pool_size=1,
            max_overflow=0,
            pool_timeout=2,
            isolation_level="READ COMMITTED",
            hide_parameters=True,
            connect_args={
                "connect_timeout": settings.db_timeout_seconds,
                "options": "-c statement_timeout=2000 -c lock_timeout=2000 -c search_path=public",
            },
        )
        engines.append(engine)

        @event.listens_for(engine, "before_cursor_execute")
        def observe(connection, cursor, statement, parameters, context, executemany):
            driver = connection.connection.driver_connection
            trace.append((driver, driver.info.backend_pid))

        return engine

    monkeypatch.setattr(application, "make_engine", pooled_engine)
    generated = completed()
    generated["output"][0]["content"][0]["text"] = json.dumps(provider_output())
    transport = Transport(
        reply(generated), reply(chat_response("Private synthetic answer"))
    )
    app = window_app(monkeypatch, composed, transport)
    assert not app.dependency_overrides
    assert len(engines) == 1
    engine = engines[0]
    with engine.connect() as connection:
        assert connection.execute(text("SELECT current_user, session_user")).one() == (
            "aulalista_runtime",
            "aulalista_runtime",
        )
        assert connection.execute(
            text(
                "SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication "
                "FROM pg_roles WHERE rolname = current_user"
            )
        ).one() == (False, False, False, False, False)
        assert (
            connection.scalar(
                text(
                    "SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace "
                    "AND relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)"
                )
            )
            == 0
        )
    with (
        TestClient(app, base_url=ORIGIN) as owner,
        TestClient(app, base_url=ORIGIN) as other,
    ):
        scope, headers = sign_in(owner)
        owner.headers.update(headers)
        other_session = login(other, app.state.auth.sender, "runtime-b@example.test")
        other.headers.update(
            {"Origin": ORIGIN, "X-CSRF-Token": other_session["csrf_token"]}
        )
        yield Scenario(
            owner,
            other,
            scope,
            other_session["scope_id"],
            engine,
            trace,
            transport,
            request.param,
        )
        # Retain driver references so object-id reuse cannot satisfy the assertion.
        assert trace and len({pid for _, pid in trace}) == 1
        assert all(driver is trace[0][0] for driver, _ in trace)


def test_sources_planning_history_drafts_and_copies(scenario):
    s = scenario
    source, source_key = s.save("sources", content=FIXTURE_SOURCE, targeted=False)
    source_id = source["source_id"]
    planning, planning_key = s.save("plannings", payload=water_request(source))
    guided, guided_key = s.save(
        "guided-plannings",
        payload=guided_body(reference={"source_id": source_id, "source_version": 1}),
    )
    guided_path = f"plannings/{guided['receipt']['planning_id']}"
    planning_id = planning["receipt"]["planning_id"]
    base = f"plannings/{planning_id}"
    _, edit_key = s.save(f"{base}/revisions", payload=edit_request())
    draft_id = uuid4()
    _, draft_key = s.save(
        f"{base}/drafts/{draft_id}", method="PUT", payload=edit_request("draft")
    )
    copied, copy_key = s.save(f"{base}/copies", payload=edit_request("copy"))
    _, append_key = s.save(
        f"sources/{source_id}/versions?expected_version=1",
        content=b"Private synthetic V2",
    )
    reads = [
        f"sources/{source_id}/versions/1",
        f"sources/{source_id}/versions/2",
        f"operations/{source_key}",
        f"operations/{append_key}",
        base,
        f"{base}/revisions/1",
        f"{base}/revisions/2",
        f"planning-operations/{planning_key}",
        guided_path,
        f"{guided_path}/revisions/1",
        f"planning-operations/{guided_key}",
        f"planning-operations/{edit_key}",
        f"planning-drafts/{draft_id}",
        f"planning-draft-operations/{draft_key}",
        f"planning-operations/{copy_key}",
        f"plannings/{copied['receipt']['planning_id']}",
    ]
    original = s.call(s.owner, "GET", reads[0])
    assert original.content == FIXTURE_SOURCE
    assert original.headers["x-content-sha256"] == source["sha256"]
    assert original.headers["x-content-size"] == str(len(FIXTURE_SOURCE))
    for path, identity in (
        ("sources", source_id),
        ("plannings", planning_id),
        ("planning-drafts", draft_id),
    ):
        s.cursor(path, identity, status=422 if path == "sources" else 200)
    s.verify(reads, ["sources", "plannings", "planning-drafts"])
    # A known operation key and identical hash are not a global cache/identity.
    method, path, kwargs, _, _ = s.writes[0]
    own = s.call(s.other, method, path, scope=s.other_scope, **kwargs)
    assert own.status_code == 201
    assert own.json()["scope_id"] == s.other_scope
    assert own.json()["source_id"] != source_id
    assert own.json()["sha256"] == source["sha256"]
    assert (
        s.call(
            s.other,
            "GET",
            f"sources/{own.json()['source_id']}/versions/1",
            scope=s.other_scope,
        ).content
        == FIXTURE_SOURCE
    )
    assert (
        s.call(s.other, "GET", f"operations/{source_key}", scope=s.other_scope).json()
        == own.json()
    )
    assert (
        len(s.call(s.other, "GET", "sources", scope=s.other_scope).json()["items"]) == 1
    )


def test_analytic_sections_and_exact_derivatives(scenario):
    s = scenario
    section, key = s.save("analytic-sections", payload=section_body(), targeted=False)
    section_id = section["receipt"]["section_id"]
    base = f"analytic-sections/{section_id}"
    derived, derived_key = s.save(
        f"{base}/revisions/1/plannings", payload=derive_body()
    )
    _, edit_key = s.save(
        f"{base}/revisions",
        payload={
            "contract_version": 1,
            "expected_revision": 1,
            "data": section_body(situation="Private revised synthetic situation"),
        },
    )
    planning = f"plannings/{derived['receipt']['planning_id']}"
    s.save(f"{planning}/revisions", payload=edit_body())
    s.cursor("analytic-sections", section_id)
    s.verify(
        [
            base,
            f"{base}/revisions/1",
            f"{base}/revisions/2",
            f"analytic-section-operations/{key}",
            f"analytic-section-operations/{edit_key}",
            planning,
            f"{planning}/revisions/1",
            f"planning-operations/{derived_key}",
        ],
        ["analytic-sections", "analytic-sections?q=agua&limit=1", "plannings"],
    )


def test_generated_artifacts_and_versioned_chat_context(scenario):
    s = scenario
    generated, generation_key = s.save(
        "generated-plannings", payload=generated_body(), targeted=False
    )
    planning = f"plannings/{generated['receipt']['planning_id']}"
    conversation, open_key = s.save("conversations", payload={}, targeted=False)
    base = f"conversations/{conversation['conversation']['id']}"
    _, turn_key = s.save(
        f"{base}/turns",
        payload={"text": "Private synthetic question", "expected_version": 0},
    )
    _, context_key = s.save(
        f"{base}/context",
        payload={
            "expected_version": 1,
            "expected_context_revision": 0,
            "notes": "Private manual notes",
        },
    )
    _, reset_key = s.save(
        f"{base}/context",
        payload={"expected_version": 1, "expected_context_revision": 1, "notes": ""},
    )
    assert len(s.transport.calls) == 2
    s.cursor(
        "conversations",
        conversation["conversation"]["id"],
        parameter="cursor",
        status=404,
    )
    # B has no active chat; it cannot recover A's active pointer by swapping scope.
    denied(s.call(s.other, "GET", "active-conversation", scope=s.other_scope))
    s.verify(
        [
            planning,
            f"{planning}/revisions/1",
            f"planning-operations/{generation_key}",
            "active-conversation",
            base,
            f"{base}?limit=1",
            f"conversation-operations/{open_key}",
            f"{base}/operations/{turn_key}",
            f"{base}/context-operations/{context_key}",
            f"{base}/context-operations/{reset_key}",
        ],
        ["plannings", "conversations"],
    )
    # Creating B's own active chat with A's key never reuses A's pointer/receipt.
    method, path, kwargs, _, _ = s.writes[1]
    own = s.call(s.other, method, path, scope=s.other_scope, **kwargs)
    assert own.status_code == 201
    assert own.json()["conversation"]["id"] != conversation["conversation"]["id"]
    assert (
        s.call(s.other, "GET", "active-conversation", scope=s.other_scope).json()
        == own.json()
    )
    assert len(s.transport.calls) == 2
