"""Own synthetic streams and sanitized fixtures from a verified complete stream."""

import copy
import hashlib
import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "codex_jsonl", ROOT / "scripts/codex_jsonl.py"
)
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)
OBSERVED = json.loads(
    (ROOT / "tests/fixtures/codex_turn_completed.observed.json").read_text()
)


def events(thread="synthetic-thread"):
    return [
        {"type": "thread.started", "thread_id": thread},
        {"type": "turn.started"},
        {
            "type": "item.completed",
            "item": {"type": "agent_message", "text": "Synthetic test only"},
        },
        {
            "type": "turn.completed",
            "usage": {
                "input_tokens": 100,
                "cached_input_tokens": 60,
                "output_tokens": 10,
                "reasoning_output_tokens": 2,
            },
        },
    ]


def entry(stream=None, attempt="synthetic-attempt", thread="synthetic-thread"):
    raw = (
        "\n".join(json.dumps(x) for x in (events(thread) if stream is None else stream))
        + "\n"
    ).encode()
    return {
        "raw": raw,
        "invocation": {
            "run_id": "synthetic-run",
            "attempt_id": attempt,
            "model_requested": "synthetic-model",
            "cli_version": "synthetic-build",
            "raw_sha256": hashlib.sha256(raw).hexdigest(),
        },
    }


def normalize(record):
    return a.normalize_jsonl(record["raw"], record["invocation"])


class CodexJsonlTest(unittest.TestCase):
    def test_observed_usage_fragment_preserved_without_official_total(self):
        usage = a.usage_from_event(OBSERVED)
        self.assertEqual(usage["input_tokens"], 13738)
        self.assertEqual(usage["cached_input_tokens"], 12032)
        self.assertEqual(usage["cache_write_input_tokens"], 0)
        self.assertEqual(usage["output_tokens"], 121)
        self.assertEqual(usage["reasoning_output_tokens"], 0)
        self.assertIsNone(usage["total_tokens"])

    def test_observed_fragment_is_not_a_complete_receipt(self):
        with self.assertRaisesRegex(ValueError, "Orphan|Missing thread"):
            normalize(entry([OBSERVED]))

    def test_sanitized_observed_stream_preserves_warning_and_usage(self):
        raw = (ROOT / "tests/fixtures/codex_stream.sanitized.jsonl").read_bytes()
        record = entry()
        record["raw"] = raw
        record["invocation"]["raw_sha256"] = hashlib.sha256(raw).hexdigest()
        result = normalize(record)
        self.assertEqual(result["thread_id"], "synthetic-sanitized-thread-001")
        self.assertEqual(result["turns"][0]["status"], "success")
        self.assertEqual(result["turns"][0]["usage"], a.usage_from_event(OBSERVED))
        self.assertEqual(result["context_integrity"], "truncated")
        self.assertFalse(result["context_comparable"])
        self.assertIsNone(result["model_effective"])
        self.assertIsNone(result["native_total_tokens"])

    def test_synthetic_stream_does_not_verify_requested_model(self):
        record = entry()
        record["invocation"]["model_effective"] = "a-claim-without-evidence"
        result = normalize(record)
        self.assertTrue(result["stream_structurally_complete"])
        self.assertEqual(result["model_requested"], "synthetic-model")
        self.assertIsNone(result["model_effective"])
        self.assertIsNone(result["provider_request_id"])
        self.assertIsNone(result["native_total_tokens"])
        self.assertFalse(result["effective_model_verified"])
        self.assertFalse(result["provider_usage_coverage_verified"])
        self.assertFalse(result["ready_for_model_comparison"])
        self.assertNotIn("Synthetic test only", json.dumps(result))

    def test_process_metadata_does_not_rewrite_native_turn_outcome(self):
        record = entry()
        record["invocation"].update(
            exit_code=1, wall_latency_ms=123.4, reasoning_effort_requested="low"
        )
        result = normalize(record)
        self.assertFalse(result["process_success"])
        self.assertEqual(result["turns"][0]["status"], "success")
        self.assertEqual(result["process_wall_latency_ms_declared"], 123.4)
        self.assertEqual(result["reasoning_effort_requested"], "low")
        self.assertIsNone(result["model_effective"])

    def test_subsets_are_unknown_without_documented_semantics(self):
        event = {
            "type": "turn.completed",
            "usage": {
                "input_tokens": 1,
                "cached_input_tokens": 2,
                "output_tokens": 1,
                "reasoning_output_tokens": 2,
            },
        }
        self.assertEqual(a.usage_from_event(event)["cached_input_tokens"], 2)
        for field in ("cached_is_subset_of_input", "reasoning_is_subset_of_output"):
            with (
                self.subTest(field=field),
                self.assertRaisesRegex(ValueError, "Contradictory documented"),
            ):
                a.usage_from_event(
                    event, {field: True, "evidence": "synthetic semantics fixture"}
                )
            with (
                self.subTest(field=field),
                self.assertRaisesRegex(ValueError, "semantics evidence"),
            ):
                a.usage_from_event(event, {field: True})

    def test_declared_subsets_do_not_add_cache_or_reasoning(self):
        usage = a.usage_from_event(
            OBSERVED,
            {
                "cached_is_subset_of_input": True,
                "reasoning_is_subset_of_output": True,
                "evidence": "synthetic declaration for conditional control, not real documentation",
            },
        )
        self.assertIsNone(usage["total_tokens"])
        self.assertEqual(usage["input_tokens"], OBSERVED["usage"]["input_tokens"])

    def test_official_total_if_present_is_retained_not_rederived(self):
        event = copy.deepcopy(OBSERVED)
        event["usage"]["total_tokens"] = 99999
        self.assertEqual(a.usage_from_event(event)["total_tokens"], 99999)

    def test_invalid_native_token_types_rejected(self):
        for value in (True, -1, 1.5, "100", [], {}, float("nan")):
            event = {"type": "turn.completed", "usage": {"input_tokens": value}}
            with self.subTest(value=value), self.assertRaises(ValueError):
                a.usage_from_event(event)

    def test_unknown_usage_field_is_not_silently_dropped(self):
        with self.assertRaisesRegex(ValueError, "Unsupported native usage field"):
            a.usage_from_event(
                {"type": "turn.completed", "usage": {"new_unverified_tokens": 10}}
            )

    def test_context_budget_warning_does_not_convert_terminal_success_to_failure(self):
        data = events()
        data.insert(
            2,
            {
                "type": "item.completed",
                "item": {
                    "id": "synthetic-warning",
                    "type": "error",
                    "message": "Exceeded skills context budget. Synthetic test warning.",
                },
            },
        )
        result = normalize(entry(data))
        self.assertEqual(result["turns"][0]["status"], "success")
        self.assertTrue(result["stream_structurally_complete"])
        self.assertEqual(result["errors"], [])
        self.assertEqual(
            result["warnings"], [{"event_line": 3, "kind": "context_budget_truncated"}]
        )
        self.assertFalse(result["context_comparable"])
        self.assertEqual(result["context_integrity"], "truncated")
        self.assertEqual(result["turns"][0]["usage"]["input_tokens"], 100)

    def test_other_item_error_is_preserved_as_warning_without_inventing_kind(self):
        data = events()
        data.insert(
            2,
            {
                "type": "item.completed",
                "item": {"type": "error", "message": "Synthetic warning"},
            },
        )
        result = normalize(entry(data))
        self.assertEqual(result["warnings"][0]["kind"], "native_error_item")
        self.assertEqual(result["context_integrity"], "warning_present")
        self.assertFalse(result["context_comparable"])

    def test_failed_turn_keeps_reported_usage(self):
        data = events()
        data[-1]["type"] = "turn.failed"
        result = normalize(entry(data))
        self.assertEqual(result["turns"][0]["status"], "failed")
        self.assertEqual(result["turns"][0]["usage"]["input_tokens"], 100)

    def test_failed_turn_missing_usage_stays_unknown(self):
        data = events()
        data[-1] = {"type": "turn.failed", "error": {"message": "synthetic failure"}}
        result = normalize(entry(data))
        self.assertTrue(all(v is None for v in result["turns"][0]["usage"].values()))

    def test_unterminated_turn_is_incomplete_not_free(self):
        result = normalize(entry(events()[:-1]))
        self.assertFalse(result["stream_structurally_complete"])
        self.assertEqual(result["turns"][0]["status"], "incomplete")
        self.assertTrue(all(v is None for v in result["turns"][0]["usage"].values()))

    def test_duplicate_terminal_is_rejected(self):
        data = events()
        data.append(copy.deepcopy(data[-1]))
        with self.assertRaisesRegex(ValueError, "duplicate terminal"):
            normalize(entry(data))

    def test_overlapping_turn_is_rejected(self):
        data = events()
        data.insert(2, {"type": "turn.started"})
        with self.assertRaisesRegex(ValueError, "overlapping turn"):
            normalize(entry(data))

    def test_sequential_turns_identical_usage_are_not_deduplicated(self):
        data = events()
        data.extend(copy.deepcopy(data[1:]))
        result = normalize(entry(data))
        self.assertEqual(len(result["turns"]), 2)
        self.assertEqual(result["turns"][0]["usage"], result["turns"][1]["usage"])
        self.assertIsNone(result["native_total_tokens"])

    def test_native_turn_identity_mismatch_is_rejected(self):
        data = events()
        data[1]["turn_id"] = "synthetic-a"
        data[-1]["turn_id"] = "synthetic-b"
        with self.assertRaisesRegex(ValueError, "Mismatched native turn"):
            normalize(entry(data))

    def test_usage_on_item_event_is_not_omitted(self):
        data = events()
        data[2]["usage"] = {"input_tokens": 5}
        with self.assertRaisesRegex(ValueError, "Usage outside"):
            normalize(entry(data))

    def test_unknown_event_rejected(self):
        data = events()
        data.insert(2, {"type": "unreviewed.new_event"})
        with self.assertRaisesRegex(ValueError, "Unsupported JSONL event"):
            normalize(entry(data))

    def test_duplicate_json_keys_and_truncated_json_rejected(self):
        for body in (
            b'{"type":"thread.started","thread_id":"a","thread_id":"b"}\n',
            b'{"type":',
        ):
            record = entry()
            record["raw"] = body
            record["invocation"]["raw_sha256"] = hashlib.sha256(body).hexdigest()
            with self.subTest(body=body), self.assertRaises(ValueError):
                normalize(record)

    def test_hash_mismatch_rejected(self):
        record = entry()
        record["raw"] += b"\n"
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            normalize(record)

    def test_same_raw_stream_with_new_attempt_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "Duplicate raw JSONL"):
            a.normalize_attempts([entry(), entry(attempt="another-attempt")])

    def test_same_thread_with_different_bytes_requires_resume_contract(self):
        second = entry(attempt="another-attempt")
        second["raw"] += b"\n"
        second["invocation"]["raw_sha256"] = hashlib.sha256(second["raw"]).hexdigest()
        with self.assertRaisesRegex(ValueError, "Thread reuse"):
            a.normalize_attempts([entry(), second])

    def test_distinct_threads_and_attempts_allowed(self):
        result = a.normalize_attempts(
            [
                entry(),
                entry(attempt="another-attempt", thread="another-synthetic-thread"),
            ]
        )
        self.assertEqual(len(result), 2)
        self.assertTrue(all(not r["ready_for_model_comparison"] for r in result))


if __name__ == "__main__":
    unittest.main()
