"""Synthetic software fixtures only; no OCR or pedagogical evidence."""

import copy
import hashlib
import json
import unittest
from dataclasses import FrozenInstanceError

from aulalista_api.source_integrity import (
    IntegrityError,
    Snapshot,
    compact_aliases,
    compare,
    freeze,
    inventory,
)


def fixture(texts=None):
    original = b"synthetic original, not a PDF"
    identity = {
        "scope_id": "00000000-0000-0000-0000-000000000001",
        "source_id": "00000000-0000-0000-0000-000000000002",
        "version_id": "00000000-0000-0000-0000-000000000003",
        "number": 1,
        "sha256": hashlib.sha256(original).hexdigest(),
        "size": len(original),
        "authority": "offline_manifest",
    }
    artifact = {
        "id": "synthetic-input",
        "content": b"synthetic image stand-in",
        "media_type": "application/x-synthetic",
        "physical_pages": [1, 2, 3],
        "parents": ["original"],
        "method": "software-fixture",
        "method_version": "1",
    }
    pages = inventory(
        3,
        texts
        or {
            1: {"state": "readable", "text": "Árbol uno dos"},
            2: {"state": "no_text", "text": ""},
            3: {"state": "readable", "text": "Cierre"},
        },
    )
    raw = {
        "id": "raw",
        "kind": "raw",
        "method": "software-fixture",
        "method_version": "1",
        "modality": "text",
        "inputs": ["synthetic-input"],
        "content_artifacts": [],
        "derived_from": None,
        "pages": pages,
    }
    return original, identity, [artifact], [raw]


def make(parts=None):
    original, identity, artifacts, reps = parts or fixture()
    return freeze(
        original=original,
        identity=identity,
        total_pages=3,
        inventory_basis="synthetic fixture declares three physical pages",
        artifacts=artifacts,
        representations=reps,
    )


class SourceIntegrityTests(unittest.TestCase):
    def test_snapshot_is_immutable_and_detached(self):
        parts = fixture()
        s = make(parts)
        before = s.sha256
        parts[3][0]["pages"][0]["text"] = "changed"
        data = s.data
        data["representations"][0]["pages"][0]["text"] = "changed again"
        self.assertEqual(s.sha256, before)
        self.assertEqual(
            s.data["representations"][0]["pages"][0]["text"], "Árbol uno dos"
        )
        with self.assertRaises(FrozenInstanceError):
            s.canonical = "{}"

    def test_reopen_checks_digest_and_all_representation_hashes(self):
        s = make()
        self.assertEqual(Snapshot.restore(s.canonical, expected_sha256=s.sha256), s)
        data = s.data
        data["representations"][0]["pages"][0]["text"] = "tampered"
        changed = json.dumps(data)
        with self.assertRaises(IntegrityError):
            Snapshot.restore(changed, expected_sha256=s.sha256)
        with self.assertRaises(IntegrityError):
            Snapshot.restore(
                changed, expected_sha256=hashlib.sha256(changed.encode()).hexdigest()
            )

    def test_original_hash_is_not_text_or_image_hash(self):
        s = make().data
        self.assertEqual(
            len(
                {
                    s["identity"]["sha256"],
                    s["artifacts"][0]["sha256"],
                    s["representations"][0]["sha256"],
                }
            ),
            3,
        )
        parts = fixture()
        parts[1]["sha256"] = "f" * 64
        with self.assertRaises(IntegrityError):
            make(parts)

    def test_pages_never_renumber_and_partial_is_computed(self):
        pages = inventory(
            3,
            {
                1: {"state": "readable", "text": "one"},
                2: {"state": "failed", "text": "", "reason": "read_error"},
            },
        )
        parts = fixture()
        parts[3][0]["pages"] = pages
        s = make(parts).data["representations"][0]
        self.assertEqual([p["number"] for p in s["pages"]], [1, 2, 3])
        self.assertEqual(s["pages"][2]["state"], "not_processed")
        self.assertEqual(s["status"], "partial")

    def test_page_limit_keeps_inventory_and_rejects_silent_truncation(self):
        pages = inventory(3, {1: {"state": "readable", "text": "one"}}, page_limit=1)
        self.assertEqual(pages[2]["reason"], "page_limit")
        self.assertEqual(len(pages), 3)
        with self.assertRaises(IntegrityError):
            inventory(3, {2: {"state": "readable", "text": "two"}}, page_limit=1)
        parts = fixture()
        parts[3][0]["pages"].pop(1)
        with self.assertRaises(IntegrityError):
            make(parts)

    def test_cancelled_and_empty_pages_remain_distinct(self):
        pages = inventory(
            3, {1: {"state": "no_text", "text": ""}}, pending_reason="cancelled"
        )
        self.assertEqual(
            [p["state"] for p in pages], ["no_text", "not_processed", "not_processed"]
        )
        self.assertEqual(pages[1]["reason"], "cancelled")

    def transformed(self, replacement):
        parts = fixture()
        child = copy.deepcopy(parts[3][0])
        child.update(id="layout", kind="transformed", derived_from="raw")
        child["pages"][0]["text"] = replacement
        parts[3].append(child)
        return make(parts)

    def test_omission_duplication_reorder_and_accent_change(self):
        for text, field in [
            ("Árbol uno", "removed_characters"),
            ("Árbol uno dos dos", "added_characters"),
            ("Arbol uno dos", "removed_characters"),
        ]:
            with self.subTest(text=text):
                p = compare(self.transformed(text), "raw", "layout")["pages"][0]
                self.assertGreater(p[field], 0)
                self.assertFalse(p["exact_equal"])
        p = compare(self.transformed("dos uno Árbol"), "raw", "layout")["pages"][0]
        self.assertTrue(p["same_token_multiset"])
        self.assertTrue(p["token_order_changed"])
        self.assertFalse(p["visual_structure_verified"])

    def test_whitespace_measure_is_explicit_and_offsets_are_literal(self):
        s = self.transformed("Árbol\nuno dos")
        p = compare(s, "raw", "layout")["pages"][0]
        self.assertFalse(p["exact_equal"])
        self.assertTrue(p["whitespace_collapsed"]["exact_equal"])
        for d in p["differences"]:
            self.assertEqual(
                d["before"], "Árbol uno dos"[d["source_start"] : d["source_end"]]
            )

    def test_reference_not_claimed_by_transformation_or_equal_tokens(self):
        s = self.transformed("Árbol uno dos")
        r = compare(s, "raw", "layout")
        self.assertFalse(r["reference_supplied"])
        self.assertFalse(r["textual_coverage_verified"])
        self.assertEqual(r["total_physical_pages"], 3)
        self.assertEqual(r["compared_pages"], 3)

    def test_comparison_rejects_wrong_lineage_and_input_representation(self):
        parts = fixture()
        child = copy.deepcopy(parts[3][0])
        child.update(id="other", kind="raw")
        parts[3].append(child)
        with self.assertRaises(IntegrityError):
            compare(make(parts), "raw", "other")
        parts[3][-1].update(kind="transformed", derived_from="raw", inputs=["original"])
        with self.assertRaises(IntegrityError):
            make(parts)

    def test_reference_mode_must_use_reference_and_same_input(self):
        parts = fixture()
        ref = copy.deepcopy(parts[3][0])
        ref.update(id="reference", kind="reference")
        parts[3].append(ref)
        r = compare(make(parts), "reference", "raw", mode="reference")
        self.assertTrue(r["reference_supplied"])
        self.assertFalse(r["textual_coverage_verified"])
        with self.assertRaises(IntegrityError):
            compare(make(parts), "raw", "reference", mode="reference")

    def test_diff_budget_does_not_drop_pages_or_claim_equality(self):
        r = compare(
            self.transformed("Árbol uno dos"), "raw", "layout", max_diff_characters=2
        )
        self.assertEqual(r["total_physical_pages"], 3)
        self.assertEqual(r["pages"][0]["status"], "comparison_limited")
        self.assertNotIn("exact_equal", r["pages"][0])

    def test_invalid_types_states_and_duplicate_ids_fail_closed(self):
        mutations = [
            lambda p: p[1].update(number=True),
            lambda p: p[3][0]["pages"][1].update(text="hidden"),
            lambda p: p[3][0]["pages"][0].update(state="no_text"),
            lambda p: p[3][0]["pages"][0].update(number=2),
            lambda p: p[3].append(copy.deepcopy(p[3][0])),
            lambda p: p[3][0].update(status="complete"),
        ]
        for mutation in mutations:
            parts = fixture()
            mutation(parts)
            with self.subTest(mutation=mutation), self.assertRaises(IntegrityError):
                make(parts)

    def test_aliases_preserve_origins_and_distinct_dependencies(self):
        parts = fixture()
        pages = parts[3][0]["pages"]
        pages[0]["text"] = "header header dependency"
        pages[0]["units"] = [
            {
                "id": "h1",
                "start": 0,
                "end": 6,
                "role": "header",
                "metadata": {"row": 1},
                "dependencies": ["d"],
            },
            {
                "id": "h2",
                "start": 7,
                "end": 13,
                "role": "header",
                "metadata": {"row": 1},
                "dependencies": ["d"],
            },
            {
                "id": "d",
                "start": 14,
                "end": 24,
                "role": "body",
                "metadata": {},
                "dependencies": [],
            },
        ]
        pages[2]["text"] = "header"
        pages[2]["units"] = [
            {
                "id": "h3",
                "start": 0,
                "end": 6,
                "role": "header",
                "metadata": {"row": 1},
                "dependencies": [],
            }
        ]
        s = make(parts)
        aliases = compact_aliases(s, "raw")
        self.assertEqual(
            [a["occurrences"] for a in aliases], [["h1", "h2"], ["d"], ["h3"]]
        )
        self.assertEqual(aliases[0]["dependencies"], ["d"])
        self.assertEqual(len(s.data["representations"][0]["pages"][0]["units"]), 3)
        parts[3][0]["pages"][0]["units"][0]["dependencies"] = ["absent"]
        with self.assertRaises(IntegrityError):
            make(parts)

    def test_alias_namespace_and_metadata_types_are_not_collapsed(self):
        parts = fixture()
        page = parts[3][0]["pages"][0]
        page["text"] = "header body"
        collision = json.dumps(
            {"text": "header", "role": "header", "metadata": {}, "dependencies": []},
            sort_keys=True,
            separators=(",", ":"),
        )
        page["units"] = [
            {
                "id": "h",
                "start": 0,
                "end": 6,
                "role": "header",
                "metadata": {},
                "dependencies": [],
            },
            {
                "id": collision,
                "start": 7,
                "end": 11,
                "role": "body",
                "metadata": {},
                "dependencies": [],
            },
        ]
        self.assertEqual(len(compact_aliases(make(parts), "raw")), 2)
        for invalid in [
            {1: "not a JSON key"},
            {"tuple": (1, 2)},
            {"nan": float("nan")},
        ]:
            page["units"][0]["metadata"] = invalid
            with self.subTest(invalid=invalid), self.assertRaises(IntegrityError):
                make(parts)

    def test_size_page_count_and_artifact_limits_reject_whole_snapshot(self):
        parts = fixture()
        parts[1]["size"] += 1
        with self.assertRaises(IntegrityError):
            make(parts)
        for bad in [0, -1, True, 10_001]:
            with self.subTest(bad=bad), self.assertRaises(IntegrityError):
                inventory(bad, {})
        parts = fixture()
        parts[2][0]["physical_pages"] = [3, 1]
        with self.assertRaises(IntegrityError):
            make(parts)

    def test_scope_version_binding_changes_snapshot_and_representation_identity(self):
        first = make()
        parts = fixture()
        parts[1]["number"] = 2
        other = make(parts)
        self.assertNotEqual(first.sha256, other.sha256)
        self.assertNotEqual(
            first.data["representations"][0]["sha256"],
            other.data["representations"][0]["sha256"],
        )


if __name__ == "__main__":
    unittest.main()
