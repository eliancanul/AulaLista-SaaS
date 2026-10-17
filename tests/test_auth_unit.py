"""Configuración cerrada y verificador Google sin red ni secretos reales."""

import base64
from unittest.mock import Mock

import pytest
from starlette.testclient import TestClient

from aulalista_api.app import create_app
from aulalista_api.auth import AuthError, normalized_email
from aulalista_api.auth_config import load_auth_settings
from aulalista_api.auth_google import GoogleVerifier


@pytest.fixture(autouse=True)
def no_auth(monkeypatch):
    for name in (
        "AULALISTA_AUTH_ORIGIN",
        "AULALISTA_AUTH_HMAC_KEY",
        "AULALISTA_GOOGLE_CLIENT_ID",
    ):
        monkeypatch.delenv(name, raising=False)


def test_unconfigured_closed():
    assert load_auth_settings() is None
    with TestClient(create_app()) as client:
        assert client.get("/auth/bootstrap").status_code == 503
        assert client.get("/auth/session").status_code == 401


@pytest.mark.parametrize(
    "origin",
    [
        "http://example.com",
        "https://example.com/path",
        "https://a@b",
        "https://example.com?x=1",
        "null",
    ],
)
def test_invalid_origin_fails_start(monkeypatch, origin):
    monkeypatch.setenv("AULALISTA_AUTH_ORIGIN", origin)
    monkeypatch.setenv(
        "AULALISTA_AUTH_HMAC_KEY", base64.urlsafe_b64encode(b"s" * 32).decode()
    )
    with pytest.raises(ValueError, match="authentication configuration"):
        load_auth_settings()


def test_partial_and_short_key_fail(monkeypatch):
    monkeypatch.setenv("AULALISTA_AUTH_ORIGIN", "https://localhost")
    with pytest.raises(ValueError):
        load_auth_settings()
    monkeypatch.setenv("AULALISTA_AUTH_HMAC_KEY", "c2hvcnQ=")
    with pytest.raises(ValueError):
        load_auth_settings()


def test_email_normalization_does_not_alias():
    assert normalized_email("User.Name+tag@EXAMPLE.COM") == "User.Name+tag@example.com"
    assert normalized_email("USER@example.com") != normalized_email("user@example.com")


@pytest.mark.parametrize(
    "email",
    [
        "x",
        "@example.com",
        "a..b@example.com",
        "a@example..com",
        "x\n@example.com",
        " x@example.com",
    ],
)
def test_invalid_email(email):
    with pytest.raises(AuthError):
        normalized_email(email)


@pytest.mark.parametrize(
    "change",
    [
        {"aud": "attacker"},
        {"iss": "https://attacker.test"},
        {"sub": ""},
        {"nonce": "different"},
        {"nonce": None},
        {"email_verified": False},
        {"email": None},
    ],
)
def test_google_checks_claims(monkeypatch, change):
    claims = {
        "iss": "accounts.google.com",
        "aud": "test.apps.googleusercontent.com",
        "sub": "subject",
        "nonce": "nonce",
        "email": "test@example.com",
        "email_verified": True,
    }
    claims.update(change)
    monkeypatch.setattr(
        "aulalista_api.auth_google.id_token.verify_oauth2_token",
        Mock(return_value=claims),
    )
    with pytest.raises(ValueError, match="Invalid Google"):
        GoogleVerifier("test.apps.googleusercontent.com").verify("credential", "nonce")


def test_google_uses_library_and_canonical_issuer(monkeypatch):
    claims = {
        "iss": "accounts.google.com",
        "aud": "test.apps.googleusercontent.com",
        "sub": "subject",
        "nonce": "nonce",
        "email": "test@example.com",
        "email_verified": True,
    }
    verify = Mock(return_value=claims)
    monkeypatch.setattr(
        "aulalista_api.auth_google.id_token.verify_oauth2_token", verify
    )
    result = GoogleVerifier("test.apps.googleusercontent.com").verify(
        "credential", "nonce"
    )
    assert result["iss"] == "https://accounts.google.com"
    assert verify.call_args.args[0] == "credential"
    assert verify.call_args.args[2] == "test.apps.googleusercontent.com"


def test_google_signature_library_failure_closed(monkeypatch):
    monkeypatch.setattr(
        "aulalista_api.auth_google.id_token.verify_oauth2_token",
        Mock(side_effect=ValueError("signature")),
    )
    with pytest.raises(ValueError, match="Invalid Google"):
        GoogleVerifier("test.apps.googleusercontent.com").verify("forged", "nonce")


def test_recovery_context_column_is_nullable_uuid_without_index_or_default():
    from sqlalchemy import Uuid

    from aulalista_api.auth_models import AuthSession

    column = AuthSession.__table__.columns.get("recovery_context_id")
    assert column is not None
    assert isinstance(column.type, Uuid)
    assert column.nullable
    assert column.default is None
    assert not column.index


def test_recovery_context_is_generated_once_in_the_existing_login_insert():
    from types import SimpleNamespace
    from uuid import UUID, uuid4

    from aulalista_api.auth import Auth

    auth = Auth(None, SimpleNamespace(hmac_key=b"synthetic-only"))
    owner, scope = uuid4(), uuid4()
    contexts = []
    for _ in range(2):
        db = Mock()
        db.scalar.return_value = scope
        _, document = auth.finish(db, SimpleNamespace(consumed=False), owner, None)
        row = db.add.call_args.args[0]
        assert UUID(document["recovery_context_id"]).version == 4
        assert row.recovery_context_id == UUID(document["recovery_context_id"])
        assert row.principal_id == owner
        db.add.assert_called_once()
        contexts.append(row.recovery_context_id)
        assert (
            auth.document(db, row, "synthetic-token")["recovery_context_id"]
            == document["recovery_context_id"]
        )
        assert row.recovery_context_id == contexts[-1]
    assert contexts[0] != contexts[1]
