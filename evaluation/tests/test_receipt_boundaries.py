"""Offline trust-boundary regressions using only synthetic/author-owned data."""

import json
import subprocess
import sys
import unittest

from test_benchmark import ROOT, b, bound_run, case, summarize, synthetic_prediction


def attempt(**updates):
    value = {
        "attempt_id": "a",
        "provider": "synthetic-provider",
        "model": "synthetic-model",
        "usage_semantics_id": "synthetic-test",
        "usage_source": "provider_reported",
        "provider_request_id": "request-a",
        "status": "success",
        "stage": "interpret",
        "usage": {
            "total_tokens": 100,
            "input_tokens": 60,
            "cached_input_tokens": 40,
            "output_tokens": 40,
            "reasoning_output_tokens": 20,
        },
        "cost": None,
    }
    value.update(updates)
    return value


class ReceiptBoundaryTest(unittest.TestCase):
    def test_distinct_receipts_same_usage_counted_once_each(self):
        a = attempt()
        out = summarize(
            {"attempts": [a, dict(a, attempt_id="b", provider_request_id="request-b")]}
        )
        self.assertEqual(out["total_tokens"], 200)
        self.assertEqual(out["usage_evidence_kind"], "synthetic_fixture_envelope_only")
        self.assertIs(out["real_provider_usage_verified"], False)

    def test_same_provider_request_with_new_attempt_id_rejected(self):
        a = attempt()
        with self.assertRaisesRegex(ValueError, "Duplicate provider request"):
            summarize({"attempts": [a, dict(a, attempt_id="b")]})

    def test_raw_usage_contradiction_rejected(self):
        with bound_run({"attempts": [attempt()]}) as (run, root):
            run["attempts"][0]["usage"]["total_tokens"] = 1
            with self.assertRaisesRegex(ValueError, "mismatch: usage"):
                b.summarize_receipts(run, root)

    def test_raw_usage_type_alias_rejected(self):
        with bound_run({"attempts": [attempt(usage={"total_tokens": 1})]}) as (
            run,
            root,
        ):
            run["attempts"][0]["usage"]["total_tokens"] = True
            with self.assertRaises(ValueError):
                b.summarize_receipts(run, root)

    def test_same_raw_receipt_cannot_be_relabelled_as_second_request(self):
        a = attempt()
        with bound_run(
            {"attempts": [a, dict(a, attempt_id="b", provider_request_id="request-b")]}
        ) as (run, root):
            for key in ("raw_receipt_path", "raw_receipt_sha256"):
                run["attempts"][1][key] = run["attempts"][0][key]
            with self.assertRaisesRegex(
                ValueError, "mismatch: provider_request_id|Duplicate raw receipt"
            ):
                b.summarize_receipts(run, root)

    def test_unknown_attempts_cannot_reuse_same_raw_file(self):
        a = attempt(
            usage_source="unknown", usage={}, status="timeout", provider_request_id=None
        )
        with bound_run({"attempts": [a, dict(a, attempt_id="b")]}) as (run, root):
            for key in ("raw_receipt_path", "raw_receipt_sha256"):
                run["attempts"][1][key] = run["attempts"][0][key]
            with self.assertRaisesRegex(ValueError, "Duplicate raw receipt path"):
                b.summarize_receipts(run, root)

    def test_raw_hash_mismatch_rejected(self):
        with bound_run({"attempts": [attempt()]}) as (run, root):
            (root / run["attempts"][0]["raw_receipt_path"]).write_text("{}")
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                b.summarize_receipts(run, root)

    def test_no_unbound_provider_totals(self):
        with self.assertRaisesRegex(ValueError, "Receipt directory"):
            b.summarize_receipts({"attempts": [attempt()]})

    def test_native_receipt_without_verified_adapter_rejected(self):
        with bound_run({"attempts": [attempt()]}) as (run, root):
            body = b'{"id":"request-a","usage":{"total_tokens":100}}'
            (root / run["attempts"][0]["raw_receipt_path"]).write_bytes(body)
            run["attempts"][0]["raw_receipt_sha256"] = b.digest(body)
            with self.assertRaisesRegex(ValueError, "verified provider adapter"):
                b.summarize_receipts(run, root)

    def test_empty_namespace_rejected(self):
        for field in ("provider", "model", "usage_semantics_id", "provider_request_id"):
            with self.subTest(field=field), self.assertRaises(ValueError):
                summarize({"attempts": [attempt(**{field: None})]})

    def test_failed_unknown_consumption_not_zero(self):
        unknown = attempt(
            usage_source="unknown", usage={}, status="timeout", provider_request_id=None
        )
        result = summarize({"attempts": [unknown]})
        self.assertIsNone(result["total_tokens"])
        self.assertEqual(result["missing_usage_attempts"], ["a"])
        self.assertEqual(result["failed_attempt_count"], 1)
        self.assertIsNone(result["cost_total"])

    def test_declared_cached_and_reasoning_subsets(self):
        for flag, child, parent in (
            ("cached_is_subset_of_input", "cached_input_tokens", "input_tokens"),
            (
                "reasoning_is_subset_of_output",
                "reasoning_output_tokens",
                "output_tokens",
            ),
        ):
            data = attempt(
                usage={child: 20, parent: 10, "total_tokens": 30},
                usage_scope={flag: True},
            )
            with (
                self.subTest(flag=flag),
                self.assertRaisesRegex(ValueError, "Contradictory declared"),
            ):
                summarize({"attempts": [data]})
            data["usage_scope"][flag] = None
            self.assertEqual(summarize({"attempts": [data]})["total_tokens"], 30)

    def test_nonfinite_or_negative_useful_latency_rejected(self):
        for value in (float("nan"), float("inf"), -1, True):
            with self.subTest(value=value), self.assertRaises(ValueError):
                summarize(
                    {
                        "attempts": [attempt()],
                        "time_to_first_useful_persisted_ms": value,
                    }
                )

    def test_cli_accepts_bound_synthetic_receipt_and_rejects_contradiction(self):
        with bound_run({"attempts": [attempt()]}) as (run, root):
            path = root / "run.json"
            command = [
                sys.executable,
                "-B",
                str(ROOT / "scripts/benchmark.py"),
                "receipts",
                str(path),
            ]
            path.write_text(json.dumps(run))
            result = subprocess.run(command, capture_output=True, text=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)["total_tokens"], 100)
            run["attempts"][0]["usage"]["total_tokens"] = 1
            path.write_text(json.dumps(run))
            result = subprocess.run(command, capture_output=True, text=True, timeout=20)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("mismatch: usage", result.stderr)


class JsonBoundaryTest(unittest.TestCase):
    def test_duplicate_keys_and_nonfinite_rejected(self):
        for raw in (
            '{"usage":{"total_tokens":1000,"total_tokens":1}}',
            '{"x":NaN}',
            '{"x":Infinity}',
            '{"x":-Infinity}',
            '{"x":1e309}',
        ):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                b.strict_json_loads(raw)

    def test_cli_invalid_json_keeps_denominator(self):
        with bound_run({"attempts": [attempt()]}) as (_, root):
            path = root / "prediction.json"
            for raw in (
                '{"claims":[',
                '{"claims":[],"pending":[],"clarification":null,"claims":[]}',
                '{"claims":[],"pending":[],"clarification":NaN}',
            ):
                path.write_text(raw)
                command = [
                    sys.executable,
                    "-B",
                    str(ROOT / "scripts/benchmark.py"),
                    "score",
                    str(ROOT / "data/development/dev04.source.json"),
                    str(ROOT / "data/development/dev04.reference.json"),
                    str(path),
                ]
                result = subprocess.run(
                    command, capture_output=True, text=True, timeout=20
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                scored = json.loads(result.stdout)
                self.assertFalse(scored["schema_valid"])
                self.assertEqual(scored["facts"]["correct"], 0)
                self.assertEqual(
                    scored["facts"]["denominator"], len(case("dev04")[1]["facts"])
                )
                self.assertEqual(
                    scored["prediction_parse_error"], "invalid_json_prediction"
                )

    def test_malformed_clarification_preserves_denominator(self):
        source, reference = case("dev04")
        for malformed in ([], {}, None, 1, True):
            prediction = {
                "claims": [],
                "pending": [],
                "clarification": {"field": malformed, "question": "?"},
            }
            result = b.score(source, reference, prediction)
            self.assertFalse(result["schema_valid"])
            self.assertEqual(result["facts"]["denominator"], len(reference["facts"]))

    def test_malformed_evidence_preserves_denominator(self):
        source, reference = case("dev01")
        for malformed in ([], {}, None, 1, True):
            prediction = synthetic_prediction(source, reference)
            prediction["claims"][0]["evidence"][0]["block_id"] = malformed
            result = b.score(source, reference, prediction)
            self.assertFalse(result["schema_valid"])
            self.assertFalse(result["details"][0]["evidence_ok"])
            self.assertEqual(result["facts"]["denominator"], len(reference["facts"]))
            self.assertEqual(result["facts"]["correct"], len(reference["facts"]) - 1)


if __name__ == "__main__":
    unittest.main()
