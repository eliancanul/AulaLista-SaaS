"""Explicit browser→HTTP→PostgreSQL test; never an application entrypoint."""

import os
import signal
import socket
import subprocess
import threading
import time
from pathlib import Path

import pytest
import uvicorn
from test_materials import actor_app


def lose_first_copy_response(app):
    """Simulate a failed delivery only after the real API has committed a copy."""
    lost = False

    async def wrapped(scope, receive, send):
        dropped = False

        async def deliver(message):
            nonlocal lost, dropped
            if (
                not lost
                and scope["type"] == "http"
                and scope["method"] == "POST"
                and scope["path"].endswith("/copies")
                and message["type"] == "http.response.start"
                and message["status"] == 201
            ):
                lost = dropped = True
                await send(
                    {
                        "type": "http.response.start",
                        "status": 503,
                        "headers": [
                            (b"content-type", b"application/json"),
                            (b"cache-control", b"no-store"),
                        ],
                    }
                )
                await send(
                    {"type": "http.response.body", "body": b'{"detail":"unavailable"}'}
                )
            elif not dropped:
                await send(message)

        await app(scope, receive, deliver)

    return wrapped


def run_process_group(command, *, timeout, **kwargs):
    process = subprocess.Popen(command, start_new_session=True, **kwargs)
    try:
        code = process.wait(timeout=timeout)
        if code:
            raise subprocess.CalledProcessError(code, command)
    finally:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        # Playwright needs its own grace period to close detached browser/server groups.
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            process.poll()
            try:
                os.killpg(process.pid, 0)
            except ProcessLookupError:
                break
            time.sleep(0.05)
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=5)


@pytest.mark.parametrize("journey", ["acenta", "draft", "copy"])
def test_journey_through_real_api(runtime_database, actors, journey):
    actor, scope = actors[0]
    app = actor_app(actor)
    if journey == "copy":
        app = lose_first_copy_response(app)
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
        server = uvicorn.Server(
            uvicorn.Config(app, access_log=False, log_level="warning", ws="none")
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
                [
                    "npm",
                    "run",
                    "test:integration",
                    "--",
                    rf"tests/{journey}\.integration\.ts$",
                    f"--output=test-results/integration/{journey}",
                ],
                cwd=Path(__file__).resolve().parents[1] / "web",
                env={
                    **os.environ,
                    "AULALISTA_E2E_ACTOR_ID": str(actor),
                    "AULALISTA_E2E_SCOPE_ID": str(scope),
                    "AULALISTA_E2E_API_URL": f"http://127.0.0.1:{port}",
                },
                timeout=180,
            )
        finally:
            server.should_exit = True
            worker.join(timeout=10)
            assert not worker.is_alive(), "Test API did not shut down"
