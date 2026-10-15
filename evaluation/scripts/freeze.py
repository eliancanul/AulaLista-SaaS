#!/usr/bin/env python3
"""Freeze or verify explicitly listed development/synthetic files, offline."""

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath


def digest(data):
    return hashlib.sha256(data).hexdigest()


def local_file(root, relative):
    if not isinstance(relative, str) or not relative or "\\" in relative:
        raise ValueError("invalid relative path")
    p = PurePosixPath(relative)
    if p.is_absolute() or any(x in ("", ".", "..") for x in relative.split("/")):
        raise ValueError("unsafe relative path")
    target = root
    for part in p.parts:
        target = target / part
        if target.is_symlink():
            raise ValueError("symlink forbidden")
    target.resolve().relative_to(root.resolve())
    if not target.is_file():
        raise ValueError("not a regular file")
    return target


def contract(metadata):
    fields = ("scope", "split", "exposure", "reference_kind", "matcher_version")
    if not isinstance(metadata, dict) or any(
        not isinstance(metadata.get(k), str) or not metadata[k].strip() for k in fields
    ):
        raise ValueError("missing contract metadata")
    if metadata["split"] not in ("development", "synthetic"):
        raise ValueError("this helper does not read validation or holdout files")
    if metadata["reference_kind"] not in (
        "synthetic",
        "ai_authored",
        "human_adjudicated",
    ):
        raise ValueError("unknown reference provenance")


def freeze(root, spec):
    contract(spec["metadata"])
    rows = spec["files"]
    if not isinstance(rows, list) or not rows:
        raise ValueError("empty file list")
    seen, files = set(), []
    for row in rows:
        path, role = row["path"], row["role"]
        if path in seen or not isinstance(role, str) or not role.strip():
            raise ValueError("duplicate path or missing role")
        seen.add(path)
        data = local_file(root, path).read_bytes()
        files.append(dict(path=path, role=role, sha256=digest(data), bytes=len(data)))
    return dict(schema="curricular-freeze.v1", metadata=spec["metadata"], files=files)


def verify(root, manifest):
    if manifest.get("schema") != "curricular-freeze.v1":
        raise ValueError("unknown manifest schema")
    actual = freeze(root, manifest)
    if actual != manifest:
        raise ValueError("manifest content or file hash/size mismatch")
    return dict(status="PASS", files=len(actual["files"]), external_calls=0)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("mode", choices=("freeze", "verify"))
    p.add_argument("--root", type=Path, required=True)
    p.add_argument("--input", type=Path, required=True)
    p.add_argument("--out", type=Path)
    a = p.parse_args()
    data = json.loads(a.input.read_text())
    result = freeze(a.root, data) if a.mode == "freeze" else verify(a.root, data)
    rendered = json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    if a.out:
        with a.out.open("x", encoding="utf8") as f:
            f.write(rendered)
    else:
        print(rendered, end="")


if __name__ == "__main__":
    main()
