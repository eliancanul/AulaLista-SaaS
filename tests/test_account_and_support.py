"""Tests for account identity linking, revocable consent, SMTP OTP, and support debug backlog."""

from __future__ import annotations

import base64
import hashlib
import struct
import zlib
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from aulalista_api.app import create_app
from aulalista_api.database import PersonalScope, Principal
from aulalista_api.mail_sender import (
    FakeMailSender,
    SmtpMailSender,
    build_otp_email_message,
    load_auth_email_sender_from_env,
)
from aulalista_api.material_routes import require_actor


def _make_valid_png(width: int = 8, height: int = 8) -> bytes:
    """Create a valid minimal RGBA PNG in pure Python."""
    def chunk(chunk_type: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(chunk_type + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", crc)

    raw_rows = b"".join(b"\x00" + (b"\x96\x4e\x3b\xff" * width) for _ in range(height))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw_rows))
        + chunk(b"IEND", b"")
    )


class _CapturingAuthSender:
    def __init__(self) -> None:
        self.sent: list[tuple[str, str]] = []

    def send_code(self, email: str, code: str) -> None:
        self.sent.append((email, code))


class _FakeGoogleVerifier:
    def verify(self, credential: str, nonce: str) -> dict:
        if credential == "bad-token":
            raise ValueError("invalid")
        sub, email = credential.split("|", 1)
        return {
            "sub": sub,
            "email": email,
            "email_verified": True,
            "nonce": nonce,
        }


def _seed_user(engine):
    with Session(engine) as db:
        principal = Principal(id=uuid4())
        db.add(principal)
        db.flush()
        scope = PersonalScope(id=uuid4(), owner_principal_id=principal.id)
        db.add(scope)
        db.commit()
        return principal.id, scope.id


def test_otp_email_builder_and_opt_in_loader(monkeypatch):
    msg = build_otp_email_message(
        from_email="acenta@example.test",
        to_email="profe@example.test",
        code="12345678",
    )
    assert msg["To"] == "profe@example.test"
    assert "12345678" in msg.get_content()

    # Fail-closed when AULALISTA_EMAIL_OTP_ENABLED is absent
    monkeypatch.delenv("AULALISTA_EMAIL_OTP_ENABLED", raising=False)
    monkeypatch.setenv("SMTP_HOST", "smtp.example.test")
    monkeypatch.setenv("SMTP_USER", "acenta@example.test")
    assert load_auth_email_sender_from_env() is None

    # Active only when explicitly enabled + SMTP_HOST configured
    monkeypatch.setenv("AULALISTA_EMAIL_OTP_ENABLED", "true")
    sender = load_auth_email_sender_from_env()
    assert sender is not None
    assert isinstance(sender._sender, SmtpMailSender)

    fake = FakeMailSender()
    fake.send_otp(to_email="profe@example.test", code="87654321")
    assert fake.sent_otps == [("profe@example.test", "87654321")]


def test_account_consent_and_identity_linking(runtime_database):
    p1, s1 = _seed_user(runtime_database)
    p2, s2 = _seed_user(runtime_database)

    app = create_app()
    auth_sender = _CapturingAuthSender()
    app.state.auth.sender = auth_sender
    app.state.auth.google = _FakeGoogleVerifier()
    active_actor = {"id": p1}
    app.dependency_overrides[require_actor] = lambda: active_actor["id"]

    with TestClient(app) as client:
        # 1. Default account state
        res = client.get(f"/scopes/{s1}/account")
        assert res.status_code == 200
        body = res.json()
        assert body["promotional_consent"] is False
        assert body["identities"] == []
        assert body["capabilities"]["email_otp_available"] is True

        # 2. Grant and then revoke promotional consent with full audit history
        res_on = client.put(
            f"/scopes/{s1}/account/preferences",
            json={"promotional_consent": True, "source": "account_view"},
        )
        assert res_on.status_code == 200
        assert res_on.json()["promotional_consent"] is True
        assert len(res_on.json()["consent_history"]) == 1

        res_off = client.put(
            f"/scopes/{s1}/account/preferences",
            json={"promotional_consent": False, "source": "account_view"},
        )
        assert res_off.status_code == 200
        assert res_off.json()["promotional_consent"] is False
        assert len(res_off.json()["consent_history"]) == 2

        # 3. Link Email OTP identity via fresh 8-digit code
        req = client.post(
            f"/scopes/{s1}/account/link/email/request",
            json={"email": "maestra@escuela.mx"},
        )
        assert req.status_code == 202
        challenge_id = req.json()["challenge_id"]
        assert auth_sender.sent[-1][0] == "maestra@escuela.mx"
        code = auth_sender.sent[-1][1]

        bad = client.post(
            f"/scopes/{s1}/account/link/email/verify",
            json={"challenge_id": challenge_id, "code": "00000000"},
        )
        assert bad.status_code == 400

        ok = client.post(
            f"/scopes/{s1}/account/link/email/verify",
            json={"challenge_id": challenge_id, "code": code},
        )
        assert ok.status_code == 200
        assert len(ok.json()["identities"]) == 1
        assert ok.json()["identities"][0]["provider"] == "email_otp"
        assert ok.json()["identities"][0]["email"] == "maestra@escuela.mx"

        # 4. Link Google identity to same principal
        g_ok = client.post(
            f"/scopes/{s1}/account/link/google",
            json={"credential": "google-sub-123|maestra@gmail.com", "nonce": "n1"},
        )
        assert g_ok.status_code == 200
        providers = {i["provider"] for i in g_ok.json()["identities"]}
        assert providers == {"email_otp", "google"}

        # 5. Another principal cannot hijack already-linked email or Google identity
        active_actor["id"] = p2
        conflict_email = client.post(
            f"/scopes/{s2}/account/link/email/request",
            json={"email": "maestra@escuela.mx"},
        )
        assert conflict_email.status_code == 409
        assert conflict_email.json()["detail"] == "identity_conflict"

        conflict_google = client.post(
            f"/scopes/{s2}/account/link/google",
            json={"credential": "google-sub-123|maestra@gmail.com", "nonce": "n2"},
        )
        assert conflict_google.status_code == 409


def test_support_debug_backlog_with_screenshot_and_redaction(runtime_database):
    p1, s1 = _seed_user(runtime_database)
    p2, s2 = _seed_user(runtime_database)

    app = create_app()
    active_actor = {"id": p1}
    app.dependency_overrides[require_actor] = lambda: active_actor["id"]

    png_bytes = _make_valid_png(12, 12)
    png_b64 = base64.b64encode(png_bytes).decode()
    data_url = f"data:image/png;base64,{png_b64}"

    with TestClient(app) as client:
        # Trigger a 404 so server diagnostics recorder captures it automatically
        missing = client.get(f"/scopes/{s1}/support/tickets/{uuid4()}")
        assert missing.status_code == 404

        # Reject invalid screenshot bytes
        bad_shot = client.post(
            f"/scopes/{s1}/support/tickets",
            json={
                "category": "bug",
                "severity": "high",
                "summary": "Captura inválida",
                "screenshot_data_url": "data:image/png;base64,bm90LWEtcG5n",
            },
        )
        assert bad_shot.status_code == 422

        # Create ticket with valid auto-captured screenshot and sensitive fields in debug bundle
        created = client.post(
            f"/scopes/{s1}/support/tickets",
            json={
                "category": "ui",
                "severity": "high",
                "summary": "El botón de imprimir no responde en móvil",
                "description": "Al tocar Imprimir ahora se quedó girando.",
                "view_name": "annexes",
                "route_url": "http://127.0.0.1:8012/?secret=123",
                "screenshot_data_url": data_url,
                "debug_bundle": {
                    "consoleErrors": [{"message": "TypeError: cannot read x"}],
                    "networkLog": [
                        {"method": "POST", "path": "/print", "status": 502, "durationMs": 420}
                    ],
                    "headers": {
                        "authorization": "Bearer SUPER_SECRET",
                        "csrf_token": "secret-csrf",
                        "accept": "application/json",
                    },
                    "appState": {"view": "annexes", "school": "Benito Juárez"},
                },
            },
        )
        assert created.status_code == 201
        ticket = created.json()
        ticket_id = ticket["id"]
        assert ticket["has_screenshot"] is True
        assert ticket["screenshot_sha256"] == hashlib.sha256(png_bytes).hexdigest()
        assert ticket["route_url"] == "http://127.0.0.1:8012/"
        assert ticket["debug_bundle"]["headers"]["authorization"] == "[redacted]"
        assert ticket["debug_bundle"]["headers"]["csrf_token"] == "[redacted]"
        assert ticket["debug_bundle"]["headers"]["accept"] == "application/json"
        assert ticket["server_diagnostics"]["recent_server_errors"]
        assert ticket["console_error_count"] == 1
        assert ticket["failed_request_count"] == 1

        # Fetch raw PNG screenshot
        img_res = client.get(f"/scopes/{s1}/support/tickets/{ticket_id}/screenshot")
        assert img_res.status_code == 200
        assert img_res.headers["content-type"] == "image/png"
        assert img_res.content == png_bytes

        # List backlog & filter
        listed = client.get(f"/scopes/{s1}/support/tickets")
        assert listed.status_code == 200
        assert listed.json()["total"] == 1
        assert listed.json()["counts_by_status"]["open"] == 1
        assert listed.json()["counts_by_severity"]["high"] == 1

        # Triage ticket status + notes
        patched = client.patch(
            f"/scopes/{s1}/support/tickets/{ticket_id}",
            json={"status": "investigating", "triage_notes": "Reproducido en iPhone 14"},
        )
        assert patched.status_code == 200
        assert patched.json()["status"] == "investigating"
        assert patched.json()["triage_notes"] == "Reproducido en iPhone 14"

        # Export full JSON debug backlog
        exported = client.get(f"/scopes/{s1}/support/backlog.json")
        assert exported.status_code == 200
        assert exported.json()["total_tickets"] == 1
        assert exported.json()["tickets"][0]["id"] == ticket_id

        # Scope isolation: p2 cannot read p1's tickets or screenshot
        active_actor["id"] = p2
        assert client.get(f"/scopes/{s1}/support/tickets").status_code == 404
        assert (
            client.get(f"/scopes/{s2}/support/tickets/{ticket_id}").status_code == 404
        )
        assert (
            client.get(
                f"/scopes/{s2}/support/tickets/{ticket_id}/screenshot"
            ).status_code
            == 404
        )
