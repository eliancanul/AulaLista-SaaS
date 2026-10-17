"""Synthetic software replay fixtures; no claim of OCR or pedagogical accuracy."""

import copy
import json
import os
import subprocess
import sys
import unittest

import test_replay
from test_source_anchors import proposal

from aulalista_api.source_anchors import AnchorIndex
from aulalista_api.source_evidence import VerificationContext
from aulalista_api.source_integrity import IntegrityError
from document_checks.annex_replay import reconstruct_annexes, run, verify
from document_checks.replay import reconstruct


class AnnexReplayTests(unittest.TestCase):
    def setUp(self):
        self.source = test_replay.ReplayTests()
        self.source.setUp()
        self.addCleanup(self.source.doCleanups)
        self.root = self.source.root
        text = "Sesión 1\n- Usar anexo 1.\n"
        self.source.write(
            "saved.json", json.dumps([{"text": text}, {"text": "End"}]).encode()
        )
        self.source.manifest["documents"][0]["artifacts"][1]["sha256"] = (
            self.source.digest("saved.json")
        )
        self.source.save_manifest()
        snapshot = reconstruct(self.source.path)[1][0][0]
        target = {
            "id": "source",
            "role": None,
            "context_id": None,
            "representation_id": "raw",
        }
        context = VerificationContext.create(
            snapshot,
            owner_id="00000000-0000-0000-0000-000000000004",
            scope_id=snapshot.data["identity"]["scope_id"],
            expected_snapshot_sha256=snapshot.sha256,
            targets=[target],
        )
        index = AnchorIndex(context, "source")
        claim = proposal(index)
        response = "Synthetic selected response: anexo 1."
        self.source.write("response.txt", response.encode())
        mention = text.index("anexo")
        number = mention + len("anexo ")
        position = {"page": 1, "start": number, "end": number + 1, "number": 1}
        self.manifest = {
            "schema": "aulalista-annex-replay.v1",
            "source_manifest": {
                "path": "manifest.json",
                "sha256": self.source.digest("manifest.json"),
            },
            "document_index": 0,
            "owner_id": context.owner_id,
            "scope_id": context.scope_id,
            "snapshot_sha256": snapshot.sha256,
            "target": target,
            "stage": "original",
            "original_response": {
                "path": "response.txt",
                "sha256": self.source.digest("response.txt"),
            },
            "selections": [
                {
                    "start": 0,
                    "end": len(response),
                    "quote": response,
                    "reference_id": claim["reference_id"],
                }
            ],
            "proposals": [claim],
            "candidates": [],
            "expected": {
                "sessions": [{"page": 1, "start": 0, "end": 8}],
                "mentions": [{"page": 1, "start": mention, "end": mention + 5}],
                "numbered": [position],
                "relations": [
                    {
                        "position": position,
                        "state": "evidenced",
                        "resource_state": "missing",
                    }
                ],
            },
        }
        self.path = self.root / "annexes.json"
        self.save()

    def save(self):
        self.path.write_text(json.dumps(self.manifest))

    def test_partial_result_roundtrip_keeps_session_and_absent_resource_without_gate(
        self,
    ):
        out = self.root / "run"
        receipt = run(self.path, out)
        self.assertEqual(receipt["counts"]["evidenced_relations"], 1)
        self.assertEqual(receipt["counts"]["located_relations"], 0)
        self.assertEqual(receipt["counts"]["missing_resources"], 1)
        self.assertEqual(receipt["inventories"]["sessions"]["matched"], 1)
        self.assertFalse(receipt["user_flow_blocked"])
        self.assertEqual(receipt["new_clarification_requests"], 0)
        digest = self.source.digest("run/receipt.json")
        self.assertEqual(
            verify(self.path, out, expected_receipt_sha256=digest), receipt
        )
        with self.assertRaises(FileExistsError):
            run(self.path, out)

    def test_cli_returns_zero_for_missing_or_uncertain_links_and_two_for_integrity_failure(
        self,
    ):
        self.manifest["proposals"][0]["session_id"] = "wrong-session"
        self.save()
        process = subprocess.run(
            [
                sys.executable,
                "-B",
                "-m",
                "document_checks.annex_replay",
                "run",
                str(self.path),
                "--out",
                str(self.root / "partial"),
            ],
            capture_output=True,
            text=True,
            env=os.environ,
        )
        self.assertEqual(process.returncode, 0, process.stderr)
        result = json.loads((self.root / "partial" / "result.json").read_text())
        self.assertEqual(len(result["index"]["sessions"]), 1)
        self.assertEqual(result["relations"][0]["state"], "unknown")
        self.source.write("response.txt", b"changed")
        process = subprocess.run(
            [
                sys.executable,
                "-B",
                "-m",
                "document_checks.annex_replay",
                "run",
                str(self.path),
                "--out",
                str(self.root / "invalid"),
            ],
            capture_output=True,
            text=True,
            env=os.environ,
        )
        self.assertEqual(process.returncode, 2)
        self.assertFalse((self.root / "invalid").exists())

    def test_saved_verdict_or_source_tampering_cannot_reopen(self):
        out = self.root / "run"
        run(self.path, out)
        digest = self.source.digest("run/receipt.json")
        result = json.loads((out / "result.json").read_text())
        result["relations"][0]["resource_state"] = "located"
        (out / "result.json").write_text(json.dumps(result))
        with self.assertRaises(IntegrityError):
            verify(self.path, out, expected_receipt_sha256=digest)
        self.source.write("saved.json", b"[]")
        with self.assertRaises(IntegrityError):
            reconstruct_annexes(self.path)

    def test_original_response_span_and_relation_provenance_are_required(self):
        original = copy.deepcopy(self.manifest)
        for mutation in (
            lambda m: m["selections"][0].update(quote="invented"),
            lambda m: m.update(selections=[]),
            lambda m: m["selections"][0].update(start=True),
        ):
            self.manifest = copy.deepcopy(original)
            mutation(self.manifest)
            self.save()
            with self.assertRaises(IntegrityError):
                reconstruct_annexes(self.path)

    def test_inventory_errors_remain_visible_and_duplicates_add_no_credit(self):
        self.manifest["proposals"].append(copy.deepcopy(self.manifest["proposals"][0]))
        self.manifest["expected"]["sessions"][0]["start"] = 1
        self.save()
        receipt, _ = reconstruct_annexes(self.path)
        counts = receipt["inventories"]["sessions"]
        self.assertEqual(
            (counts["expected"], counts["detected"], counts["matched"]), (1, 1, 0)
        )
        self.assertEqual((len(counts["omitted"]), len(counts["extra"])), (1, 1))
        self.assertEqual(receipt["counts"]["evidenced_relations"], 1)
        self.assertEqual(receipt["counts"]["duplicate_predictions"], 1)
        self.manifest["expected"]["relations"] = []
        self.save()
        with self.assertRaises(IntegrityError):
            reconstruct_annexes(self.path)

    def test_false_acceptance_and_rejection_are_reported_against_declared_adjudication(
        self,
    ):
        self.manifest["expected"]["relations"][0]["state"] = "unknown"
        self.save()
        self.assertEqual(reconstruct_annexes(self.path)[0]["false_acceptances"], 1)
        self.manifest["expected"]["relations"][0]["state"] = "evidenced"
        self.manifest["proposals"][0]["activity_id"] = "wrong-activity"
        self.save()
        receipt, _ = reconstruct_annexes(self.path)
        self.assertEqual(receipt["false_rejections"], 1)
        self.assertEqual(receipt["not_decidable_relations"], 1)


if __name__ == "__main__":
    unittest.main()
