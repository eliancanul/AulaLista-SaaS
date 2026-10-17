"""Canonical mechanical evidence checks against a caller-controlled snapshot.

No Unicode normalization is used for literal checks. A substring is physical
support, never a test of entailment, negation, obligation or pedagogical truth.
"""

import math
import unicodedata
from collections import Counter
from dataclasses import dataclass
from uuid import UUID

from aulalista_api.source_integrity import (
    IntegrityError,
    Snapshot,
    canonical,
    parse_json,
    sha256,
)

STATES = ("literal", "derived", "inferred", "unknown", "conflict")
REFERENCE_FIELDS = set(
    "owner_id scope_id source_id version_id number original_sha256 snapshot_sha256 representation_id representation_sha256 page start end quote".split()
)


def _require(condition, message):
    if not condition:
        raise IntegrityError(message)


def _nonempty(value):
    return type(value) is str and bool(value.strip())


def _fingerprint(value):
    return sha256(canonical(value).encode("utf-8"))


@dataclass(frozen=True)
class VerificationContext:
    """Trusted caller policy, not authentication derived from a model or file."""

    snapshot: Snapshot
    owner_id: str
    scope_id: str
    targets_json: str

    def __post_init__(self):
        _require(isinstance(self.snapshot, Snapshot), "snapshot required")
        try:
            _require(
                str(UUID(self.owner_id)) == self.owner_id, "invalid owner identity"
            )
        except (ValueError, TypeError, AttributeError):
            raise IntegrityError("invalid owner identity") from None
        data = self.snapshot.data
        _require(
            self.scope_id == data["identity"]["scope_id"],
            "scope differs from pinned snapshot",
        )
        targets = parse_json(self.targets_json)
        _require(type(targets) is list and bool(targets), "expected targets required")
        reps = {rep["id"] for rep in data["representations"]}
        seen = set()
        for target in targets:
            _require(
                type(target) is dict
                and set(target) == {"id", "role", "context_id", "representation_id"},
                "invalid target policy",
            )
            _require(
                _nonempty(target["id"]) and target["id"] not in seen,
                "duplicate or invalid target",
            )
            seen.add(target["id"])
            _require(
                target["representation_id"] in reps,
                "target source representation is unknown",
            )
            for name in ("role", "context_id"):
                _require(
                    target[name] is None or _nonempty(target[name]),
                    "invalid structural requirement",
                )
        _require(
            self.targets_json == canonical(sorted(targets, key=lambda t: t["id"])),
            "target policy must be canonical",
        )

    @classmethod
    def create(cls, snapshot, *, owner_id, scope_id, expected_snapshot_sha256, targets):
        _require(
            snapshot.sha256 == expected_snapshot_sha256,
            "pinned snapshot digest mismatch",
        )
        return cls(
            snapshot,
            owner_id,
            scope_id,
            canonical(sorted(targets, key=lambda t: t["id"])),
        )

    @property
    def targets(self):
        return parse_json(self.targets_json)

    @property
    def sha256(self):
        return _fingerprint(
            {
                "owner_id": self.owner_id,
                "scope_id": self.scope_id,
                "snapshot_sha256": self.snapshot.sha256,
                "targets": self.targets,
            }
        )

    def target(self, target_id):
        for target in self.targets:
            if target["id"] == target_id:
                return target
        raise IntegrityError("unknown target")


def _representation(context, target):
    return next(
        r
        for r in context.snapshot.data["representations"]
        if r["id"] == target["representation_id"]
    )


def reference(context, target_id, page, start, end):
    """Build a reference to exact text already selected by a trusted consumer.

    This helper grants no verdict. An untrusted claim is still independently checked.
    """
    target = context.target(target_id)
    rep = _representation(context, target)
    _require(
        type(page) is int and 1 <= page <= len(rep["pages"]), "invalid physical page"
    )
    text = rep["pages"][page - 1]["text"]
    _require(
        type(start) is int and type(end) is int and 0 <= start < end <= len(text),
        "invalid character range",
    )
    identity = context.snapshot.data["identity"]
    return {
        "owner_id": context.owner_id,
        "scope_id": context.scope_id,
        "source_id": identity["source_id"],
        "version_id": identity["version_id"],
        "number": identity["number"],
        "original_sha256": identity["sha256"],
        "snapshot_sha256": context.snapshot.sha256,
        "representation_id": rep["id"],
        "representation_sha256": rep["sha256"],
        "page": page,
        "start": start,
        "end": end,
        "quote": text[start:end],
    }


def _check_reference(context, target, ref):
    if type(ref) is not dict or set(ref) != REFERENCE_FIELDS:
        return "malformed_reference"
    identity = context.snapshot.data["identity"]
    expected = {
        "owner_id": context.owner_id,
        "scope_id": context.scope_id,
        "source_id": identity["source_id"],
        "version_id": identity["version_id"],
        "number": identity["number"],
        "original_sha256": identity["sha256"],
        "snapshot_sha256": context.snapshot.sha256,
        "representation_id": target["representation_id"],
    }
    if any(type(ref[k]) is not type(v) or ref[k] != v for k, v in expected.items()):
        return "source_binding_mismatch"
    rep = _representation(context, target)
    if ref["representation_sha256"] != rep["sha256"]:
        return "representation_hash_mismatch"
    page = ref["page"]
    if type(page) is not int or not 1 <= page <= len(rep["pages"]):
        return "invalid_physical_page"
    source = rep["pages"][page - 1]
    if source["state"] != "readable":
        return "page_not_readable"
    start, end = ref["start"], ref["end"]
    if (
        type(start) is not int
        or type(end) is not int
        or not 0 <= start < end <= len(source["text"])
    ):
        return "invalid_character_range"
    if not _nonempty(ref["quote"]) or source["text"][start:end] != ref["quote"]:
        return "quote_mismatch"
    if target["role"] is not None or target["context_id"] is not None:
        # These annotations come only from the controlled source, never the claim.
        matching = [
            u
            for u in source["units"]
            if u["start"] <= start
            and end <= u["end"]
            and (target["role"] is None or u["role"] == target["role"])
            and (
                target["context_id"] is None
                or u["metadata"].get("context_id") == target["context_id"]
            )
        ]
        if not matching:
            return "structural_role_or_context_unproven"
    return None


def candidates(context, target_id, text):
    """Accent/case-tolerant page candidates only, never citation offsets or verdicts."""
    _require(_nonempty(text), "candidate search needs text")

    def fold(value):
        return "".join(
            c
            for c in unicodedata.normalize("NFD", value).casefold()
            if not unicodedata.combining(c)
        )

    needle = fold(text)
    return [
        {
            "target": target_id,
            "page": p["number"],
            "literal_verified": False,
            "method": "NFD-remove-combining-casefold; candidate only",
        }
        for p in _representation(context, context.target(target_id))["pages"]
        if needle and p["state"] == "readable" and needle in fold(p["text"])
    ]


def _integer_span(text, start, end):
    """A conservative delimiter whitelist, not a numeric/locale/quantity parser.

    Inspect full source neighbors outside any cropped quote. Unknown punctuation
    or symbols cause abstention; matching only the requested digits is not enough.
    """
    before, after = text[:start], text[end:]
    left, right = before[-1:], after[:1]
    left_safe = ":;([{\"'«“‘"
    right_safe = ";:!?)]}\"'»”’"
    if left and not (left.isspace() or left in left_safe):
        return False
    if right and not (right.isspace() or right in right_safe + ".,"):
        return False
    preceding, following = before.rstrip(), after.lstrip()
    # Across whitespace, allow ordinary words or known delimiters, but not
    # signs, mathematical symbols, grouped digits or unknown punctuation.
    if left.isspace() and preceding:
        previous = preceding[-1]
        if not (previous.isalpha() or previous in left_safe):
            return False
    if right.isspace() and following:
        subsequent = following[0]
        if not (subsequent.isalpha() or subsequent in right_safe + ".,"):
            return False
    # A terminal sentence dot/comma is allowed; decimal parts (also spaced)
    # are not. This intentionally abstains on some lists of adjacent numbers.
    if following[:1] in (".", ","):
        tail = following[1:]
        if tail and not (tail[0].isspace() or tail[0] in ")]}\"'»”’"):
            return False
        if tail.lstrip()[:1].isdigit() or tail.lstrip()[:1] in (".", ","):
            return False
    if following[:1] in ("e", "E"):
        exponent = following[1:].lstrip().lstrip("+-−").lstrip()[:1]
        if exponent.isdigit():
            return False
    # Time/ratio components are not independent integers. Field labels such as
    # "Duration:60" are allowed when the other side of ':' is not numerical.
    if preceding.endswith(":") and preceding[:-1].rstrip()[-1:].isdigit():
        return False
    if following.startswith(":"):
        following_number = following[1:].lstrip().lstrip("+-−").lstrip()[:1]
        if following_number.isdigit():
            return False
    return True


def _integer_operand(context, checked):
    if checked["state"] == "derived":
        return True  # Its inputs have already passed this same check.
    value = checked["value"]
    for occurrence in checked["occurrences"]:
        supported = False
        for ref in occurrence["evidence"]:
            rep = _representation(context, context.target(checked["target"]))
            text = rep["pages"][ref["page"] - 1]["text"]
            offset = ref["quote"].find(value)
            while offset != -1:
                start = ref["start"] + offset
                if _integer_span(text, start, start + len(value)):
                    supported = True
                    break
                offset = ref["quote"].find(value, offset + 1)
        if not supported:
            return False
    return True


def _one(context, target, claim, resolve):
    kind, value = claim.get("kind"), claim.get("value")
    result = {
        "state": "unknown",
        "kind_requested": kind,
        "value": value,
        "reasons": [],
        "evidence": [],
        "derivation": None,
    }
    refs = claim.get("evidence", [])
    if type(refs) is not list:
        result["reasons"] = ["invalid_evidence_list"]
        return result
    errors = [_check_reference(context, target, ref) for ref in refs]
    if any(errors):
        result["reasons"] = sorted(set(e for e in errors if e))
        return result
    result["evidence"] = sorted(refs, key=canonical)
    if kind == "unknown":
        result["reasons"] = ["explicitly_unknown"]
    elif kind == "conflict":
        result.update(state="conflict", reasons=["explicit_conflict_requires_review"])
    elif kind == "inferred":
        if not _nonempty(value):
            result["reasons"] = ["inference_value_missing"]
        else:
            result.update(state="inferred", reasons=["semantic_review_required"])
    elif kind == "literal":
        values = value if type(value) is list else [value]
        if not values or not all(_nonempty(v) for v in values):
            result["reasons"] = ["literal_value_missing"]
        elif not refs:
            result["reasons"] = ["citation_missing"]
        elif not all(any(v in ref["quote"] for ref in refs) for v in values):
            result["reasons"] = ["value_not_in_one_contiguous_quote"]
        else:
            result["state"] = "literal"
    elif kind == "derived":
        derivation = claim.get("derivation")
        if type(derivation) is not dict or set(derivation) != {"rule", "inputs"}:
            result["reasons"] = ["invalid_derivation"]
            return result
        rule, inputs = derivation["rule"], derivation["inputs"]
        if rule not in ("sum_integers", "multiply_integers"):
            result["reasons"] = ["unsupported_derivation_rule"]
        elif (
            type(inputs) is not list
            or not 1 <= len(inputs) <= 128
            or not all(_nonempty(i) for i in inputs)
            or len(set(inputs)) != len(inputs)
        ):
            result["reasons"] = ["invalid_or_duplicate_derivation_inputs"]
        else:
            checked = [resolve(i) for i in inputs]
            if any(
                c["state"] not in ("literal", "derived")
                or type(c["value"]) is not str
                or not c["value"].isascii()
                or not c["value"].isdecimal()
                or len(c["value"]) > 10
                or str(int(c["value"])) != c["value"]
                or not _integer_operand(context, c)
                for c in checked
            ):
                result["reasons"] = [
                    "derivation_input_unverified_or_not_canonical_integer"
                ]
            else:
                numbers = [int(c["value"]) for c in checked]
                computed = (
                    sum(numbers) if rule == "sum_integers" else math.prod(numbers)
                )
                if (
                    computed > 2**63 - 1
                    or type(value) is not str
                    or value != str(computed)
                ):
                    result["reasons"] = ["derivation_value_mismatch_or_limit"]
                else:
                    result.update(
                        state="derived",
                        derivation={
                            "rule": rule,
                            "inputs": inputs,
                            "verified_inputs": [
                                {
                                    "target": c["target"],
                                    "value": c["value"],
                                    "result_sha256": _fingerprint(c),
                                }
                                for c in checked
                            ],
                            "arithmetic_verified": True,
                            "units_or_semantics_verified": False,
                        },
                    )
    else:
        result["reasons"] = ["unsupported_claim_kind"]
    return result


def _project(context, claims):
    policies = {t["id"]: t for t in context.targets}
    groups = {key: [] for key in policies}
    extras = []
    for claim in claims:
        if (
            type(claim) is not dict
            or type(claim.get("target")) is not str
            or claim["target"] not in policies
        ):
            extras.append({"reason": "unknown_or_malformed_target", "claim": claim})
        else:
            groups[claim["target"]].append(claim)
    results, visiting = {}, set()

    def resolve(target_id):
        if target_id not in groups or target_id in visiting:
            return {
                "target": target_id,
                "state": "unknown",
                "value": None,
                "reasons": ["missing_or_cyclic_derivation_target"],
                "occurrences": [],
            }
        if target_id in results:
            return results[target_id]
        visiting.add(target_id)
        group = groups[target_id]
        occurrences = sorted(
            (_one(context, policies[target_id], c, resolve) for c in group),
            key=canonical,
        )
        signatures = {canonical([c.get("kind"), c.get("value")]) for c in group}
        value = (
            occurrences[0]["value"] if len(signatures) == 1 and occurrences else None
        )
        if not group:
            state, reasons = "unknown", ["claim_missing"]
        elif len(signatures) > 1:
            state, reasons = "conflict", ["incompatible_duplicate_values_or_kinds"]
        elif len({o["state"] for o in occurrences}) > 1:
            state, reasons = "unknown", ["not_all_duplicate_claims_verified"]
        else:
            state = occurrences[0]["state"]
            reasons = sorted({r for o in occurrences for r in o["reasons"]})
        result = {
            "target": target_id,
            "state": state,
            "value": value,
            "reasons": reasons,
            "occurrences": occurrences,
            "literal_mechanically_verified": state == "literal",
            "semantic_correctness_verified": False,
        }
        results[target_id] = result
        visiting.remove(target_id)
        return result

    output = [resolve(key) for key in sorted(policies)]
    counts = Counter(row["state"] for row in output)
    return {
        "schema": "aulalista-evidence-projection.v1",
        "context_sha256": context.sha256,
        "snapshot_sha256": context.snapshot.sha256,
        "target_count": len(policies),
        "input_claims": len(claims),
        "duplicate_claims": sum(max(0, len(g) - 1) for g in groups.values()),
        "counts": {state: counts[state] for state in STATES},
        "results": output,
        "extra_claims": sorted(extras, key=canonical),
        "semantic_correctness_verified": False,
        "normalization": "none; exact Unicode code points including punctuation and whitespace",
    }


@dataclass(frozen=True)
class VerifiedBatch:
    """Raw claims are immutable; all public projections are freshly revalidated.

    There is no stored checked/backed flag that can outlive a rejected verdict.
    Restoring a serialized result requires its retained digest and the pinned
    trusted context, then compares a complete recomputation with the saved result.
    """

    context: VerificationContext
    claims_json: str

    def __post_init__(self):
        _require(
            isinstance(self.context, VerificationContext),
            "trusted verification context required",
        )
        claims = parse_json(self.claims_json)
        _require(
            type(claims) is list
            and self.claims_json == canonical(sorted(claims, key=canonical)),
            "claims must be a canonical list",
        )

    @classmethod
    def from_claims(cls, context, claims):
        _require(type(claims) is list, "claims list required")
        return cls(context, canonical(sorted(claims, key=canonical)))

    def project(self):
        return _project(self.context, parse_json(self.claims_json))

    def serialize(self):
        return canonical(
            {
                "schema": "aulalista-verified-batch.v1",
                "context_sha256": self.context.sha256,
                "claims": parse_json(self.claims_json),
                "projection": self.project(),
            }
        )

    @property
    def sha256(self):
        return sha256(self.serialize().encode("utf-8"))

    @classmethod
    def restore(cls, context, serialized, *, expected_sha256):
        _require(
            sha256(serialized.encode("utf-8")) == expected_sha256,
            "verified batch digest mismatch",
        )
        data = parse_json(serialized)
        _require(
            type(data) is dict
            and set(data) == {"schema", "context_sha256", "claims", "projection"},
            "invalid verified batch",
        )
        _require(
            data["schema"] == "aulalista-verified-batch.v1"
            and data["context_sha256"] == context.sha256,
            "verification context changed",
        )
        batch = cls.from_claims(context, data["claims"])
        _require(
            batch.serialize() == serialized,
            "saved verdict differs from canonical revalidation",
        )
        return batch
