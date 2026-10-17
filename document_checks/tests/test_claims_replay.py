"""Synthetic files exercise the real offline claims consumer, never OCR quality."""

import copy
import hashlib
import json
import unittest

import test_replay

from aulalista_api.source_evidence import VerificationContext, reference
from aulalista_api.source_integrity import IntegrityError
from document_checks.claims_replay import reconstruct_claims, run, verify
from document_checks.replay import reconstruct


class ClaimsReplayTests(unittest.TestCase):
    def setUp(self):
        self.source = test_replay.ReplayTests()
        self.source.setUp()
        self.addCleanup(self.source.doCleanups)
        self.root = self.source.root
        snapshot = reconstruct(self.source.path)[1][0][0]
        owner = "00000000-0000-0000-0000-000000000004"
        targets = [
            {
                "id": "quote",
                "role": None,
                "context_id": None,
                "representation_id": "raw",
            }
        ]
        context = VerificationContext.create(
            snapshot,
            owner_id=owner,
            scope_id=snapshot.data["identity"]["scope_id"],
            expected_snapshot_sha256=snapshot.sha256,
            targets=targets,
        )
        self.source.write("response.txt", b"Synthetic answer: Synthetic \xc3\xa1rbol")
        case = {
            "id": "software-case",
            "stage": "original",
            "document_index": 0,
            "owner_id": owner,
            "scope_id": context.scope_id,
            "snapshot_sha256": snapshot.sha256,
            "targets": targets,
            "original_response": {
                "path": "response.txt",
                "sha256": self.source.digest("response.txt"),
            },
            "claims": [
                {
                    "target": "quote",
                    "kind": "literal",
                    "value": "Synthetic árbol",
                    "evidence": [
                        reference(context, "quote", 1, 0, len("Synthetic árbol"))
                    ],
                }
            ],
            "expectations": [
                {"target": "quote", "state": "literal", "mechanically_decidable": True}
            ],
        }
        self.manifest = {
            "schema": "aulalista-claims-replay.v1",
            "source_manifest": {
                "path": "manifest.json",
                "sha256": self.source.digest("manifest.json"),
            },
            "cases": [case],
        }
        self.path = self.root / "claims.json"
        self.save()

    def save(self):
        self.path.write_text(json.dumps(self.manifest))

    def test_run_reopen_keeps_original_and_separate_check_denominators(self):
        corrected = copy.deepcopy(self.manifest["cases"][0])
        corrected.update(id="separate-location-check", stage="separate_check")
        self.manifest["cases"].append(corrected)
        self.save()
        original = (self.root / "response.txt").read_bytes()
        out = self.root / "claims-run"
        receipt = run(self.path, out)
        self.assertEqual(receipt["by_stage"]["original"]["selected_targets"], 1)
        self.assertEqual(receipt["by_stage"]["separate_check"]["selected_targets"], 1)
        self.assertEqual(receipt["by_stage"]["original"]["false_acceptance"], 0)
        digest = hashlib.sha256((out / "receipt.json").read_bytes()).hexdigest()
        self.assertEqual(
            verify(self.path, out, expected_receipt_sha256=digest), receipt
        )
        self.assertEqual((self.root / "response.txt").read_bytes(), original)
        with self.assertRaises(FileExistsError):
            run(self.path, out)

    def test_response_change_cannot_be_silently_replayed(self):
        self.source.write("response.txt", b"changed")
        with self.assertRaises(IntegrityError):
            reconstruct_claims(self.path)

    def test_tampered_saved_checked_result_does_not_reopen(self):
        out = self.root / "claims-run"
        run(self.path, out)
        digest = self.source.digest("claims-run/receipt.json")
        batch = json.loads((out / "case-1.json").read_text())
        batch["projection"]["counts"]["literal"] = 999
        (out / "case-1.json").write_text(json.dumps(batch))
        with self.assertRaises(IntegrityError):
            verify(self.path, out, expected_receipt_sha256=digest)

    def test_expectations_and_case_identity_do_not_shrink_denominator(self):
        self.manifest["cases"][0]["expectations"] = []
        self.save()
        with self.assertRaises(IntegrityError):
            reconstruct_claims(self.path)

    def test_false_acceptance_and_duplicate_cases_remain_visible(self):
        self.manifest["cases"][0]["expectations"][0]["state"] = "unknown"
        self.save()
        receipt = run(self.path, self.root / "false-acceptance-case")
        self.assertEqual(receipt["by_stage"]["original"]["false_acceptance"], 1)
        self.assertEqual(receipt["by_stage"]["original"]["state_mismatches"], 1)
        self.manifest["cases"].append(copy.deepcopy(self.manifest["cases"][0]))
        self.save()
        with self.assertRaises(IntegrityError):
            reconstruct_claims(self.path)

    def test_unknown_and_inferred_cases_report_false_decisions_and_uncertainty(self):
        case = self.manifest["cases"][0]
        case["claims"][0]["value"] = "unsupported"
        self.save()
        receipt = run(self.path, self.root / "false-rejection-case")
        self.assertEqual(receipt["by_stage"]["original"]["false_rejection"], 1)
        case["claims"][0]["kind"] = "inferred"
        case["expectations"][0].update(state="inferred", mechanically_decidable=False)
        self.save()
        receipt = run(self.path, self.root / "inferred-case")
        self.assertEqual(receipt["by_stage"]["original"]["not_decidable"], 1)
        self.assertEqual(receipt["by_stage"]["original"]["false_rejection"], 0)


if __name__ == "__main__":
    unittest.main()
