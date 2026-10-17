"""Replay an explicitly selected subset of saved claims against controlled sources.

The local manifest/target policy and adjudications are trusted configuration, not
model output. This evaluates only selected targets, never an entire answer by
implication. Original responses are hashed and retained; separate checks remain
separate from original-response results.
"""

import argparse
from pathlib import Path

from aulalista_api.source_evidence import VerificationContext, VerifiedBatch
from aulalista_api.source_integrity import IntegrityError, canonical, parse_json, sha256
from document_checks.replay import read_artifact, reconstruct


def reconstruct_claims(manifest_path):
    path = Path(manifest_path)
    content = path.read_bytes()
    manifest = parse_json(content)
    if (
        type(manifest) is not dict
        or manifest.get("schema") != "aulalista-claims-replay.v1"
    ):
        raise IntegrityError("unsupported claims replay manifest")
    read_artifact(path.parent, manifest["source_manifest"])
    _, sources = reconstruct(path.parent / manifest["source_manifest"]["path"])
    cases = manifest["cases"]
    if type(cases) is not list or not cases:
        raise IntegrityError("claims replay requires selected cases")
    results, seen = [], set()
    for case in cases:
        if type(case["id"]) is not str or not case["id"] or case["id"] in seen:
            raise IntegrityError("duplicate or invalid case identity")
        seen.add(case["id"])
        if case["stage"] not in ("original", "separate_check"):
            raise IntegrityError("invalid claim provenance stage")
        read_artifact(path.parent, case["original_response"])
        index = case["document_index"]
        if type(index) is not int or not 0 <= index < len(sources):
            raise IntegrityError("invalid source document index")
        snapshot = sources[index][0]
        context = VerificationContext.create(
            snapshot,
            owner_id=case["owner_id"],
            scope_id=case["scope_id"],
            expected_snapshot_sha256=case["snapshot_sha256"],
            targets=case["targets"],
        )
        batch = VerifiedBatch.from_claims(context, case["claims"])
        projection = batch.project()
        expected = case["expectations"]
        if (
            type(expected) is not list
            or {e["target"] for e in expected} != {t["id"] for t in case["targets"]}
            or len(expected) != len(case["targets"])
        ):
            raise IntegrityError(
                "adjudication must cover every selected target exactly once"
            )
        expected = {e["target"]: e for e in expected}
        checks = []
        for result in projection["results"]:
            adjudication = expected[result["target"]]
            if (
                adjudication["state"] not in projection["counts"]
                or type(adjudication["mechanically_decidable"]) is not bool
            ):
                raise IntegrityError("invalid adjudication")
            decidable = adjudication["mechanically_decidable"]
            accepted = result["state"] in ("literal", "derived")
            expected_accept = adjudication["state"] in ("literal", "derived")
            checks.append(
                {
                    "target": result["target"],
                    "expected": adjudication["state"],
                    "actual": result["state"],
                    "state_matches_expectation": result["state"]
                    == adjudication["state"],
                    "false_acceptance": decidable and accepted and not expected_accept,
                    "false_rejection": decidable and expected_accept and not accepted,
                    "not_decidable": not decidable,
                }
            )
        results.append((case["id"], case["stage"], batch, checks))
    return sha256(content), results


def _receipt(manifest_sha, results):
    stages = {}
    for stage in ("original", "separate_check"):
        checks = [
            check for _, origin, _, rows in results if origin == stage for check in rows
        ]
        stages[stage] = {
            "selected_targets": len(checks),
            **{
                key: sum(c[key] for c in checks)
                for key in ("false_acceptance", "false_rejection", "not_decidable")
            },
            "state_mismatches": sum(not c["state_matches_expectation"] for c in checks),
        }
    return {
        "schema": "aulalista-claims-replay-receipt.v1",
        "manifest_sha256": manifest_sha,
        "selection": "explicitly selected subset; not an automatic whole-answer audit",
        "new_model_calls": 0,
        "general_accuracy_verified": False,
        "by_stage": stages,
        "cases": [
            {
                "id": name,
                "stage": stage,
                "batch_file": f"case-{i}.json",
                "batch_sha256": batch.sha256,
                "checks": checks,
            }
            for i, (name, stage, batch, checks) in enumerate(results, 1)
        ],
    }


def run(manifest_path, output):
    manifest_sha, results = reconstruct_claims(manifest_path)
    receipt = _receipt(manifest_sha, results)
    output = Path(output).resolve()
    repository = Path(__file__).resolve().parents[1]
    if output == repository or repository in output.parents:
        raise IntegrityError("private replay output must be outside repository")
    output.mkdir(parents=False, exist_ok=False)
    for entry, (_, _, batch, _) in zip(receipt["cases"], results, strict=True):
        (output / entry["batch_file"]).write_text(batch.serialize(), encoding="utf-8")
    (output / "receipt.json").write_text(canonical(receipt), encoding="utf-8")
    return receipt


def verify(manifest_path, output, *, expected_receipt_sha256):
    output = Path(output)
    saved = (output / "receipt.json").read_bytes()
    if sha256(saved) != expected_receipt_sha256:
        raise IntegrityError("claims replay receipt changed")
    manifest_sha, results = reconstruct_claims(manifest_path)
    receipt = _receipt(manifest_sha, results)
    if canonical(receipt).encode("utf-8") != saved:
        raise IntegrityError("claims replay evidence changed")
    for entry, (_, _, batch, _) in zip(receipt["cases"], results, strict=True):
        reopened = VerifiedBatch.restore(
            batch.context,
            (output / entry["batch_file"]).read_text(encoding="utf-8"),
            expected_sha256=entry["batch_sha256"],
        )
        if reopened.project() != batch.project():
            raise IntegrityError("canonical claim verdict changed")
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("run", "verify"))
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--receipt-sha256")
    args = parser.parse_args()
    try:
        if args.command == "run":
            run(args.manifest, args.out)
        else:
            if not args.receipt_sha256:
                raise IntegrityError("retained receipt SHA-256 required")
            verify(args.manifest, args.out, expected_receipt_sha256=args.receipt_sha256)
    except (
        IntegrityError,
        OSError,
        ValueError,
        KeyError,
        TypeError,
        AttributeError,
        RecursionError,
    ):
        parser.exit(
            1,
            "Claims replay failed: invalid/incompatible evidence or unavailable input/destination. No source content logged.\n",
        )
    print("Selected claims replay verified; original responses remain unchanged.")


if __name__ == "__main__":
    main()
