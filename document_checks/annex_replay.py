"""Offline physical-link replay. Uncertainty yields usable partial output, no gate."""

import argparse
from pathlib import Path

from aulalista_api.source_anchors import AnchorIndex
from aulalista_api.source_evidence import VerificationContext
from aulalista_api.source_integrity import IntegrityError, canonical, parse_json, sha256
from document_checks.replay import read_artifact, reconstruct


def _positions(rows, *, numbered=False):
    keys = {"page", "start", "end"} | ({"number"} if numbered else set())
    if type(rows) is not list:
        raise IntegrityError("expected physical positions must be a list")
    result = set()
    for row in rows:
        if (
            type(row) is not dict
            or set(row) != keys
            or any(type(row[k]) is not int for k in keys)
            or row["page"] < 1
            or not 0 <= row["start"] < row["end"]
            or (numbered and not 1 <= row["number"] <= 999999)
        ):
            raise IntegrityError("invalid expected physical position")
        key = canonical(row)
        if key in result:
            raise IntegrityError("duplicate expected physical position")
        result.add(key)
    return result


def _position(ref, number=None):
    result = {k: ref[k] for k in ("page", "start", "end")}
    if number is not None:
        result["number"] = number
    return result


def _inventory(expected, detected, *, numbered=False):
    expected = _positions(expected, numbered=numbered)
    detected = _positions(detected, numbered=numbered)
    return {
        "expected": len(expected),
        "detected": len(detected),
        "matched": len(expected & detected),
        "omitted": [parse_json(k) for k in sorted(expected - detected)],
        "extra": [parse_json(k) for k in sorted(detected - expected)],
    }


def reconstruct_annexes(manifest_path):
    path = Path(manifest_path)
    content = path.read_bytes()
    manifest = parse_json(content)
    if (
        type(manifest) is not dict
        or manifest.get("schema") != "aulalista-annex-replay.v1"
    ):
        raise IntegrityError("unsupported annex replay manifest")
    read_artifact(path.parent, manifest["source_manifest"])
    _, sources = reconstruct(path.parent / manifest["source_manifest"]["path"])
    document = manifest["document_index"]
    if type(document) is not int or not 0 <= document < len(sources):
        raise IntegrityError("invalid source document index")
    snapshot = sources[document][0]
    context = VerificationContext.create(
        snapshot,
        owner_id=manifest["owner_id"],
        scope_id=manifest["scope_id"],
        expected_snapshot_sha256=manifest["snapshot_sha256"],
        targets=[manifest["target"]],
    )
    index = AnchorIndex(context, manifest["target"]["id"])
    stage = manifest["stage"]
    if stage not in ("original", "separate_check"):
        raise IntegrityError("invalid provenance stage")
    response = read_artifact(path.parent, manifest["original_response"]).decode("utf-8")
    selections = manifest["selections"]
    if type(selections) is not list:
        raise IntegrityError("explicit response selections required")
    selected = set()
    for selection in selections:
        start, end = selection["start"], selection["end"]
        if (
            type(start) is not int
            or type(end) is not int
            or not 0 <= start < end <= len(response)
            or response[start:end] != selection["quote"]
            or type(selection["reference_id"]) is not str
        ):
            raise IntegrityError("selection is not an exact saved response span")
        selected.add(selection["reference_id"])
    proposals = manifest["proposals"]
    if type(proposals) is not list or any(type(p) is not dict for p in proposals):
        raise IntegrityError("invalid selected proposals")
    if selected != {p["reference_id"] for p in proposals}:
        raise IntegrityError(
            "every selected proposal needs original response provenance"
        )
    for record in manifest.get("supporting_records", []):
        read_artifact(path.parent, record)
    result = index.evaluate(proposals, manifest.get("candidates", []))
    data = result["index"]
    refs = {
        r["id"]: _position(r["evidence"], r["number"])
        for mention in data["mentions"]
        for r in mention["number_references"]
    }
    expected = manifest["expected"]
    inventories = {
        "sessions": _inventory(
            expected["sessions"], [_position(s["evidence"]) for s in data["sessions"]]
        ),
        "lexical_mentions": _inventory(
            expected["mentions"],
            [
                dict(_position(m["evidence"]), end=m["keyword_end"])
                for m in data["mentions"]
            ],
        ),
        "numbered_references": _inventory(
            expected["numbered"], list(refs.values()), numbered=True
        ),
    }
    expected_relations = expected["relations"]
    _positions([r["position"] for r in expected_relations], numbered=True)
    if {canonical(r["position"]) for r in expected_relations} != _positions(
        expected["numbered"], numbered=True
    ):
        raise IntegrityError(
            "relation expectations must cover every expected numbered occurrence"
        )
    actual = {canonical(refs[r["reference_id"]]): r for r in result["relations"]}
    checks = []
    for expectation in expected_relations:
        state, resource_state = expectation["state"], expectation["resource_state"]
        if state not in ("evidenced", "unknown") or resource_state not in (
            "located",
            "missing",
            "ambiguous",
            "unresolved",
        ):
            raise IntegrityError("invalid relation expectation")
        row = actual.get(canonical(expectation["position"]))
        observed = row["state"] if row else "unknown"
        resource = row["resource_state"] if row else "unresolved"
        checks.append(
            {
                "position": expectation["position"],
                "expected": state,
                "actual": observed,
                "expected_resource": resource_state,
                "actual_resource": resource,
                "detected": row is not None,
                "false_acceptance": observed == "evidenced" and state != "evidenced",
                "false_rejection": observed != "evidenced" and state == "evidenced",
                "matches": observed == state and resource == resource_state,
            }
        )
    receipt = {
        "schema": "aulalista-annex-replay-receipt.v1",
        "manifest_sha256": sha256(content),
        "stage": stage,
        "result_sha256": sha256(canonical(result).encode()),
        "selection": "agent/operator-selected saved response spans; not whole-answer extraction or human adjudication",
        "source_reference_mapping": "trusted offline input; exact saved response spans do not certify semantic correspondence or original source offsets",
        "selected_response_spans": len(selections),
        "selected_references": len(selected),
        "inventories": inventories,
        "checks": checks,
        "counts": result["counts"],
        "false_acceptances": sum(c["false_acceptance"] for c in checks),
        "false_rejections": sum(c["false_rejection"] for c in checks),
        "not_decidable_relations": sum(
            r["state"] == "unknown" for r in result["relations"]
        ),
        "new_model_calls": 0,
        "new_clarification_requests": 0,
        "general_accuracy_verified": False,
        "user_flow_blocked": False,
    }
    return receipt, result


def run(manifest_path, output):
    receipt, result = reconstruct_annexes(manifest_path)
    output = Path(output).resolve()
    repository = Path(__file__).resolve().parents[1]
    if output == repository or repository in output.parents:
        raise IntegrityError("private replay output must be outside repository")
    output.mkdir(parents=False, exist_ok=False)
    (output / "result.json").write_text(canonical(result), encoding="utf-8")
    (output / "receipt.json").write_text(canonical(receipt), encoding="utf-8")
    return receipt


def verify(manifest_path, output, *, expected_receipt_sha256):
    output = Path(output)
    saved = (output / "receipt.json").read_bytes()
    if sha256(saved) != expected_receipt_sha256:
        raise IntegrityError("annex replay receipt changed")
    receipt, result = reconstruct_annexes(manifest_path)
    if (
        canonical(receipt).encode() != saved
        or canonical(result).encode() != (output / "result.json").read_bytes()
    ):
        raise IntegrityError("annex replay evidence changed")
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
        parser.exit(2, "Invalid or changed private replay input.\n")
    print("Offline annex replay verified; partial results retained.")


if __name__ == "__main__":
    main()
