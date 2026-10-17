"""Replay authorized local evidence, separately from the synthetic benchmark.

No provider calls, PDF parsing, extraction, or authority inference. The explicit
manifest is trusted local configuration, never a model-provided tool instruction.
"""

import argparse
from pathlib import Path

from aulalista_api.source_integrity import (
    IntegrityError,
    Snapshot,
    canonical,
    compare,
    freeze,
    inventory,
    parse_json,
    sha256,
)


def read_artifact(root, spec):
    content = (root / spec["path"]).read_bytes()
    if sha256(content) != spec["sha256"]:
        raise IntegrityError("input artifact digest mismatch")
    return content


def select_text(content, pointer):
    """Strict JSON list/key traversal; do not flatten or normalize saved text."""
    value = parse_json(content)
    if type(pointer) is not list:
        raise IntegrityError("invalid saved-text selector")
    try:
        for part in pointer:
            if type(value) is list and type(part) is int and 0 <= part < len(value):
                value = value[part]
            elif type(value) is dict and type(part) is str:
                value = value[part]
            else:
                raise IntegrityError("invalid saved-text selector")
    except (KeyError, IndexError):
        raise IntegrityError("saved text selector not found") from None
    if type(value) is not str:
        raise IntegrityError("selected value is not literal text")
    return value


def reconstruct(manifest_path):
    """Re-read and hash every original/representation; keep all initial evidence."""
    path = Path(manifest_path)
    manifest_bytes = path.read_bytes()
    manifest = parse_json(manifest_bytes)
    if (
        type(manifest) is not dict
        or manifest.get("schema") != "aulalista-source-replay.v1"
        or type(manifest.get("documents")) is not list
        or not manifest["documents"]
    ):
        raise IntegrityError("unsupported or empty replay manifest")
    results = []
    identities = set()
    for document in manifest["documents"]:
        identity = document["identity"]
        key = (identity["scope_id"], identity["source_id"], identity["version_id"])
        if key in identities:
            raise IntegrityError("duplicate document version")
        identities.add(key)
        original = read_artifact(path.parent, document["original"])
        artifacts, contents, artifact_pages = [], {}, {}
        for spec in document["artifacts"]:
            content = read_artifact(path.parent, spec)
            if spec["id"] in contents:
                raise IntegrityError("duplicate artifact")
            contents[spec["id"]] = content
            artifact_pages[spec["id"]] = spec["physical_pages"]
            artifacts.append(
                {k: v for k, v in spec.items() if k not in ("path", "sha256")}
                | {"content": content}
            )
        representations = []
        for spec in document["representations"]:
            observed = {}
            content_artifacts = []
            for page in spec["page_sources"]:
                number = page["number"]
                if type(number) is not int or number in observed:
                    raise IntegrityError("duplicate or invalid page selector")
                item = {
                    k: v
                    for k, v in page.items()
                    if k not in ("number", "artifact", "pointer")
                }
                if "artifact" in page:
                    if "text" in page:
                        raise IntegrityError(
                            "saved text and inline text are mutually exclusive"
                        )
                    artifact = page["artifact"]
                    if artifact not in contents:
                        raise IntegrityError("unknown saved text artifact")
                    if number not in artifact_pages[artifact]:
                        raise IntegrityError(
                            "saved text page contradicts artifact page mapping"
                        )
                    item["text"] = select_text(contents[artifact], page["pointer"])
                    if artifact not in content_artifacts:
                        content_artifacts.append(artifact)
                else:
                    item.setdefault("text", "")
                observed[number] = item
            representations.append(
                {
                    k: v
                    for k, v in spec.items()
                    if k not in ("page_sources", "page_limit", "pending_reason")
                }
                | {
                    "content_artifacts": content_artifacts,
                    "pages": inventory(
                        document["total_pages"],
                        observed,
                        page_limit=spec.get("page_limit"),
                        pending_reason=spec.get("pending_reason", "not_requested"),
                    ),
                }
            )
        snapshot = freeze(
            original=original,
            identity=identity,
            total_pages=document["total_pages"],
            inventory_basis=document["inventory_basis"],
            artifacts=artifacts,
            representations=representations,
        )
        reports = [
            compare(snapshot, c["source"], c["target"], mode=c["mode"])
            for c in document["comparisons"]
        ]
        results.append((snapshot, reports))
    return sha256(manifest_bytes), results


def run(manifest_path, output):
    manifest_sha, results = reconstruct(manifest_path)
    output = Path(output).resolve()
    # Real evidence must not accidentally become source code or a CI fixture.
    repository = Path(__file__).resolve().parents[1]
    if output == repository or repository in output.parents:
        raise IntegrityError("private replay output must be outside the repository")
    output.mkdir(exist_ok=False, parents=False)
    receipt = {
        "schema": "aulalista-source-replay-receipt.v1",
        "manifest_sha256": manifest_sha,
        "new_model_calls": 0,
        "synthetic_quality_evidence": False,
        "documents": [],
    }
    for index, (snapshot, reports) in enumerate(results, 1):
        filename = f"document-{index}.snapshot.json"
        (output / filename).write_text(snapshot.canonical, encoding="utf-8")
        receipt["documents"].append(
            {
                "snapshot_file": filename,
                "snapshot_sha256": snapshot.sha256,
                "comparisons": reports,
            }
        )
    (output / "receipt.json").write_text(canonical(receipt), encoding="utf-8")
    return receipt


def verify(manifest_path, output, *, expected_receipt_sha256):
    """The caller retains the receipt digest outside the files being verified."""
    output = Path(output)
    receipt_bytes = (output / "receipt.json").read_bytes()
    if sha256(receipt_bytes) != expected_receipt_sha256:
        raise IntegrityError("replay receipt digest mismatch")
    receipt = parse_json(receipt_bytes)
    manifest_sha, results = reconstruct(manifest_path)
    if receipt["manifest_sha256"] != manifest_sha or len(results) != len(
        receipt["documents"]
    ):
        raise IntegrityError("replay manifest changed")
    for index, ((snapshot, reports), entry) in enumerate(
        zip(results, receipt["documents"], strict=True), 1
    ):
        if entry["snapshot_file"] != f"document-{index}.snapshot.json":
            raise IntegrityError("invalid snapshot filename")
        stored = Snapshot.restore(
            (output / entry["snapshot_file"]).read_text(encoding="utf-8"),
            expected_sha256=entry["snapshot_sha256"],
        )
        if stored != snapshot or reports != entry["comparisons"]:
            raise IntegrityError("replay no longer matches initial evidence")
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
                raise IntegrityError(
                    "verify requires independently retained receipt SHA-256"
                )
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
            "Replay failed: invalid/incompatible evidence, unavailable input or occupied destination. No source content logged.\n",
        )
    print("Offline replay verified; private outputs remain in the requested directory.")


if __name__ == "__main__":
    main()
