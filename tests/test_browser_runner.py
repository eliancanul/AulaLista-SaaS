import asyncio
import os
import signal
import subprocess
import sys
import time
from contextlib import nullcontext

import pytest
from browser_integration import lose_first_copy_response, run_process_group


@pytest.mark.parametrize("path_suffix", ["/copies", "/guided-plannings"])
def test_copy_response_fault_preserves_app_execution_and_only_loses_first_success(
    path_suffix,
):
    calls = []

    async def app(scope, receive, send):
        calls.append(scope)
        await send(
            {"type": "http.response.start", "status": scope["status"], "headers": []}
        )
        await send({"type": "http.response.body", "body": b"first", "more_body": True})
        await send({"type": "http.response.body", "body": b"last"})

    wrapped = lose_first_copy_response(app, path_suffix=path_suffix)

    async def invoke(method, path, status):
        messages = []

        async def send(message):
            messages.append(message)

        await wrapped(
            {"type": "http", "method": method, "path": path, "status": status},
            None,
            send,
        )
        return messages

    for method, path, status, expected in [
        ("GET", f"/scopes/test{path_suffix}", 201, 201),
        ("POST", "/scopes/test/revisions", 201, 201),
        ("POST", f"/scopes/test{path_suffix}", 409, 409),
        ("POST", f"/scopes/test{path_suffix}", 201, 503),
        ("POST", f"/scopes/test{path_suffix}", 201, 201),
    ]:
        messages = asyncio.run(invoke(method, path, status))
        assert messages[0]["status"] == expected
        if expected == 503:
            assert messages[0]["headers"] == [
                (b"content-type", b"application/json"),
                (b"cache-control", b"no-store"),
            ]
            assert messages[1:] == [
                {"type": "http.response.body", "body": b'{"detail":"unavailable"}'}
            ]
        else:
            assert b"".join(message["body"] for message in messages[1:]) == b"firstlast"
    assert len(calls) == 5


@pytest.mark.parametrize("outcome", ["success", "failure", "timeout"])
def test_browser_runner_cleans_descendants_even_if_npm_exits(tmp_path, outcome):
    pid_file = tmp_path / "child.pid"
    child = tmp_path / "child.py"
    child.write_text(
        "import os, signal, time\n"
        "from pathlib import Path\n"
        "signal.signal(signal.SIGTERM, signal.SIG_IGN)\n"
        f"Path({str(pid_file)!r}).write_text(str(os.getpid()))\n"
        "time.sleep(60)\n"
    )
    command = [
        sys.executable,
        "-c",
        "import subprocess, sys, time\n"
        "from pathlib import Path\n"
        f"subprocess.Popen([sys.executable, {str(child)!r}])\n"
        f"while not Path({str(pid_file)!r}).exists(): time.sleep(0.01)\n"
        + ("time.sleep(60)\n" if outcome == "timeout" else "")
        + f"sys.exit({7 if outcome == 'failure' else 0})\n",
    ]
    expected = {
        "success": nullcontext(),
        "failure": pytest.raises(subprocess.CalledProcessError),
        "timeout": pytest.raises(subprocess.TimeoutExpired),
    }[outcome]
    try:
        with expected as error:
            run_process_group(command, timeout=2)
        if outcome == "failure":
            assert error.value.returncode == 7
        pid = int(pid_file.read_text())
        deadline = time.monotonic() + 2
        while True:
            status = subprocess.run(
                ["ps", "-o", "stat=", "-p", str(pid)],
                capture_output=True,
                text=True,
                check=False,
            ).stdout.strip()
            if not status or status.startswith("Z"):
                break
            assert time.monotonic() < deadline, "Browser descendant survived cleanup"
            time.sleep(0.01)
    finally:
        if pid_file.exists():
            try:
                os.kill(int(pid_file.read_text()), signal.SIGKILL)
            except ProcessLookupError:
                pass


def test_browser_runner_allows_descendant_to_close_its_detached_child(tmp_path):
    ready = tmp_path / "ready"
    detached_pid = tmp_path / "detached.pid"
    cleaned = tmp_path / "cleaned"
    descendant = tmp_path / "descendant.py"
    descendant.write_text(
        "import signal, subprocess, sys, time\n"
        "from pathlib import Path\n"
        "detached = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'], start_new_session=True)\n"
        f"Path({str(detached_pid)!r}).write_text(str(detached.pid))\n"
        "def cleanup(*args):\n"
        "    time.sleep(0.25)\n"
        "    detached.terminate()\n"
        "    detached.wait(timeout=2)\n"
        f"    Path({str(cleaned)!r}).write_text('done')\n"
        "    sys.exit(0)\n"
        "signal.signal(signal.SIGTERM, cleanup)\n"
        f"Path({str(ready)!r}).touch()\n"
        "time.sleep(60)\n"
    )
    command = [
        sys.executable,
        "-c",
        "import subprocess, sys, time\n"
        "from pathlib import Path\n"
        f"subprocess.Popen([sys.executable, {str(descendant)!r}])\n"
        f"while not Path({str(ready)!r}).exists(): time.sleep(0.01)\n"
        "time.sleep(60)\n",
    ]
    try:
        with pytest.raises(subprocess.TimeoutExpired):
            run_process_group(command, timeout=2)
        assert cleaned.read_text() == "done"
        with pytest.raises(ProcessLookupError):
            os.kill(int(detached_pid.read_text()), 0)
    finally:
        if detached_pid.exists():
            try:
                os.kill(int(detached_pid.read_text()), signal.SIGKILL)
            except ProcessLookupError:
                pass
