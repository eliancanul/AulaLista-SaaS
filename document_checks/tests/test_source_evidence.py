"""New synthetic software-only evidence fixtures. No OCR/semantic accuracy claim."""

import copy
import hashlib
import json
import unittest

from test_source_integrity import fixture, make

from aulalista_api.source_evidence import (
    VerificationContext,
    VerifiedBatch,
    candidates,
    reference,
)
from aulalista_api.source_integrity import IntegrityError

OWNER = "00000000-0000-0000-0000-000000000004"


def context():
    parts = fixture()
    pages = parts[3][0]["pages"]
    pages[0]["text"] = "Indicador: Árbol azul. Material: Papel. Tiempo: 60. Otro: 8."
    pages[0]["units"] = [
        {
            "id": "i1",
            "start": 0,
            "end": 21,
            "role": "indicator",
            "metadata": {"context_id": "s1"},
            "dependencies": [],
        },
        {
            "id": "m1",
            "start": 22,
            "end": 38,
            "role": "material",
            "metadata": {"context_id": "s1"},
            "dependencies": [],
        },
        {
            "id": "t1",
            "start": 39,
            "end": 50,
            "role": "duration",
            "metadata": {"context_id": "s1"},
            "dependencies": [],
        },
    ]
    pages[2]["text"] = "Indicador: Árbol verde. Tiempo: 60. Paráfrasis no literal."
    pages[2]["units"] = [
        {
            "id": "i2",
            "start": 0,
            "end": 22,
            "role": "indicator",
            "metadata": {"context_id": "s2"},
            "dependencies": [],
        },
        {
            "id": "t2",
            "start": 23,
            "end": 34,
            "role": "duration",
            "metadata": {"context_id": "s2"},
            "dependencies": [],
        },
    ]
    snapshot = make(parts)
    targets = [
        {
            "id": "s1.indicator",
            "role": "indicator",
            "context_id": "s1",
            "representation_id": "raw",
        },
        {
            "id": "s2.indicator",
            "role": "indicator",
            "context_id": "s2",
            "representation_id": "raw",
        },
        {
            "id": "s1.duration",
            "role": "duration",
            "context_id": "s1",
            "representation_id": "raw",
        },
        {
            "id": "s2.duration",
            "role": "duration",
            "context_id": "s2",
            "representation_id": "raw",
        },
        {
            "id": "quotation",
            "role": None,
            "context_id": None,
            "representation_id": "raw",
        },
        {"id": "total", "role": None, "context_id": None, "representation_id": "raw"},
    ]
    return VerificationContext.create(
        snapshot,
        owner_id=OWNER,
        scope_id=snapshot.data["identity"]["scope_id"],
        expected_snapshot_sha256=snapshot.sha256,
        targets=targets,
    )


def cite(ctx, target, page, text):
    source = ctx.snapshot.data["representations"][0]["pages"][page - 1]["text"]
    start = source.index(text)
    return reference(ctx, target, page, start, start + len(text))


def literal(ctx, target="s1.indicator", value="Árbol azul", page=1, quote="Árbol azul"):
    return {
        "target": target,
        "kind": "literal",
        "value": value,
        "evidence": [cite(ctx, target, page, quote)],
    }


def outcome(ctx, claims, target="s1.indicator"):
    result = VerifiedBatch.from_claims(ctx, claims).project()
    return next(r for r in result["results"] if r["target"] == target)


class EvidenceTests(unittest.TestCase):
    def test_exact_literal_and_list_each_require_contiguous_support(self):
        ctx = context()
        self.assertEqual(outcome(ctx, [literal(ctx)])["state"], "literal")
        c = literal(ctx, value=["Árbol", "azul"])
        self.assertEqual(outcome(ctx, [c])["state"], "literal")
        c["value"].append("Papel")
        self.assertEqual(outcome(ctx, [c])["state"], "unknown")
        c = literal(ctx, value="Papel")
        self.assertEqual(outcome(ctx, [c])["state"], "unknown")

    def test_wrong_page_hash_scope_owner_version_offsets_and_empty_quote(self):
        ctx = context()
        changes = {
            "page": 3,
            "owner_id": "foreign-owner",
            "scope_id": "foreign-scope",
            "source_id": "foreign-source",
            "version_id": "foreign-version",
            "number": 2,
            "original_sha256": "0" * 64,
            "snapshot_sha256": "0" * 64,
            "representation_sha256": "0" * 64,
            "representation_id": "missing",
            "start": -1,
            "end": 9999,
            "quote": "",
        }
        for key, value in changes.items():
            claim = literal(ctx)
            claim["evidence"][0][key] = value
            with self.subTest(key=key):
                self.assertEqual(outcome(ctx, [claim])["state"], "unknown")

    def test_noncontiguous_cross_page_and_nearby_value_do_not_pass(self):
        ctx = context()
        claim = literal(
            ctx,
            target="quotation",
            value="azul Papel",
            quote="Árbol azul. Material: Papel",
        )
        self.assertEqual(outcome(ctx, [claim], "quotation")["state"], "unknown")
        claim["value"] = "azul verde"
        claim["evidence"] = [
            cite(ctx, "quotation", 1, "azul"),
            cite(ctx, "quotation", 3, "verde"),
        ]
        self.assertEqual(outcome(ctx, [claim], "quotation")["state"], "unknown")
        claim["evidence"][0]["quote"] = "azul…Papel"
        self.assertEqual(outcome(ctx, [claim], "quotation")["state"], "unknown")

    def test_role_context_and_model_declared_role_cannot_create_support(self):
        ctx = context()
        claim = literal(ctx, value="Papel", quote="Papel")
        claim["declared_role"] = "indicator"
        self.assertEqual(outcome(ctx, [claim])["state"], "unknown")
        claim = literal(ctx, value="Árbol verde", page=3, quote="Árbol verde")
        self.assertEqual(outcome(ctx, [claim])["state"], "unknown")
        # Target role is known but no source unit covers this quote.
        claim = literal(ctx, value="8", quote="8")
        self.assertEqual(outcome(ctx, [claim])["state"], "unknown")

    def test_exact_unicode_punctuation_order_and_whitespace(self):
        ctx = context()
        for value in [
            "Arbol azul",
            "A\u0301rbol azul",
            "Árbоl azul",
            "Árbol, azul",
            "azul Árbol",
            "Árbol\nazul",
        ]:
            with self.subTest(value=value):
                self.assertEqual(
                    outcome(ctx, [literal(ctx, value=value)])["state"], "unknown"
                )
        found = candidates(ctx, "s1.indicator", "arbol azul")
        self.assertTrue(found)
        self.assertTrue(all(x["literal_verified"] is False for x in found))

    def test_inference_with_evidence_remains_inferred_and_missing_visible(self):
        ctx = context()
        claim = literal(ctx, value="Una interpretación diferente")
        claim["kind"] = "inferred"
        self.assertEqual(outcome(ctx, [claim])["state"], "inferred")
        result = VerifiedBatch.from_claims(ctx, [claim]).project()
        self.assertEqual(result["target_count"], 6)
        self.assertEqual(result["counts"]["unknown"], 5)
        self.assertFalse(result["semantic_correctness_verified"])

    def durations(self, ctx):
        return [
            literal(ctx, "s1.duration", "60", 1, "60"),
            literal(ctx, "s2.duration", "60", 3, "60"),
        ]

    def test_derivation_requires_whitelisted_rule_and_verified_inputs(self):
        ctx = context()
        d = {
            "target": "total",
            "kind": "derived",
            "value": "120",
            "derivation": {
                "rule": "sum_integers",
                "inputs": ["s1.duration", "s2.duration"],
            },
        }
        self.assertEqual(
            outcome(ctx, self.durations(ctx) + [d], "total")["state"], "derived"
        )
        for change in [
            {"value": "121"},
            {"derivation": {"rule": "eval", "inputs": ["s1.duration"]}},
            {"derivation": {"rule": "sum_integers", "inputs": ["missing"]}},
            {
                "derivation": {
                    "rule": "sum_integers",
                    "inputs": ["s1.duration", "s1.duration"],
                }
            },
        ]:
            with self.subTest(change=change):
                self.assertEqual(
                    outcome(ctx, self.durations(ctx) + [dict(d, **change)], "total")[
                        "state"
                    ],
                    "unknown",
                )
        self.assertEqual(
            outcome(ctx, [self.durations(ctx)[0], d], "total")["state"], "unknown"
        )

    def numeric_context(self, text):
        snapshot = make(fixture({1: {"state": "readable", "text": text}}))
        return VerificationContext.create(
            snapshot,
            owner_id=OWNER,
            scope_id=snapshot.data["identity"]["scope_id"],
            expected_snapshot_sha256=snapshot.sha256,
            targets=[
                {
                    "id": name,
                    "role": None,
                    "context_id": None,
                    "representation_id": "raw",
                }
                for name in ("a", "b", "total")
            ],
        )

    def test_derivation_rejects_numeric_substrings_outside_cropped_quote(self):
        for token in (
            "12",
            "21",
            "-1",
            "−1",
            "+1",
            "1.2",
            "2.1",
            "1,2",
            "2,1",
            "1e3",
            "A1",
            "1min",
            "١1",
            "1١",
            "1/2",
            "1%",
            "− 1",
            "1 000",
            "1 .2",
            "1:30",
            "1 : 30",
            "30:1",
            "30 : 1",
            "±1",
            "≤1",
            "√1",
            "1٫2",
            "≤ 1",
            "1 e3",
            "1. 2",
            "1..2",
            "1,,2",
            "1.,2",
            "1. .2",
        ):
            with self.subTest(token=token):
                ctx = self.numeric_context("Duración: " + token + ".")
                claim = literal(ctx, "a", "1", 1, "1")
                d = {
                    "target": "total",
                    "kind": "derived",
                    "value": "1",
                    "derivation": {"rule": "sum_integers", "inputs": ["a"]},
                }
                # Physical substring is not a parsed numerical operand.
                self.assertEqual(outcome(ctx, [claim], "a")["state"], "literal")
                self.assertEqual(outcome(ctx, [claim, d], "total")["state"], "unknown")

    def test_integer_field_label_is_not_a_time_or_ratio_separator(self):
        ctx = self.numeric_context("Duration:60.")
        claim = literal(ctx, "a", "60", 1, "60")
        derived = {
            "target": "total",
            "kind": "derived",
            "value": "60",
            "derivation": {"rule": "sum_integers", "inputs": ["a"]},
        }
        self.assertEqual(outcome(ctx, [claim, derived], "total")["state"], "derived")

    def test_integer_multiplication_sentence_dot_and_numeric_limits(self):
        for token, expected in (
            ("60", "derived"),
            ("9999999999", "unknown"),
            ("01", "unknown"),
            ("١", "unknown"),
        ):
            with self.subTest(token=token):
                ctx = self.numeric_context("Duración: " + token + ".")
                claims = [literal(ctx, name, token, 1, token) for name in ("a", "b")]
                claims.append(
                    {
                        "target": "total",
                        "kind": "derived",
                        "value": str(int(token) ** 2),
                        "derivation": {
                            "rule": "multiply_integers",
                            "inputs": ["a", "b"],
                        },
                    }
                )
                result = outcome(ctx, claims, "total")
                self.assertEqual(result["state"], expected)
                if expected == "derived":
                    d = result["occurrences"][0]["derivation"]
                    self.assertTrue(d["arithmetic_verified"])
                    self.assertFalse(d["units_or_semantics_verified"])
                    self.assertEqual(len(d["verified_inputs"]), 2)

    def test_derivation_cycles_and_inferred_inputs_cannot_pass(self):
        ctx = context()
        claim = literal(ctx, "s1.duration", "60", 1, "60")
        claim["kind"] = "inferred"
        d = {
            "target": "total",
            "kind": "derived",
            "value": "60",
            "derivation": {"rule": "sum_integers", "inputs": ["s1.duration"]},
        }
        self.assertEqual(outcome(ctx, [claim, d], "total")["state"], "unknown")
        d["derivation"]["inputs"] = ["total"]
        self.assertEqual(outcome(ctx, [d], "total")["state"], "unknown")

    def test_duplicates_conflicts_and_bad_citations_are_order_independent(self):
        ctx = context()
        good = literal(ctx)
        same = copy.deepcopy(good)
        first = VerifiedBatch.from_claims(ctx, [good, same]).project()
        self.assertEqual(first["counts"]["literal"], 1)
        self.assertEqual(first["duplicate_claims"], 1)
        bad = copy.deepcopy(good)
        bad["evidence"][0]["page"] = 3
        self.assertEqual(
            VerifiedBatch.from_claims(ctx, [good, bad]).project(),
            VerifiedBatch.from_claims(ctx, [bad, good]).project(),
        )
        self.assertEqual(outcome(ctx, [good, bad])["state"], "unknown")
        other = literal(ctx, value="inventado")
        self.assertEqual(outcome(ctx, [good, other])["state"], "conflict")
        self.assertEqual(
            VerifiedBatch.from_claims(ctx, [good, other]).project(),
            VerifiedBatch.from_claims(ctx, [other, good]).project(),
        )

    def test_serialization_projection_reopen_do_not_resurrect_checked(self):
        ctx = context()
        bad = literal(ctx, value="inventado")
        bad.update(
            checked=True, backed=True, state="literal", declared_role="indicator"
        )
        batch = VerifiedBatch.from_claims(ctx, [bad])
        projected = batch.project()
        projected["results"][0]["state"] = "literal"
        self.assertEqual(outcome(ctx, [bad])["state"], "unknown")
        self.assertEqual(batch.project()["counts"]["literal"], 0)
        serialized = batch.serialize()
        reopened = VerifiedBatch.restore(ctx, serialized, expected_sha256=batch.sha256)
        self.assertEqual(reopened.project()["counts"]["literal"], 0)
        forged = json.loads(serialized)
        forged["projection"]["counts"]["literal"] = 1
        forged_text = json.dumps(forged)
        with self.assertRaises(IntegrityError):
            VerifiedBatch.restore(
                ctx,
                forged_text,
                expected_sha256=hashlib.sha256(forged_text.encode()).hexdigest(),
            )

    def test_context_changes_do_not_retarget_old_references_or_saved_results(self):
        ctx = context()
        batch = VerifiedBatch.from_claims(ctx, [literal(ctx)])
        changed = VerificationContext.create(
            ctx.snapshot,
            owner_id="00000000-0000-0000-0000-000000000099",
            scope_id=ctx.scope_id,
            expected_snapshot_sha256=ctx.snapshot.sha256,
            targets=ctx.targets,
        )
        self.assertEqual(outcome(changed, [literal(ctx)])["state"], "unknown")
        with self.assertRaises(IntegrityError):
            VerifiedBatch.restore(
                changed, batch.serialize(), expected_sha256=batch.sha256
            )
        targets = ctx.targets
        targets[0]["context_id"] = "changed"
        self.assertNotEqual(targets, ctx.targets)


if __name__ == "__main__":
    unittest.main()
