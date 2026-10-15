"""Verify real server logs without printing any potentially private contents."""

import sys
from pathlib import Path

PRIVATE_MARKER = b"synthetic-private-db-log-marker"


def verify_log(contents: str) -> None:
    assert "ck_version_hash" in contents, (
        "Expected database privacy probe was not logged"
    )
    assert "Failing row contains" not in contents, "Database log includes row details"
    assert "STATEMENT:" not in contents, "Database log includes SQL statements"
    for marker in (PRIVATE_MARKER.decode(), PRIVATE_MARKER.hex()):
        assert marker not in contents, "Database log includes private content"


if __name__ == "__main__":
    verify_log(Path(sys.argv[1]).read_text())
    print(
        "PostgreSQL privacy probe passed: error present, content/details/statements absent"
    )
