"""CI names its pytest modules one by one, so an unlisted module never runs."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_every_test_module_is_run_by_a_workflow():
    commands = [
        line
        for workflow in sorted((ROOT / ".github" / "workflows").glob("*.yml"))
        for line in workflow.read_text(encoding="utf-8").splitlines()
        if re.search(r"\bpytest\b", line)
    ]
    assert commands
    executed = set(re.findall(r"tests/(test_\w+\.py)", "\n".join(commands)))
    modules = {path.name for path in (ROOT / "tests").glob("test_*.py")}
    assert sorted(modules - executed) == []
    assert sorted(executed - modules) == []


def test_throwaway_failure_to_prove_the_merge_is_blocked():
    assert False
