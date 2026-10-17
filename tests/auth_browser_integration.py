"""Browser → production auth → real PostgreSQL; external delivery only is fake."""

import base64
import os
import socket
import threading
import time
from pathlib import Path

import uvicorn
from browser_integration import run_process_group
from fastapi import HTTPException
from test_auth_integration import CapturingSender

from aulalista_api.app import create_app


def test_auth_journey_through_real_api(runtime_database, monkeypatch):
    monkeypatch.setenv("AULALISTA_AUTH_ORIGIN", "http://localhost:4175")
    monkeypatch.setenv(
        "AULALISTA_AUTH_HMAC_KEY",
        base64.urlsafe_b64encode(b"browser-synthetic-key-only-32bytes").decode(),
    )
    monkeypatch.delenv("AULALISTA_GOOGLE_CLIENT_ID", raising=False)
    app = create_app()
    sender = CapturingSender()
    app.state.auth.sender = sender
    assert not app.dependency_overrides

    @app.get("/__test__/mailbox")
    def test_mailbox(email: str):
        # Exists exclusively in this explicit test module, never packaged runtime.
        with sender.lock:
            for target, code in reversed(sender.messages):
                if target == email:
                    return {"code": code}
        raise HTTPException(404)

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
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
                time.sleep(0.05)
            run_process_group(
                ["npx", "playwright", "test", "--config", "playwright.auth.config.ts"],
                cwd=Path(__file__).resolve().parents[1] / "web",
                env={
                    **os.environ,
                    "AULALISTA_AUTH_E2E_API_URL": f"http://127.0.0.1:{port}",
                },
                # Two journeys reauthenticate after the real 60-second email cooldown.
                timeout=300,
            )
        finally:
            server.should_exit = True
            worker.join(timeout=10)
            assert not worker.is_alive(), "Test API did not shut down"
