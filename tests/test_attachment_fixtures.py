"""The attachment variants are a fixed allowlist, never a parser."""

import pytest

from aulalista_api.water_fixture import (
    FIXTURE_SOURCE,
    SUPPORTED_PROMPT,
    SUPPORTED_SOURCES,
    generate,
)


@pytest.mark.parametrize("content", SUPPORTED_SOURCES)
def test_each_approved_attachment_is_deterministic(content):
    result = generate(SUPPORTED_PROMPT, content)
    assert result == generate(SUPPORTED_PROMPT, FIXTURE_SOURCE)
    assert result["provenance"] == "synthetic-fixture-v1"
    assert "simulado" in result["notice"]


@pytest.mark.parametrize("content", [b"arbitrary", FIXTURE_SOURCE + b"\n", b""])
def test_other_bytes_are_rejected(content):
    with pytest.raises(ValueError, match="unsupported_fixture"):
        generate(SUPPORTED_PROMPT, content)
