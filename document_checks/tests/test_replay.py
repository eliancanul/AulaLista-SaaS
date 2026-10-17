"""Synthetic files test the private replay path; never evidence of OCR quality."""

import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from test_source_integrity import fixture

from aulalista_api.source_integrity import IntegrityError
from document_checks.replay import reconstruct, run, select_text, verify


class ReplayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        original, identity, artifacts, reps = fixture()
        self.write("original.bin", original)
        self.write("input.bin", artifacts[0]["content"])
        self.write(
            "saved.json",
            json.dumps([{"text": "Synthetic árbol"}, {"text": "End"}]).encode(),
        )
        artifact = {k: v for k, v in artifacts[0].items() if k != "content"}
        artifact.update(path="input.bin", sha256=self.digest("input.bin"))
        saved = dict(
            artifact,
            id="saved",
            path="saved.json",
            sha256=self.digest("saved.json"),
            parents=["synthetic-input"],
            media_type="application/json",
        )
        rep = {
            k: v for k, v in reps[0].items() if k not in ("pages", "content_artifacts")
        }
        rep["page_sources"] = [
            {
                "number": 1,
                "state": "readable",
                "artifact": "saved",
                "pointer": [0, "text"],
            },
            {
                "number": 3,
                "state": "readable",
                "artifact": "saved",
                "pointer": [1, "text"],
            },
        ]
        transformed = copy.deepcopy(rep)
        transformed.update(id="context", kind="transformed", derived_from="raw")
        self.manifest = {
            "schema": "aulalista-source-replay.v1",
            "documents": [
                {
                    "identity": identity,
                    "original": {
                        "path": "original.bin",
                        "sha256": self.digest("original.bin"),
                    },
                    "total_pages": 3,
                    "inventory_basis": "synthetic software fixture",
                    "artifacts": [artifact, saved],
                    "representations": [rep, transformed],
                    "comparisons": [
                        {"source": "raw", "target": "context", "mode": "transformation"}
                    ],
                }
            ],
        }
        self.path = self.root / "manifest.json"
        self.save_manifest()

    def write(self, name, content):
        (self.root / name).write_bytes(content)

    def digest(self, name):
        return hashlib.sha256((self.root / name).read_bytes()).hexdigest()

    def save_manifest(self):
        self.path.write_text(json.dumps(self.manifest))

    def test_roundtrip_preserves_source_and_evidence_and_refuses_overwrite(self):
        out = self.root / "replay"
        before = {p.name: p.read_bytes() for p in self.root.iterdir()}
        receipt = run(self.path, out)
        digest = self.digest("replay/receipt.json")
        self.assertEqual(
            verify(self.path, out, expected_receipt_sha256=digest), receipt
        )
        for name, content in before.items():
            self.assertEqual((self.root / name).read_bytes(), content)
        with self.assertRaises(FileExistsError):
            run(self.path, out)
        self.assertEqual(
            receipt["documents"][0]["comparisons"][0]["pages"][1]["status"],
            "unavailable",
        )

    def test_changed_original_or_saved_output_fails_before_writing(self):
        self.write("saved.json", b"[]")
        with self.assertRaises(IntegrityError):
            run(self.path, self.root / "replay")
        self.assertFalse((self.root / "replay").exists())

    def test_changed_snapshot_receipt_or_manifest_cannot_reopen(self):
        out = self.root / "replay"
        run(self.path, out)
        digest = self.digest("replay/receipt.json")
        self.manifest["documents"][0]["identity"]["number"] = 2
        self.save_manifest()
        with self.assertRaises(IntegrityError):
            verify(self.path, out, expected_receipt_sha256=digest)

    def test_reconstructed_representation_hash_includes_input_bytes(self):
        first = reconstruct(self.path)[1][0][0]
        self.write("input.bin", b"changed synthetic input")
        self.manifest["documents"][0]["artifacts"][0]["sha256"] = self.digest(
            "input.bin"
        )
        self.save_manifest()
        changed = reconstruct(self.path)[1][0][0]
        self.assertNotEqual(
            first.data["representations"][0]["sha256"],
            changed.data["representations"][0]["sha256"],
        )

    def test_selectors_cannot_use_negative_boolean_or_missing_indexes(self):
        for pointer in [[-1, "text"], [True, "text"], [2], [0, "absent"]]:
            with self.subTest(pointer=pointer), self.assertRaises(IntegrityError):
                select_text(b'[{"text":"synthetic"}]', pointer)

    def test_duplicate_page_or_document_is_rejected(self):
        self.manifest["documents"][0]["representations"][0]["page_sources"] *= 2
        self.save_manifest()
        with self.assertRaises(IntegrityError):
            reconstruct(self.path)

    def test_duplicate_json_keys_and_nonfinite_values_rejected(self):
        for content in [
            b'[{"text":"first","text":"last"}]',
            b'[{"text":"valid","other":NaN}]',
            b'[{"text":"valid","other":Infinity}]',
        ]:
            with self.subTest(content=content), self.assertRaises(IntegrityError):
                select_text(content, [0, "text"])
        self.path.write_text(
            '{"schema":"one","schema":"aulalista-source-replay.v1","documents":[]}'
        )
        with self.assertRaises(IntegrityError):
            reconstruct(self.path)

    def test_empty_batch_or_ambiguous_text_projection_cannot_claim_success(self):
        self.manifest["documents"][0]["representations"][0]["page_sources"][0][
            "text"
        ] = "silently overwritten"
        self.save_manifest()
        with self.assertRaises(IntegrityError):
            reconstruct(self.path)
        for invalid in [[], {"schema": "aulalista-source-replay.v1", "documents": []}]:
            self.path.write_text(json.dumps(invalid))
            with self.subTest(invalid=invalid), self.assertRaises(IntegrityError):
                reconstruct(self.path)

    def test_saved_text_selector_cannot_move_outside_artifact_page_map(self):
        self.manifest["documents"][0]["artifacts"][1]["physical_pages"] = [1]
        self.save_manifest()
        with self.assertRaises(IntegrityError):
            reconstruct(self.path)

    def test_unknown_saved_text_and_wrong_hash_fail_closed(self):
        self.manifest["documents"][0]["artifacts"][0]["sha256"] = "0" * 64
        self.save_manifest()
        with self.assertRaises(IntegrityError):
            reconstruct(self.path)


if __name__ == "__main__":
    unittest.main()
