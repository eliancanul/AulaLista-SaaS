"""Verify offline adapters without running Promptfoo or a provider API."""

import importlib.util
import json
import socket
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location(
    "checks", Path(__file__).resolve().parents[1] / "evaluation/promptfoo/checks.py"
)
checks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checks)


def test_prepared_config_has_only_local_provider():
    config = json.loads(Path("evaluation/promptfoo/promptfooconfig.json").read_text())
    assert config["providers"] == ["file://checks.py"]
    assert config["sharing"] is False
    assert config["writeLatestResults"] is False
    assert config["tracing"] == {"enabled": False}
    assert config["evaluateOptions"]["cache"] is False
    assert "redteam" not in config


def test_five_checks_use_existing_fixtures_without_network(monkeypatch):
    def no_network(*args, **kwargs):
        pytest.fail("Offline checks attempted network")

    monkeypatch.setattr(socket, "socket", no_network)
    monkeypatch.setattr(socket, "create_connection", no_network)
    tests = checks.get_tests()
    assert len(tests) == 5
    for test in tests:
        if "providerOutput" in test:
            output = test["providerOutput"]
        else:
            response = checks.call_api(test["vars"]["case"], {}, {})
            assert response["metadata"]["model_calls"] == 0
            assert "tokenUsage" not in response and "cost" not in response
            output = response["output"]
        assertion = test["assert"][0]
        function = getattr(checks, assertion["value"].split(":")[-1])
        assert function(output, {}) is (assertion["type"] == "python")


@pytest.mark.parametrize(
    "name", ["https://example.com", "../../README.md", "openai:gpt"]
)
def test_provider_does_not_accept_files_urls_or_models(name):
    assert checks.call_api(name, {}, {}) == {"error": "unsupported_software_fixture"}


@pytest.mark.parametrize(
    "output", ["{}", "null", "NaN", '{"claims":[],"claims":[]}', "{"]
)
def test_assertions_fail_closed_for_invalid_output(output):
    assert checks.check_result(output, {}) is False
    assert checks.check_benchmark(output, {}) is False


def test_benchmark_input_is_prepared_source_not_reference():
    tests = checks.get_tests()
    source, _ = checks.case("dev01")
    request = json.loads(tests[3]["vars"]["case"])
    assert request == checks.benchmark.requests(source, "full")[0]
    assert "providerOutput" not in request and "reference" not in request


def test_manifest_tampering_stops_preparation_and_scoring(monkeypatch):
    def reject(*args):
        raise ValueError("test hash mismatch")

    monkeypatch.setattr(checks.freeze, "verify", reject)
    with pytest.raises(ValueError, match="hash mismatch"):
        checks.get_tests()
    with pytest.raises(ValueError, match="hash mismatch"):
        checks.check_benchmark("{}", {})
