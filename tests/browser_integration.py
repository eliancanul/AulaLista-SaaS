"""Explicit browser→HTTP→PostgreSQL test; never an application entrypoint."""

import os
import signal
import socket
import subprocess
import threading
import time
from pathlib import Path

import uvicorn
from test_materials import actor_app


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


def test_water_journey_through_real_api(runtime_database, actors):
    actor, scope = actors[0]
    app = actor_app(actor)
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
                ["npm", "run", "test:integration"],
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
