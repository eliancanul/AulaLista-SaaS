import os
import signal
import subprocess
import sys
import time
from contextlib import nullcontext

import pytest
from browser_integration import run_process_group


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
