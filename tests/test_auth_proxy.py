"""Real HTTP middleware must preserve peer IP for shared abuse counters."""

import base64
import socket
import threading
import time
from datetime import UTC, datetime

import httpx2
import uvicorn
from sqlalchemy import text

import aulalista_api.auth as authentication
from aulalista_api.app import create_app


def test_uvicorn_does_not_trust_forwarded_identity_for_bootstrap_quota(
    runtime_database, migrated_database, monkeypatch
):
    monkeypatch.setenv("AULALISTA_AUTH_ORIGIN", "http://localhost:4175")
    monkeypatch.setenv(
        "AULALISTA_AUTH_HMAC_KEY",
        base64.urlsafe_b64encode(b"synthetic-proxy-test-key-32bytes!!").decode(),
    )
    monkeypatch.delenv("AULALISTA_GOOGLE_CLIENT_ID", raising=False)
    instant = datetime.now(UTC)
    monkeypatch.setattr(authentication, "now", lambda: instant)
    app = create_app()
    assert not app.dependency_overrides
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
        # Same security-relevant configuration as the auth browser harness.
        server = uvicorn.Server(
            uvicorn.Config(
                app,
                access_log=False,
                log_level="warning",
                ws="none",
                proxy_headers=False,
            )
        )
        worker = threading.Thread(
            target=server.run, kwargs={"sockets": [listener]}, daemon=True
        )
        worker.start()
        try:
            deadline = time.monotonic() + 10
            while not server.started:
                assert worker.is_alive(), "Test API exited before startup"
                assert time.monotonic() < deadline, "Test API startup timed out"
                time.sleep(0.01)
            with httpx2.Client(
                base_url=f"http://127.0.0.1:{port}", trust_env=False, timeout=5
            ) as client:
                for index in range(31):
                    response = client.get(
                        "/auth/bootstrap",
                        headers={
                            "X-Forwarded-For": f"192.0.2.{index + 1}",
                            "X-Forwarded-Proto": "https",
                            "Forwarded": f"for=192.0.2.{index + 1};proto=https",
                        },
                    )
                    assert response.status_code == (200 if index < 30 else 429)
                assert response.json() == {"detail": "rate_limited"}
            with migrated_database.connect() as connection:
                assert connection.execute(
                    text("SELECT count(*), max(count) FROM auth_rate")
                ).one() == (1, 31)
        finally:
            server.should_exit = True
            worker.join(timeout=10)
            assert not worker.is_alive(), "Test API did not shut down"
