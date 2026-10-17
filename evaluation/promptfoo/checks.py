"""Promptfoo plumbing over existing software fixtures; never calls a model."""

import importlib.util
import json
from copy import deepcopy
from pathlib import Path

from aulalista_api import planning_fixture, water_fixture
from aulalista_api.planning_result import RESULT_ADAPTER


def _load(relative):
    path = Path(__file__).resolve().parents[1] / relative
    spec = importlib.util.spec_from_file_location(path.stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


benchmark = _load("scripts/benchmark.py")
freeze = _load("scripts/freeze.py")
self_tests = _load("tests/test_benchmark.py")
case, synthetic_prediction = self_tests.case, self_tests.synthetic_prediction


def call_api(prompt, options, context):
    if prompt == "timing-example-v1":
        fixture = planning_fixture
    elif prompt == water_fixture.FIXTURE_CONTEXT:
        fixture = water_fixture
    else:
        return {"error": "unsupported_software_fixture"}
    result = planning_fixture.generate(
        prompt, fixture.SUPPORTED_PROMPT, fixture.FIXTURE_SOURCE
    )
    return {
        "output": json.dumps(result, ensure_ascii=False),
        "metadata": {"evidence_kind": "software_fixture", "model_calls": 0},
    }


def check_result(output, context):
    try:
        RESULT_ADAPTER.validate_python(
            benchmark.strict_json_loads(output) if isinstance(output, str) else output
        )
    except (ValueError, TypeError):
        return False
    return True


def check_benchmark(output, context):
    freeze.verify(
        benchmark.ROOT, benchmark.read(benchmark.ROOT / "manifests/input.manifest.json")
    )
    source, reference = case("dev01")
    try:
        prediction = (
            benchmark.strict_json_loads(output) if isinstance(output, str) else output
        )
        report = benchmark.score(source, reference, prediction)
    except (ValueError, TypeError):
        return False
    return (
        report["schema_valid"]
        and report["facts"]["correct"] == report["facts"]["denominator"]
        and report["ambiguity"]["detected"] == report["ambiguity"]["denominator"]
        and not report["unexpected_claims"]
        and not report["ambiguity"]["unexpected_fields"]
    )


def get_tests():
    """Reuse reference-derived self-tests; these are not predictions or a corpus."""
    freeze.verify(
        benchmark.ROOT, benchmark.read(benchmark.ROOT / "manifests/input.manifest.json")
    )
    tests = [
        {
            "description": f"Existing result contract: {name}",
            "vars": {"case": name},
            "assert": [{"type": "python", "value": "file://checks.py:check_result"}],
        }
        for name in ("timing-example-v1", water_fixture.FIXTURE_CONTEXT)
    ]
    invalid = water_fixture.generate(
        water_fixture.SUPPORTED_PROMPT, water_fixture.FIXTURE_SOURCE
    )
    invalid["activities"][0]["minutes"] = "5"
    tests.append(
        {
            "description": "Negative software mutation: numeric text must be rejected",
            "vars": {"case": "precomputed-invalid-result"},
            "providerOutput": invalid,
            "assert": [
                {"type": "not-python", "value": "file://checks.py:check_result"}
            ],
        }
    )
    source, reference = case("dev01")
    request = benchmark.requests(source, "full")[0]
    prediction = synthetic_prediction(source, reference)
    fabricated = deepcopy(prediction)
    fabricated["claims"][0]["evidence"][0]["quote"] = "not-in-source-software-mutation"
    for label, output, kind in (
        ("reference-derived self-test", prediction, "python"),
        ("fabricated quote rejected", fabricated, "not-python"),
    ):
        tests.append(
            {
                "description": f"Existing scorer plumbing only: {label}",
                "vars": {"case": json.dumps(request, ensure_ascii=False)},
                "providerOutput": output,
                "assert": [{"type": kind, "value": "file://checks.py:check_benchmark"}],
            }
        )
    return tests
