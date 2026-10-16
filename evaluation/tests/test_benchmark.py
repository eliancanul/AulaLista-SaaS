import copy
import importlib.util
import json
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "benchmark", ROOT / "scripts/benchmark.py"
)
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)


@contextmanager
def bound_run(run):
    """Author-owned synthetic receipts, never actual provider evidence."""
    run = copy.deepcopy(run)
    with tempfile.TemporaryDirectory(prefix="benchmark-receipts-") as td:
        root = Path(td)
        for index, attempt in enumerate(run["attempts"]):
            if attempt.get("usage_source") == "provider_reported":
                attempt.setdefault(
                    "provider_request_id", "fixture-" + attempt["attempt_id"]
                )
                raw = {"schema": "aulalista-synthetic-receipt.v1", "synthetic": True}
                raw.update(
                    {
                        key: attempt.get(key)
                        for key in (
                            "provider",
                            "model",
                            "usage_semantics_id",
                            "provider_request_id",
                            "usage",
                            "cost",
                        )
                    }
                )
            else:
                raw = {"schema": "synthetic-local-failure.v1", "synthetic": True}
            body = json.dumps(raw, allow_nan=False).encode()
            attempt["raw_receipt_path"] = f"receipt-{index}.json"
            attempt["raw_receipt_sha256"] = b.digest(body)
            (root / attempt["raw_receipt_path"]).write_bytes(body)
        yield run, root


def summarize(run):
    with bound_run(run) as (bound, root):
        return b.summarize_receipts(bound, root)


def case(name):
    split = "development" if name.startswith("dev") else "validation"
    return (
        b.read(ROOT / "data" / split / f"{name}.source.json"),
        b.read(ROOT / "data" / split / f"{name}.reference.json"),
    )


def synthetic_prediction(source, reference):
    blocks = {x["id"]: x for x in source["blocks"]}

    def evidence(ids):
        return [{"block_id": i, "quote": blocks[i]["text"]} for i in ids]

    return {
        "claims": [
            {
                "subject": f["subject"],
                "predicate": f["predicate"],
                "value": f["value"],
                "evidence": evidence(f["evidence_blocks"]),
            }
            for f in reference["facts"]
        ],
        "pending": [
            {
                "field": p["field"],
                "alternatives": p["alternatives"],
                "evidence": evidence(p["evidence_blocks"]),
            }
            for p in reference["pending"]
        ],
        "clarification": None,
    }


class BenchmarkTest(unittest.TestCase):
    def test_all_synthetic_references_resolve(self):
        families, planning = {}, {}
        for path in (ROOT / "data").glob("*/*.source.json"):
            s = b.validate_source(b.read(path))
            r = b.read(path.with_name(path.name.replace("source", "reference")))
            for key, store in ((s["family"], families), (s["planning_id"], planning)):
                self.assertIn(store.setdefault(key, s["split"]), (s["split"],))
            p = synthetic_prediction(s, r)
            score = b.score(s, r, p)
            self.assertTrue(score["schema_valid"])
            self.assertEqual(score["facts"]["correct"], score["facts"]["denominator"])
            self.assertEqual(
                score["ambiguity"]["detected"], score["ambiguity"]["denominator"]
            )

    def test_dedup_keeps_distinct_activities_and_aliases(self):
        s, _ = case("dev01")
        blocks = b.deduplicate(s["blocks"])
        self.assertEqual(len(blocks), len(s["blocks"]) - 2)
        self.assertEqual(len(blocks[0]["aliases"]), 3)
        self.assertTrue({"b1", "b2"} <= {x["id"] for x in blocks})
        s["blocks"].append(dict(s["blocks"][1], id="b3"))
        self.assertIn("b3", {x["id"] for x in b.deduplicate(s["blocks"])})

    def test_dedup_requires_all_metadata_except_id_and_page(self):
        for kind in ("running_header", "running_footer"):
            first = dict(
                id="h1",
                page=1,
                kind=kind,
                text="Repeated title",
                unit=None,
                dedup_safe=True,
                dependencies=["body"],
                metadata={"reviewed": True, "nested": {"level": 1}},
            )
            variants = [
                dict(first, dependencies=["kit"]),
                {k: v for k, v in first.items() if k != "dependencies"},
                dict(first, dependencies=[]),
                dict(first, dependencies=["body", "kit"]),
                dict(first, extra="meaningful"),
                dict(first, metadata={"reviewed": 1, "nested": {"level": 1}}),
                dict(first, metadata={"reviewed": True, "nested": {"level": 1.0}}),
                dict(first, metadata=None),
                dict(first, text="Repeated title "),
                dict(first, unit="U2"),
                dict(first, dedup_safe=False),
            ]
            for index, other in enumerate(variants):
                other = dict(other, id="h2", page=2)
                third = dict(first, id="h3", page=3)
                for reverse in (False, True):
                    with self.subTest(kind=kind, variant=index, reverse=reverse):
                        blocks = [first, other, third]
                        if reverse:
                            blocks.reverse()
                        before = copy.deepcopy(blocks)
                        result = b.deduplicate(blocks)
                        self.assertEqual(len(result), 2)
                        by_alias = {
                            a["block_id"]: block
                            for block in result
                            for a in block["aliases"]
                        }
                        for original in blocks:
                            actual = by_alias[original["id"]]
                            self.assertEqual(
                                {
                                    k: v
                                    for k, v in actual.items()
                                    if k not in {"id", "page", "aliases"}
                                },
                                {
                                    k: v
                                    for k, v in original.items()
                                    if k not in {"id", "page"}
                                },
                            )
                        self.assertEqual(blocks, before)

    def test_dedup_equivalent_metadata_keeps_all_provenance(self):
        first = dict(
            id="h1",
            page=1,
            kind="running_footer",
            text="Repeated title",
            unit=None,
            dedup_safe=True,
            dependencies=["body", "kit"],
            metadata={"a": 1, "b": {"c": False, "d": None}},
        )
        second = dict(
            first, id="h2", page=7, metadata={"b": {"d": None, "c": False}, "a": 1}
        )
        third = dict(first, id="h3", page=12)
        for blocks in ([first, second, third], [third, second, first]):
            result = b.deduplicate(blocks)
            self.assertEqual(len(result), 1)
            self.assertEqual(
                result[0]["aliases"],
                [{"block_id": x["id"], "page": x["page"]} for x in blocks],
            )
        reversed_dependencies = dict(second, dependencies=["kit", "body"])
        self.assertEqual(len(b.deduplicate([first, reversed_dependencies])), 2)
        missing_metadata = {k: v for k, v in first.items() if k != "metadata"}
        self.assertEqual(
            len(b.deduplicate([missing_metadata, dict(second, metadata=None)])), 2
        )

    def test_requests_preserve_transitive_dependencies_and_alias_targets(self):
        source = dict(
            synthetic=True,
            split="development",
            id="relations",
            planning_id="synthetic-plan",
            version=1,
            units=["U1", "U2"],
            subjects={"task": "U1"},
        )
        header = dict(
            id="h1",
            page=1,
            kind="running_header",
            text="Title",
            unit=None,
            dedup_safe=True,
            dependencies=["body"],
        )
        body = dict(
            id="body",
            page=1,
            kind="activity",
            text="Task",
            unit="U1",
            dependencies=["h3"],
        )
        kit = dict(
            id="kit",
            page=2,
            kind="context",
            text="Materials",
            unit="U2",
            dependencies=["tail"],
        )
        tail = dict(id="tail", page=3, kind="context", text="Details", unit="U2")
        blocks = [
            header,
            dict(header, id="h2", page=2, dependencies=["kit"]),
            dict(header, id="h3", page=3),
            body,
            kit,
            tail,
        ]
        for reverse in (False, True):
            source["blocks"] = list(reversed(blocks)) if reverse else blocks
            before = copy.deepcopy(source)
            for variant in ("full", "dedup", "segmented"):
                with self.subTest(reverse=reverse, variant=variant):
                    prepared = b.requests(source, variant)
                    payload = prepared[0]["input"]["blocks"]
                    by_alias = {
                        alias["block_id"]: block
                        for block in payload
                        for alias in block.get("aliases", [{"block_id": block["id"]}])
                    }
                    self.assertEqual(set(by_alias), {x["id"] for x in blocks})
                    for original in blocks:
                        self.assertEqual(
                            by_alias[original["id"]].get("dependencies", []),
                            original.get("dependencies", []),
                        )
                    self.assertEqual(len(payload), 6 if variant == "full" else 5)
            self.assertEqual(source, before)

        missing_target = copy.deepcopy(source)
        missing_target["blocks"] = [
            block for block in source["blocks"] if block["id"] != "tail"
        ]
        for variant in ("full", "dedup", "segmented"):
            with self.subTest(missing_target=True, variant=variant):
                with self.assertRaises(ValueError):
                    b.requests(missing_target, variant)

    def test_segment_keeps_cross_unit_dependency(self):
        s, _ = case("dev03")
        self.assertIn("kit", {x["id"] for x in b.select_blocks(s, "U1")})
        requests = b.requests(s, "segmented", question_remaining=0)
        self.assertEqual(len(requests), 2)
        self.assertTrue(
            all(x["input"]["clarification_budget_remaining"] == 0 for x in requests)
        )
        self.assertEqual(requests[0]["input"]["requested_subjects"], ["A1"])

    def test_no_reference_or_fake_tokens_in_requests(self):
        s, _ = case("dev01")
        encoded = json.dumps(b.requests(s, "dedup"))
        self.assertNotIn("reference_kind", encoded)
        self.assertNotIn("total_tokens", encoded)

    def test_holdout_and_nonsynthetic_rejected(self):
        s, _ = case("dev01")
        s["split"] = "holdout"
        with self.assertRaises(ValueError):
            b.requests(s, "full")
        s["split"], s["synthetic"] = "development", False
        with self.assertRaises(ValueError):
            b.requests(s, "full")

    def test_wrong_group_and_fabricated_quote_fail(self):
        s, r = case("dev01")
        p = synthetic_prediction(s, r)
        p["claims"][1]["value"] = "Grupo Sol"
        p["claims"][0]["evidence"][0]["quote"] = "inventado"
        result = b.score(s, r, p)
        self.assertEqual(
            result["critical"]["correct"], result["critical"]["denominator"] - 2
        )

    def test_duplicates_extras_and_missing_not_hidden(self):
        s, r = case("dev01")
        p = synthetic_prediction(s, r)
        p["claims"].append(copy.deepcopy(p["claims"][0]))
        p["claims"].append(dict(p["claims"][0], subject="invented"))
        p["claims"].pop(1)
        result = b.score(s, r, p)
        self.assertEqual(len(result["duplicate_claims"]), 1)
        self.assertEqual(len(result["unexpected_claims"]), 1)
        self.assertEqual(result["facts"]["denominator"], len(r["facts"]))

    def test_duplicate_claims_score_every_occurrence_without_order_bias(self):
        s, r = case("dev01")
        original = synthetic_prediction(s, r)
        claim = original["claims"][0]
        wrong_value = dict(claim, value="Contradictory activity")
        wrong_evidence = dict(claim, evidence=[{"block_id": "b1", "quote": "invented"}])
        shorter_quote = copy.deepcopy(claim)
        shorter_quote["evidence"][0]["quote"] = claim["evidence"][0]["quote"][:10]
        cases = [
            ("identical", [claim, copy.deepcopy(claim)], True, True),
            ("contradictory", [claim, wrong_value], False, True),
            ("third occurrence", [claim, wrong_value, claim], False, True),
            ("invalid citation", [claim, wrong_evidence], True, False),
            ("corroborating citation", [claim, shorter_quote], True, True),
        ]
        for name, duplicates, value_ok, evidence_ok in cases:
            results = []
            for reverse in (False, True):
                with self.subTest(case=name, reverse=reverse):
                    p = copy.deepcopy(original)
                    p["claims"] = (
                        list(reversed(duplicates)) if reverse else list(duplicates)
                    )
                    p["claims"] += original["claims"][1:]
                    result = b.score(s, r, p)
                    results.append(result)
                    row = result["details"][0]
                    self.assertEqual(row["value_ok"], value_ok)
                    self.assertEqual(row["evidence_ok"], evidence_ok)
                    self.assertEqual(row["joint_ok"], value_ok and evidence_ok)
                    loss = int(not (value_ok and evidence_ok))
                    self.assertEqual(result["facts"]["correct"], len(r["facts"]) - loss)
                    self.assertEqual(result["facts"]["denominator"], len(r["facts"]))
                    self.assertEqual(
                        result["critical"]["correct"],
                        result["critical"]["denominator"] - loss,
                    )
                    self.assertEqual(
                        len(result["duplicate_claims"]), len(duplicates) - 1
                    )
                    self.assertTrue(result["schema_valid"])
                    self.assertTrue(result["manual_semantic_review_required"])
                    self.assertFalse(result["teacher_evidence"])
            self.assertEqual(results[0], results[1])

    def test_malformed_pending_invalid(self):
        s, r = case("dev04")
        p = synthetic_prediction(s, r)
        p["pending"].append({"field": [], "alternatives": []})
        self.assertFalse(b.score(s, r, p)["schema_valid"])

    def test_empty_output_is_not_success(self):
        s, r = case("dev01")
        result = b.score(s, r, {})
        self.assertFalse(result["schema_valid"])
        self.assertEqual(result["facts"]["correct"], 0)
        self.assertEqual(result["facts"]["denominator"], len(r["facts"]))

    def test_question_budget_survives_retry_new_version_new_file(self):
        base = {"trial_id": "trial", "planning_id": "stable-plan", "question_id": "q1"}
        events = [
            dict(base, event="presented", version=1, file="a"),
            dict(base, event="restored", version=2, file="b"),
            dict(base, event="answered", version=2, file="b"),
        ]
        self.assertTrue(b.audit_questions(events)["valid"])
        events.append(
            dict(base, event="presented", question_id="q2", version=3, file="c")
        )
        self.assertFalse(b.audit_questions(events)["valid"])

    def test_repair_rejects_reference_leak(self):
        s, _ = case("dev03")
        with self.assertRaises(ValueError):
            b.repair_request(
                s, "localized_repair", ["U1"], {}, [{"origin": "gold_reference"}], 0
            )
        result = b.repair_request(
            s,
            "localized_repair",
            ["U1"],
            {},
            [{"origin": "schema", "error": "missing claims"}],
            0,
        )
        self.assertIn("kit", {x["id"] for x in result["input"]["blocks"]})
        self.assertEqual(result["input"]["clarification_budget_remaining"], 0)

    def test_receipts_include_failed_attempts_and_no_double_count(self):
        attempt = {
            "attempt_id": "a",
            "provider": "synthetic-provider",
            "model": "synthetic-model",
            "usage_semantics_id": "test",
            "usage_source": "provider_reported",
            "status": "success",
            "stage": "interpret",
            "latency_ms": 30,
            "usage": {
                "total_tokens": 100,
                "input_tokens": 60,
                "cached_input_tokens": 40,
                "output_tokens": 40,
                "reasoning_output_tokens": 20,
            },
            "cost": {"amount": 0.01, "currency": "USD"},
        }
        run = {
            "attempts": [attempt, dict(attempt, attempt_id="b", status="failed")],
            "question_events": [],
        }
        result = summarize(run)
        self.assertEqual(result["total_tokens"], 200)
        self.assertEqual(result["failed_attempt_count"], 1)
        self.assertEqual(
            result["usage_components_separate_not_additive"]["cached_input_tokens"][
                "reported_sum"
            ],
            80,
        )
        self.assertIsNone(result["weighted_score"])
        run["attempts"][1] = dict(
            attempt,
            attempt_id="b",
            usage={"total_tokens": None},
            status="failed",
            cost=None,
        )
        result = summarize(run)
        self.assertIsNone(result["total_tokens"])
        self.assertEqual(result["known_token_subtotal"], 100)
        self.assertIsNone(result["cost_total"])

    def test_incompatible_units_not_summed(self):
        a = {
            "attempt_id": "a",
            "provider": "p",
            "model": "m1",
            "usage_semantics_id": "s",
            "usage_source": "provider_reported",
            "status": "success",
            "stage": "interpret",
            "usage": {"total_tokens": 10},
            "cost": None,
        }
        result = summarize({"attempts": [a, dict(a, attempt_id="b", model="m2")]})
        self.assertFalse(result["native_usage_comparable"])
        self.assertIsNone(result["total_tokens"])
        self.assertIsNone(result["known_token_subtotal"])

    def test_duplicate_attempt_is_rejected(self):
        with self.assertRaises(ValueError):
            summarize({"attempts": [{"attempt_id": "same"}, {"attempt_id": "same"}]})


if __name__ == "__main__":
    unittest.main()
