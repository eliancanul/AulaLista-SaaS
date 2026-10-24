"""Session/CSRF HTTP contract with synthetic provider and disposable PostgreSQL.

PYTEST_DONT_REWRITE: never expand session, CSRF or OTP values on failure.
"""

from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_auth_integration import ORIGIN
from test_auth_integration import auth_factory as auth_factory
from test_openai_chat import chat_response
from test_openai_planning import Transport, reply
from test_pilot_composition import composed as composed
from test_pilot_composition import sign_in
from test_window_generation import window_app

from aulalista_api.ai_budget import BudgetReservation
from aulalista_api.app import create_app
from aulalista_api.openai_planning import ProviderError


def new_conversation(client, scope, headers, key=None):
    return client.post(
        f"/scopes/{scope}/conversations",
        json={},
        headers={**headers, "Idempotency-Key": str(key or uuid4())},
    )


def send(client, scope, conversation, headers, *, key=None, body=None):
    return client.post(
        f"/scopes/{scope}/conversations/{conversation}/turns",
        json=body or {"text": "Pregunta sintética", "expected_version": 0},
        headers={**headers, "Idempotency-Key": str(key or uuid4())},
    )


def test_http_creation_turns_recovery_and_closed_restart(
    monkeypatch, composed, runtime_database
):
    transport = Transport(
        reply(chat_response("Primero")), reply(chat_response("Después"))
    )
    app = window_app(monkeypatch, composed, transport)
    with TestClient(app, base_url=ORIGIN) as client:
        scope, headers = sign_in(client)
        assert client.get(f"/scopes/{scope}/chat-capability").json() == {
            "available": True
        }
        creation = uuid4()
        created = new_conversation(client, scope, headers, creation)
        assert created.status_code == 201
        assert created.headers["cache-control"] == "no-store"
        saved = created.json()
        conversation = saved["conversation"]["id"]
        assert saved["conversation"]["version"] == 0
        assert (
            client.get(f"/scopes/{scope}/conversation-operations/{creation}").json()
            == saved
        )
        assert new_conversation(client, scope, headers, creation).json() == saved
        assert len(transport.calls) == 0
        first = uuid4()
        response = send(client, scope, conversation, headers, key=first)
        assert response.status_code == 201
        response = send(
            client,
            scope,
            conversation,
            headers,
            body={"text": "¿Y después?", "expected_version": 1},
        )
        assert response.status_code == 201
        saved = response.json()
        assert len(saved["turns"]) == 1
        assert saved["conversation"]["version"] == 2
        assert client.get(f"/scopes/{scope}/conversations?limit=1").json() == {
            "items": [saved["conversation"]],
            "next_cursor": None,
        }
        first_receipt = client.get(
            f"/scopes/{scope}/conversations/{conversation}/operations/{first}"
        ).json()
        assert first_receipt["turns"][0]["number"] == 1
        history = client.get(f"/scopes/{scope}/conversations/{conversation}").json()
        assert len(history["turns"]) == 2
        cookies = client.cookies
    with TestClient(create_app(), base_url=ORIGIN) as client:
        client.cookies.update(cookies)
        assert client.get(f"/scopes/{scope}/chat-capability").json() == {
            "available": False
        }
        assert (
            client.get(f"/scopes/{scope}/conversations/{conversation}").json()
            == history
        )
        assert (
            send(client, scope, conversation, headers, key=first).json()
            == first_receipt
        )
        rejected = send(
            client,
            scope,
            conversation,
            headers,
            body={"text": "Otra", "expected_version": 2},
        )
        assert rejected.status_code == 503
        assert rejected.json() == {"detail": "chat_unavailable"}
    assert len(transport.calls) == 2
    with Session(runtime_database) as db:
        rows = db.scalars(select(BudgetReservation)).all()
        assert len(rows) == 2 and all(row.kind == "chat" for row in rows)


def test_http_auth_csrf_validation_and_scope_secrecy(monkeypatch, composed):
    transport = Transport()
    app = window_app(monkeypatch, composed, transport)
    with TestClient(app, base_url=ORIGIN) as client:
        scope = str(composed.scope_id)
        assert client.get(f"/scopes/{scope}/conversations").status_code == 401
        scope, headers = sign_in(client)
        assert new_conversation(client, scope, {}).status_code == 403
        created = new_conversation(client, scope, headers).json()
        conversation = created["conversation"]["id"]
        for body in (
            {"text": "", "expected_version": 0},
            {"text": "\x00", "expected_version": 0},
            {"text": "x" * 4097, "expected_version": 0},
            {"text": "😀" * 2049, "expected_version": 0},
            {"text": "hola", "expected_version": True},
            {"text": "hola", "expected_version": 0, "messages": []},
            {"text": "hola", "expected_version": 0, "source_id": str(uuid4())},
        ):
            response = send(client, scope, conversation, headers, body=body)
            assert response.status_code == 422
            assert response.json() == {"detail": "invalid_request"}
        for url in (
            f"/scopes/{scope}/conversations?limit=51",
            f"/scopes/{scope}/conversations?cursor=invalid",
        ):
            assert client.get(url).status_code == 422
        for url in (
            f"/scopes/{uuid4()}/conversations/{conversation}",
            f"/scopes/{scope}/conversations/{uuid4()}",
            f"/scopes/{scope}/conversation-operations/{uuid4()}",
        ):
            response = client.get(url)
            assert response.status_code == 404
            assert response.json() == {"detail": "not_found"}
        assert (
            client.get(f"/scopes/{scope}/conversations/{conversation}").json()
            == created
        )
    assert transport.calls == []


def test_http_json_escapes_and_unknown_usage_are_bounded(monkeypatch, composed):
    transport = Transport(reply(chat_response(usage=None)))
    app = window_app(monkeypatch, composed, transport)
    with TestClient(app, base_url=ORIGIN) as client:
        scope, headers = sign_in(client)
        conversation = new_conversation(client, scope, headers).json()["conversation"][
            "id"
        ]
        response = send(
            client,
            scope,
            conversation,
            headers,
            body={"text": "a" + "\t" * 4095, "expected_version": 0},
        )
        assert response.status_code == 201
        assert response.json()["turns"][0]["user_text"] == "a" + "\t" * 4095
        usage = response.json()["turns"][0]["usage"]
        assert usage["input_tokens"] is None and usage["estimated_cost_usd"] is None


@pytest.mark.parametrize("uncertain", [False, True])
def test_http_error_only_detail_and_get_never_resends(monkeypatch, composed, uncertain):
    transport = Transport(ProviderError("provider_timeout", uncertain=uncertain))
    app = window_app(monkeypatch, composed, transport)
    with TestClient(app, base_url=ORIGIN) as client:
        scope, headers = sign_in(client)
        conversation = new_conversation(client, scope, headers).json()["conversation"][
            "id"
        ]
        operation = uuid4()
        state = "uncertain" if uncertain else "failed"
        for _ in range(2):
            response = send(client, scope, conversation, headers, key=operation)
            assert response.status_code == 409
            assert response.json() == {"detail": f"chat_{state}"}
        response = client.get(
            f"/scopes/{scope}/conversations/{conversation}/operations/{operation}"
        )
        assert response.status_code == 200
        assert response.json()["turns"][0]["state"] == state
        assert response.json()["turns"][0]["user_text"] == "Pregunta sintética"
    assert len(transport.calls) == 1


def test_http_single_active_context_receipt_validation_and_reauthentication(
    monkeypatch, composed
):
    transport = Transport(reply(chat_response("Kept history")))
    app = window_app(monkeypatch, composed, transport)
    with TestClient(app, base_url=ORIGIN) as client:
        assert (
            client.get(f"/scopes/{composed.scope_id}/active-conversation").status_code
            == 401
        )
        scope, headers = sign_in(client)
        assert client.get(f"/scopes/{scope}/active-conversation").status_code == 404
        created = new_conversation(client, scope, headers).json()
        conversation = created["conversation"]["id"]
        assert new_conversation(client, scope, headers).json() == created
        assert client.get(f"/scopes/{scope}/active-conversation").json() == created
        assert send(client, scope, conversation, headers).status_code == 201
        url = f"/scopes/{scope}/conversations/{conversation}/context"
        operation = uuid4()
        context = {
            "expected_version": 1,
            "expected_context_revision": 0,
            "notes": "Corrección: no usar tarea. 😀",
        }
        operation_headers = {**headers, "Idempotency-Key": str(operation)}
        assert (
            client.post(
                url, json=context, headers={"Idempotency-Key": str(operation)}
            ).status_code
            == 403
        )
        for invalid in (
            {**context, "notes": " "},
            {**context, "notes": "\x00"},
            {**context, "notes": "😀" * 2049},
            {**context, "notes": "a" * 4097},
            {**context, "expected_context_revision": True},
            {**context, "source_id": str(uuid4())},
        ):
            rejected = client.post(url, json=invalid, headers=operation_headers)
            assert rejected.status_code == 422
            assert rejected.json() == {"detail": "invalid_request"}
        changed = client.post(url, json=context, headers=operation_headers)
        assert changed.status_code == 201
        assert changed.headers["cache-control"] == "no-store"
        exact = changed.json()
        receipt_url = f"/scopes/{scope}/conversations/{conversation}/context-operations/{operation}"
        assert client.get(receipt_url).json() == exact
        assert client.post(url, json=context, headers=operation_headers).json() == exact
        assert (
            client.get(
                f"/scopes/{scope}/conversations/{conversation}?limit=51"
            ).status_code
            == 422
        )
        assert (
            client.get(
                f"/scopes/{scope}/conversations/{conversation}?cursor=99"
            ).status_code
            == 404
        )
        assert (
            client.get(f"/scopes/{scope}/conversations/{conversation}?limit=1").json()[
                "turns"
            ][0]["assistant_text"]
            == "Kept history"
        )
        # A fresh valid session recovers the same server-selected conversation/context.
        assert client.post("/auth/logout", headers=headers).status_code == 204
        assert client.get(f"/scopes/{scope}/active-conversation").status_code == 401
        from aulalista_api.auth import now as auth_now

        after_cooldown = auth_now() + timedelta(minutes=2)
        monkeypatch.setattr("aulalista_api.auth.now", lambda: after_cooldown)
        sign_in(client)
        recovered = client.get(f"/scopes/{scope}/active-conversation").json()
        assert recovered["conversation"]["id"] == conversation
        assert recovered["context"] == exact["context"]
        assert len(recovered["turns"]) == 1
    assert len(transport.calls) == 1
