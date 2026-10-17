"""Offline source integrity, not OCR, authentication, or semantic validation.

Offsets are zero-based, half-open Python Unicode character offsets in one exact
text representation. Serialized snapshots contain private text: never log them.
"""

import hashlib
import json
import math
import re
from collections import Counter
from dataclasses import dataclass
from difflib import SequenceMatcher
from uuid import UUID

SCHEMA = "aulalista-source-snapshot.v1"
MAX_PAGES = 10_000
MAX_ORIGINAL_BYTES = 128 * 1024 * 1024
MAX_TEXT_CHARACTERS = 2_000_000


class IntegrityError(ValueError):
    """Invalid or incompatible evidence; messages never include source content."""


def _json_types(value):
    if type(value) is dict:
        _require(all(type(k) is str for k in value), "JSON keys must be strings")
        for child in value.values():
            _json_types(child)
    elif type(value) is list:
        for child in value:
            _json_types(child)
    else:
        _require(type(value) in (str, int, float, bool, type(None)), "non-JSON value")
        _require(type(value) is not float or math.isfinite(value), "nonfinite JSON")


def canonical(value):
    _json_types(value)
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def sha256(content):
    return hashlib.sha256(content).hexdigest()


def _hash(value):
    return sha256(canonical(value).encode("utf-8"))


def _require(condition, message):
    if not condition:
        raise IntegrityError(message)


def _keys(value, required):
    _require(
        type(value) is dict and set(value) == set(required.split()), "invalid fields"
    )


def _string(value):
    _require(type(value) is str and bool(value.strip()), "expected nonempty string")


def _integer(value, low, high):
    _require(
        type(value) is int and low <= value <= high, "integer outside allowed range"
    )


def _digest(value):
    _require(
        type(value) is str and re.fullmatch("[0-9a-f]{64}", value) is not None,
        "invalid SHA-256",
    )


def _unique(values):
    _require(
        type(values) is list and all(type(v) is str for v in values),
        "invalid identifiers",
    )
    _require(len(values) == len(set(values)), "duplicate identifiers")


def inventory(
    total_pages, observed, *, page_limit=None, pending_reason="not_requested"
):
    """Fill every physical page; missing observations remain explicitly unprocessed."""
    _integer(total_pages, 1, MAX_PAGES)
    _require(type(observed) is dict, "invalid page observations")
    _string(pending_reason)
    if page_limit is not None:
        _integer(page_limit, 0, total_pages)
    for number in observed:
        _integer(number, 1, total_pages)
        _require(
            page_limit is None or number <= page_limit, "observation exceeds page limit"
        )
    pages = []
    for number in range(1, total_pages + 1):
        page = dict(observed.get(number, {}))
        _require("number" not in page, "page number supplied twice")
        if number not in observed:
            page = {
                "state": "not_processed",
                "text": "",
                "reason": "page_limit"
                if page_limit is not None and number > page_limit
                else pending_reason,
            }
        page.setdefault("reason", None)
        page.setdefault("units", [])
        pages.append({"number": number, **page})
    return pages


def _representation_hash(rep, identity, total_pages, artifacts, parent_sha256=None):
    needed = set(rep["inputs"] + rep["content_artifacts"])
    for artifact in reversed(artifacts):
        if artifact["id"] in needed:
            needed.update(artifact["parents"])
    return _hash(
        {
            "identity": identity,
            "total_pages": total_pages,
            "artifacts": [a for a in artifacts if a["id"] in needed],
            "parent_sha256": parent_sha256,
            "representation": {k: v for k, v in rep.items() if k != "sha256"},
        }
    )


def _validate(data):
    _keys(data, "schema identity total_pages inventory_basis artifacts representations")
    _require(data["schema"] == SCHEMA, "unsupported snapshot schema")
    identity = data["identity"]
    _keys(identity, "scope_id source_id version_id number sha256 size authority")
    for key in ("scope_id", "source_id", "version_id"):
        try:
            _require(
                type(identity[key]) is str
                and str(UUID(identity[key])) == identity[key],
                "invalid identity",
            )
        except (ValueError, AttributeError):
            raise IntegrityError("invalid identity") from None
    _integer(identity["number"], 1, 2**63 - 1)
    _integer(identity["size"], 1, MAX_ORIGINAL_BYTES)
    _digest(identity["sha256"])
    _require(
        identity["authority"] in ("offline_manifest", "persisted_receipt"),
        "invalid identity authority",
    )
    total_pages = data["total_pages"]
    _integer(total_pages, 1, MAX_PAGES)
    _string(data["inventory_basis"])
    _require(type(data["artifacts"]) is list, "invalid artifacts")
    artifact_pages = {"original": set(range(1, total_pages + 1))}
    for artifact in data["artifacts"]:
        _keys(
            artifact,
            "id sha256 size media_type physical_pages parents method method_version",
        )
        for key in ("id", "media_type", "method", "method_version"):
            _string(artifact[key])
        _require(artifact["id"] not in artifact_pages, "duplicate artifact")
        _digest(artifact["sha256"])
        _integer(artifact["size"], 1, MAX_ORIGINAL_BYTES)
        _unique(artifact["parents"])
        _require(
            bool(artifact["parents"])
            and all(p in artifact_pages for p in artifact["parents"]),
            "unknown artifact parent",
        )
        pages = artifact["physical_pages"]
        _require(type(pages) is list and bool(pages), "missing artifact page mapping")
        for number in pages:
            _integer(number, 1, total_pages)
        _require(pages == sorted(set(pages)), "invalid artifact page order")
        parent_pages = set().union(*(artifact_pages[p] for p in artifact["parents"]))
        _require(set(pages) <= parent_pages, "artifact page outside parent")
        artifact_pages[artifact["id"]] = set(pages)
    _require(
        type(data["representations"]) is list and bool(data["representations"]),
        "missing representations",
    )
    representations = {}
    characters = 0
    for rep in data["representations"]:
        _keys(
            rep,
            "id kind method method_version modality inputs content_artifacts derived_from pages status sha256",
        )
        for key in ("id", "method", "method_version"):
            _string(rep[key])
        _require(rep["id"] not in representations, "duplicate representation")
        _require(
            rep["kind"] in ("raw", "transformed", "reference"),
            "invalid representation kind",
        )
        _require(rep["modality"] == "text", "unsupported text modality")
        _unique(rep["content_artifacts"])
        _require(
            all(
                i in artifact_pages and i != "original"
                for i in rep["content_artifacts"]
            ),
            "unknown content artifact",
        )
        _unique(rep["inputs"])
        _require(
            bool(rep["inputs"]) and all(i in artifact_pages for i in rep["inputs"]),
            "unknown input artifact",
        )
        input_pages = set().union(*(artifact_pages[i] for i in rep["inputs"]))
        parent = None
        if rep["kind"] == "transformed":
            parent = representations.get(rep["derived_from"])
            _require(
                parent is not None and parent["kind"] != "reference",
                "invalid transformation parent",
            )
            _require(
                parent["inputs"] == rep["inputs"],
                "transformation input representation changed",
            )
        else:
            _require(
                rep["derived_from"] is None,
                "raw/reference cannot declare transformation parent",
            )
        pages = rep["pages"]
        _require(
            type(pages) is list and len(pages) == total_pages,
            "incomplete physical page inventory",
        )
        unit_ids, dependencies = set(), []
        for number, page in enumerate(pages, 1):
            _keys(page, "number state text reason units")
            _require(
                type(page["number"]) is int and page["number"] == number,
                "physical page reordered or renumbered",
            )
            _require(
                page["state"] in ("readable", "no_text", "failed", "not_processed"),
                "invalid page state",
            )
            _require(type(page["text"]) is str, "invalid page text")
            characters += len(page["text"])
            _require(
                characters <= MAX_TEXT_CHARACTERS,
                "snapshot text limit exceeded; nothing truncated",
            )
            if page["state"] == "readable":
                _require(bool(page["text"].strip()), "readable page has no text")
            elif page["state"] in ("no_text", "not_processed"):
                _require(not page["text"].strip(), "unread page contains text")
            if page["state"] in ("failed", "not_processed"):
                _string(page["reason"])
            else:
                _require(page["reason"] is None, "unexpected page failure reason")
            if page["state"] != "not_processed":
                _require(
                    number in input_pages, "processed page lacks input representation"
                )
            _require(type(page["units"]) is list, "invalid units")
            for unit in page["units"]:
                _keys(unit, "id start end role metadata dependencies")
                _string(unit["id"])
                _string(unit["role"])
                _require(unit["id"] not in unit_ids, "duplicate unit")
                unit_ids.add(unit["id"])
                _integer(unit["start"], 0, len(page["text"]))
                _integer(unit["end"], unit["start"] + 1, len(page["text"]))
                _require(type(unit["metadata"]) is dict, "invalid unit metadata")
                _unique(unit["dependencies"])
                dependencies.extend(unit["dependencies"])
        _require(set(dependencies) <= unit_ids, "unresolved unit dependency")
        expected_status = (
            "partial"
            if any(p["state"] in ("failed", "not_processed") for p in pages)
            else "processed"
        )
        _require(rep["status"] == expected_status, "page status contradicts inventory")
        _require(
            rep["sha256"]
            == _representation_hash(
                rep,
                identity,
                total_pages,
                data["artifacts"],
                parent["sha256"] if parent else None,
            ),
            "representation hash mismatch",
        )
        representations[rep["id"]] = rep


def parse_json(text):
    def unique_pairs(pairs):
        result = {}
        for key, value in pairs:
            _require(key not in result, "duplicate JSON key")
            result[key] = value
        return result

    try:
        return json.loads(
            text,
            object_pairs_hook=unique_pairs,
            parse_constant=lambda _: (_ for _ in ()).throw(
                IntegrityError("nonfinite JSON")
            ),
        )
    except (ValueError, TypeError, RecursionError):
        raise IntegrityError("invalid snapshot JSON") from None


@dataclass(frozen=True)
class Snapshot:
    """Deeply immutable canonical JSON; each data access returns a detached copy.

    A hash proves byte identity, not custody, ownership, or accuracy of a reference.
    Restore requires an independently retained digest; it does not read artifacts.
    The replay consumer revalidates original/artifact bytes before reconstruction.
    """

    canonical: str

    def __post_init__(self):
        data = parse_json(self.canonical)
        _validate(data)
        _require(self.canonical == canonical(data), "snapshot is not canonical")

    @property
    def sha256(self):
        return sha256(self.canonical.encode("utf-8"))

    @property
    def data(self):
        return parse_json(self.canonical)

    @classmethod
    def restore(cls, serialized, *, expected_sha256):
        _digest(expected_sha256)
        _require(
            type(serialized) is str
            and sha256(serialized.encode("utf-8")) == expected_sha256,
            "snapshot digest mismatch",
        )
        return cls(serialized)


def freeze(
    *, original, identity, total_pages, inventory_basis, artifacts, representations
):
    """Bind bytes and supplied observations; no parsing or authenticity inference."""
    _require(type(original) is bytes, "original must be bytes")
    _require(
        identity.get("sha256") == sha256(original)
        and identity.get("size") == len(original),
        "original bytes do not match source version",
    )
    descriptors = []
    for artifact in artifacts:
        item = dict(artifact)
        content = item.pop("content", None)
        _require(type(content) is bytes, "artifact must supply bytes")
        _require(
            "sha256" not in item and "size" not in item,
            "artifact hash must be computed",
        )
        descriptors.append({**item, "sha256": sha256(content), "size": len(content)})
    reps = []
    for source in representations:
        _require(
            "sha256" not in source and "status" not in source,
            "representation status/hash must be computed",
        )
        rep = dict(source)
        rep["status"] = (
            "partial"
            if any(p["state"] in ("failed", "not_processed") for p in rep["pages"])
            else "processed"
        )
        parent = next((p for p in reps if p["id"] == rep["derived_from"]), None)
        rep["sha256"] = _representation_hash(
            rep,
            identity,
            total_pages,
            descriptors,
            parent["sha256"] if parent else None,
        )
        reps.append(rep)
    data = {
        "schema": SCHEMA,
        "identity": identity,
        "total_pages": total_pages,
        "inventory_basis": inventory_basis,
        "artifacts": descriptors,
        "representations": reps,
    }
    try:
        serialized = canonical(data)
    except (TypeError, ValueError):
        raise IntegrityError("invalid JSON metadata") from None
    return Snapshot(serialized)


def _find(data, representation):
    for rep in data["representations"]:
        if rep["id"] == representation:
            return rep
    raise IntegrityError("unknown representation")


def _difference(before, after):
    differences = []
    for tag, i, j, k, m in SequenceMatcher(
        None, before, after, autojunk=False
    ).get_opcodes():
        if tag != "equal":
            differences.append(
                {
                    "operation": tag,
                    "source_start": i,
                    "source_end": j,
                    "target_start": k,
                    "target_end": m,
                    "before": before[i:j],
                    "after": after[k:m],
                }
            )
    return {
        "exact_equal": before == after,
        "reference_characters": len(before),
        "candidate_characters": len(after),
        "removed_characters": sum(
            d["source_end"] - d["source_start"] for d in differences
        ),
        "added_characters": sum(
            d["target_end"] - d["target_start"] for d in differences
        ),
        "differences": differences,
    }


def compare(
    snapshot, source_id, target_id, *, mode="transformation", max_diff_characters=20_000
):
    """Compare texts on the same input representation, never claim OCR fidelity."""
    _integer(max_diff_characters, 1, MAX_TEXT_CHARACTERS)
    data = snapshot.data
    source, target = _find(data, source_id), _find(data, target_id)
    _require(
        source["inputs"] == target["inputs"], "comparison input representations differ"
    )
    _require(source_id != target_id, "cannot compare representation to itself")
    if mode == "transformation":
        _require(
            target["derived_from"] == source_id,
            "comparison is not a declared transformation",
        )
    elif mode == "reference":
        _require(
            source["kind"] == "reference" and target["kind"] != "reference",
            "reference comparison requires a reference",
        )
    else:
        raise IntegrityError("unsupported comparison mode")
    results = []
    for left, right in zip(source["pages"], target["pages"], strict=True):
        page = {
            "number": left["number"],
            "source_state": left["state"],
            "target_state": right["state"],
            "visual_structure_verified": False,
        }
        if any(p["state"] in ("failed", "not_processed") for p in (left, right)):
            page.update(
                status="unavailable",
                source_reason=left["reason"],
                target_reason=right["reason"],
            )
        elif max(len(left["text"]), len(right["text"])) > max_diff_characters:
            page.update(status="comparison_limited", reason="diff_character_budget")
        else:
            before, after = left["text"], right["text"]
            a, b = before.split(), after.split()
            ca, cb = Counter(a), Counter(b)
            page.update(
                status="compared",
                **_difference(before, after),
                reference_words=len(a),
                candidate_words=len(b),
                missing_tokens=dict(ca - cb),
                added_tokens=dict(cb - ca),
                same_token_multiset=ca == cb,
                token_order_changed=ca == cb and a != b,
                structure_annotations_equal=left["units"] == right["units"],
                whitespace_collapsed=_difference(" ".join(a), " ".join(b)),
            )
        results.append(page)
    return {
        "schema": "aulalista-source-comparison.v1",
        "snapshot_sha256": snapshot.sha256,
        "mode": mode,
        "source_representation": source_id,
        "target_representation": target_id,
        "source_sha256": source["sha256"],
        "target_sha256": target["sha256"],
        "reference_supplied": mode == "reference",
        "independent_reference_verified": False,
        "textual_coverage_verified": False,
        "total_physical_pages": data["total_pages"],
        "compared_pages": sum(p["status"] == "compared" for p in results),
        "pages": results,
        "limitations": [
            "No OCR or semantic/visual verification.",
            "An initial extraction omission is invisible without an external reference.",
            "Sequence differences are not minimum edit distance or CER/WER.",
            "Equal tokens do not establish order, rows, columns or merged cells.",
        ],
    }


def compact_aliases(snapshot, representation_id):
    """A derived view only; retain all originals and dependency targets unchanged."""
    rep = _find(snapshot.data, representation_id)
    groups, lookup = [], {}
    for page in rep["pages"]:
        for unit in page["units"]:
            text = page["text"][unit["start"] : unit["end"]]
            key = (
                True,
                canonical(
                    {
                        "text": text,
                        "role": unit["role"],
                        "metadata": unit["metadata"],
                        "dependencies": unit["dependencies"],
                    }
                ),
            )
            # Only annotated headers/footers are eligible, within this representation.
            if unit["role"] not in ("header", "footer"):
                key = (False, unit["id"])
            if key in lookup:
                groups[lookup[key]]["occurrences"].append(unit["id"])
            else:
                lookup[key] = len(groups)
                groups.append(
                    {
                        "representative": unit["id"],
                        "occurrences": [unit["id"]],
                        "dependencies": unit["dependencies"],
                    }
                )
    return groups
