#!/usr/bin/env python3
"""Offline-only request preparation and receipt scoring. Never calls a model."""

import argparse
import hashlib
import json
import math
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PREDICATES = {"activity", "group", "order", "materials", "duration_minutes"}
VARIANTS = {"full", "dedup", "segmented"}


def digest(value):
    return hashlib.sha256(value).hexdigest()


def strict_json_loads(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError(f"Duplicate JSON key: {key}")
            result[key] = value
        return result

    def finite_number(value):
        number = float(value)
        if not math.isfinite(number):
            raise ValueError("Non-finite JSON number")
        return number

    def invalid_constant(value):
        raise ValueError(f"Non-standard JSON constant: {value}")

    return json.loads(
        raw,
        object_pairs_hook=pairs,
        parse_float=finite_number,
        parse_constant=invalid_constant,
    )


def read(path):
    return strict_json_loads(Path(path).read_text(encoding="utf-8"))


def require(condition, message="Invalid benchmark data"):
    if not condition:
        raise ValueError(message)


def content_digest(source):
    return digest(
        json.dumps(
            source, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode()
    )


def validate_source(source):
    require(source["synthetic"] is True, "This runner only admits synthetic sources")
    require(
        source["split"] in {"development", "validation"},
        "Holdout requires custody protocol",
    )
    blocks = source["blocks"]
    ids = [b["id"] for b in blocks]
    require(len(ids) == len(set(ids)) and len(ids) > 0, "Invalid benchmark data")
    units = set(source["units"])
    require(
        units and all(isinstance(u, str) and u for u in units), "Invalid benchmark data"
    )
    for b in blocks:
        require(isinstance(b["text"], str) and b["text"], "Invalid benchmark data")
        require(isinstance(b["page"], int) and b["page"] >= 1, "Invalid benchmark data")
        require(b["unit"] is None or b["unit"] in units, "Invalid benchmark data")
        require(set(b.get("dependencies", [])) <= set(ids), "Invalid benchmark data")
        require(isinstance(b.get("dedup_safe", False), bool), "Invalid benchmark data")
    return source


def deduplicate(blocks):
    """Only exact preannotated running furniture; never activities/table rows."""
    found, result = {}, []
    for original in blocks:
        b = dict(
            original, aliases=[{"block_id": original["id"], "page": original["page"]}]
        )
        if b["kind"] in {"running_header", "running_footer"} and b.get("dedup_safe"):
            key = json.dumps(
                {k: v for k, v in original.items() if k not in {"id", "page"}},
                sort_keys=True,
                ensure_ascii=False,
            )
            if key in found:
                found[key]["aliases"].extend(b["aliases"])
                continue
            found[key] = b
        result.append(b)
    return result


def select_blocks(source, unit):
    """Keep global semantic context plus transitive explicit dependencies."""
    by_id = {b["id"]: b for b in source["blocks"]}
    selected = {
        b["id"]
        for b in source["blocks"]
        if b["unit"] == unit
        or (b["unit"] is None and not b.get("omit_for_task", False))
    }
    frontier = list(selected)
    while frontier:
        for dependency in by_id[frontier.pop()].get("dependencies", []):
            if dependency not in selected:
                selected.add(dependency)
                frontier.append(dependency)
    return [b for b in source["blocks"] if b["id"] in selected]


def requests(source, variant, question_remaining=1):
    validate_source(source)
    require(
        variant in VARIANTS and question_remaining in (0, 1), "Invalid benchmark data"
    )
    instruction = (ROOT / "prompts/interpret.txt").read_text()
    subjects = source["subjects"]
    groups = (
        [(None, source["blocks"])]
        if variant != "segmented"
        else [(unit, select_blocks(source, unit)) for unit in source["units"]]
    )
    answer = []
    for index, (unit, blocks) in enumerate(groups, start=1):
        payload = {
            "planning_id": source["planning_id"],
            "source_version": source["version"],
            "clarification_budget_remaining": question_remaining,
            "requested_subjects": [
                s for s, u in subjects.items() if unit is None or u == unit
            ],
            "blocks": blocks if variant == "full" else deduplicate(blocks),
        }
        answer.append(
            {
                "request_id": f"{source['id']}:{variant}:{index}",
                "stage": "interpret",
                "unit": unit,
                "system": instruction,
                "input": payload,
            }
        )
    return answer


def repair_request(
    source, variant, affected_units, previous_output, diagnostics, question_remaining
):
    validate_source(source)
    require(variant in {"full_retry", "localized_repair"}, "Invalid benchmark data")
    require(
        affected_units and set(affected_units) <= set(source["units"]),
        "Invalid benchmark data",
    )
    require(
        diagnostics
        and all(
            d.get("origin") in {"schema", "evidence", "internal_consistency"}
            for d in diagnostics
        ),
        "Invalid benchmark data",
    )
    require(question_remaining in (0, 1), "Invalid benchmark data")
    ids = {b["id"] for unit in affected_units for b in select_blocks(source, unit)}
    blocks = (
        source["blocks"]
        if variant == "full_retry"
        else [b for b in source["blocks"] if b["id"] in ids]
    )
    subjects = [s for s, u in source["subjects"].items() if u in affected_units]
    # Full retry changes source context size, not the repair task/response scope.
    return {
        "stage": "repair",
        "variant": variant,
        "system": (ROOT / "prompts/interpret.txt").read_text()
        + "\n"
        + (ROOT / "prompts/repair.txt").read_text(),
        "input": {
            "planning_id": source["planning_id"],
            "source_version": source["version"],
            "clarification_budget_remaining": question_remaining,
            "requested_subjects": subjects,
            "blocks": blocks,
            "previous_output": previous_output,
            "diagnostics": diagnostics,
        },
    }


def evidence_shape_valid(evidence):
    return isinstance(evidence, list) and all(
        isinstance(item, dict)
        and isinstance(item.get("block_id"), str)
        and isinstance(item.get("quote"), str)
        for item in evidence
    )


def evidence_valid(evidence, source, required):
    by_id = {b["id"]: b for b in source["blocks"]}
    if not evidence or not isinstance(evidence, list):
        return False
    found = set()
    for e in evidence:
        if (
            not isinstance(e, dict)
            or not isinstance(e.get("block_id"), str)
            or e["block_id"] not in by_id
        ):
            return False
        quote = e.get("quote")
        if (
            not isinstance(quote, str)
            or not quote
            or quote not in by_id[e["block_id"]]["text"]
        ):
            return False
        found.add(e["block_id"])
    return set(required) <= found


def score(source, reference, prediction):
    """Discrete synthetic conformance only; semantic judgment stays separate."""
    validate_source(source)
    require(
        reference["source_content_sha256"] == content_digest(source),
        "Reference/source mismatch",
    )
    require(reference["source_id"] == source["id"], "Invalid benchmark data")
    require(
        reference["reference_kind"] == "synthetic_ai_authored", "Invalid benchmark data"
    )
    expected = {(f["subject"], f["predicate"]): f for f in reference["facts"]}
    require(len(expected) == len(reference["facts"]), "Invalid benchmark data")
    schema_valid = (
        isinstance(prediction, dict)
        and set(prediction) == {"claims", "pending", "clarification"}
        and isinstance(prediction.get("claims"), list)
        and isinstance(prediction.get("pending"), list)
    )
    records = prediction.get("claims", []) if schema_valid else []
    found, duplicates, extras, invalid = {}, [], [], []
    for item in records:
        if not isinstance(item, dict) or set(item) != {
            "subject",
            "predicate",
            "value",
            "evidence",
        }:
            invalid.append(item)
            continue
        if (
            not isinstance(item["subject"], str)
            or not isinstance(item["predicate"], str)
            or item["predicate"] not in PREDICATES
        ):
            invalid.append(item)
            continue
        predicate, value = item["predicate"], item["value"]
        typed = (
            (predicate == "activity" and isinstance(value, str) and bool(value))
            or (predicate == "group" and (value is None or isinstance(value, str)))
            or (predicate == "order" and type(value) is int and value >= 1)
            or (
                predicate == "duration_minutes"
                and (value is None or (type(value) is int and value > 0))
            )
            or (
                predicate == "materials"
                and isinstance(value, list)
                and all(isinstance(x, str) and x for x in value)
            )
        )
        if not typed or not evidence_shape_valid(item["evidence"]):
            invalid.append(item)
            continue
        key = (item["subject"], item["predicate"])
        if key in found:
            duplicates.append(list(key))
        elif key not in expected:
            extras.append(list(key))
        found.setdefault(key, []).append(item)
    rows = []
    for key, ref in expected.items():
        claims = found.get(key, [])
        value_ok = bool(claims) and all(
            actual["value"] == ref["value"]
            and type(actual["value"]) is type(ref["value"])
            for actual in claims
        )
        citation_ok = bool(claims) and all(
            evidence_valid(actual["evidence"], source, ref["evidence_blocks"])
            for actual in claims
        )
        rows.append(
            {
                "field": ".".join(key),
                "critical": ref["critical"],
                "value_ok": value_ok,
                "evidence_ok": citation_ok,
                "joint_ok": value_ok and citation_ok,
            }
        )
    pending_items = prediction.get("pending", []) if schema_valid else []
    pending_valid = all(
        isinstance(p, dict)
        and set(p) == {"field", "alternatives", "evidence"}
        and isinstance(p["field"], str)
        and isinstance(p["alternatives"], list)
        and len(p["alternatives"]) >= 2
        and evidence_shape_valid(p["evidence"])
        for p in pending_items
    )
    pending = {
        p["field"]: p
        for p in pending_items
        if isinstance(p, dict) and isinstance(p.get("field"), str)
    }
    pending_valid = pending_valid and len(pending) == len(pending_items)
    ambiguity_hits = 0
    for expected_pending in reference["pending"]:
        actual = pending.get(expected_pending["field"])
        if (
            actual
            and actual.get("alternatives") == expected_pending["alternatives"]
            and evidence_valid(
                actual.get("evidence"), source, expected_pending["evidence_blocks"]
            )
        ):
            ambiguity_hits += 1
    clarification = prediction.get("clarification") if schema_valid else None
    clarification_valid = clarification is None or (
        isinstance(clarification, dict)
        and set(clarification) == {"field", "question"}
        and isinstance(clarification["question"], str)
        and bool(clarification["question"].strip())
        and isinstance(clarification["field"], str)
        and clarification["field"] in pending
    )
    critical = [r for r in rows if r["critical"]]
    return {
        "schema_valid": schema_valid
        and not invalid
        and clarification_valid
        and pending_valid,
        "facts": {
            "correct": sum(r["joint_ok"] for r in rows),
            "denominator": len(rows),
        },
        "critical": {
            "correct": sum(r["joint_ok"] for r in critical),
            "denominator": len(critical),
        },
        "ambiguity": {
            "detected": ambiguity_hits,
            "denominator": len(reference["pending"]),
            "unexpected_fields": sorted(
                set(pending) - {p["field"] for p in reference["pending"]}
            ),
        },
        "unexpected_claims": extras,
        "duplicate_claims": duplicates,
        "invalid_claim_count": len(invalid),
        "clarification_proposed": clarification is not None,
        "manual_semantic_review_required": True,
        "teacher_evidence": False,
        "details": rows,
    }


def audit_questions(events):
    """One presented question per stable planning identity, across files/retries/versions."""
    questions, failures = {}, []
    for event in events:
        key = (event["trial_id"], event["planning_id"])
        question = event["question_id"]
        known = questions.setdefault(key, set())
        if event["event"] == "presented":
            if question in known:
                failures.append(
                    "duplicate presented event: use restored for the same pending question"
                )
            known.add(question)
            if len(known) > 1:
                failures.append(f"question budget exceeded: {key}")
        elif event["event"] == "restored":
            if question not in known:
                failures.append("restored unknown question")
        elif event["event"] != "answered":
            failures.append("unknown question event")
        elif question not in known:
            failures.append("answered unknown question")
    return {
        "valid": not failures,
        "violations": failures,
        "counts": [
            {"trial_id": t, "planning_id": p, "questions": len(ids)}
            for (t, p), ids in questions.items()
        ],
    }


def bind_raw_receipt(attempt, receipt_root):
    """Only the synthetic fixture envelope is supported; no native adapter exists."""
    require(
        receipt_root is not None, "Receipt directory required to verify raw evidence"
    )
    # Import works for the CLI and for direct module imports without modifying sys.path.
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "receipt_paths", ROOT / "scripts/freeze.py"
    )
    paths = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(paths)
    raw = paths.local_file(
        Path(receipt_root), attempt.get("raw_receipt_path")
    ).read_bytes()
    require(
        digest(raw) == attempt.get("raw_receipt_sha256"), "Raw receipt hash mismatch"
    )
    receipt = strict_json_loads(raw)
    require(isinstance(receipt, dict), "Raw receipt must be a JSON object")
    if attempt.get("usage_source") != "provider_reported":
        require(
            attempt.get("cost") is None,
            "Unverified receipt cannot report verified cost",
        )
        return
    require(
        receipt.get("schema") == "aulalista-synthetic-receipt.v1"
        and receipt.get("synthetic") is True,
        "Unsupported native receipt: a verified provider adapter is still required",
    )
    for key in (
        "provider",
        "model",
        "usage_semantics_id",
        "provider_request_id",
        "usage",
        "cost",
    ):
        require(
            key in receipt and key in attempt, f"Missing receipt binding field: {key}"
        )
        require(
            json.dumps(receipt[key], sort_keys=True, allow_nan=False)
            == json.dumps(attempt[key], sort_keys=True, allow_nan=False),
            f"Raw receipt/metadata mismatch: {key}",
        )


def summarize_receipts(run, receipt_root=None):
    require(
        isinstance(run, dict) and isinstance(run.get("attempts"), list),
        "Invalid run attempts",
    )
    attempts = run["attempts"]
    require(all(isinstance(a, dict) for a in attempts), "Invalid attempt object")
    require(attempts, "No model calls recorded; cannot produce usage metrics")
    ids = [a.get("attempt_id") for a in attempts]
    require(
        all(isinstance(value, str) and value.strip() for value in ids),
        "Invalid attempt identity",
    )
    require(len(ids) == len(set(ids)), "Duplicate attempt receipt")
    provider_requests, raw_paths = set(), set()
    known_tokens, missing, namespaces, currencies, known_cost = 0, [], set(), set(), 0
    cost_missing, stage_ms = [], {}
    components = {
        name: {"reported_sum": 0, "missing_attempts": []}
        for name in (
            "input_tokens",
            "cached_input_tokens",
            "output_tokens",
            "reasoning_output_tokens",
        )
    }
    for attempt in attempts:
        require(
            attempt.get("usage_source") in {"provider_reported", "unknown"},
            "Unknown usage source",
        )
        bind_raw_receipt(attempt, receipt_root)
        raw_path = attempt["raw_receipt_path"]
        require(raw_path not in raw_paths, "Duplicate raw receipt path")
        raw_paths.add(raw_path)
        if attempt.get("usage_source") == "provider_reported":
            for key in (
                "provider",
                "model",
                "usage_semantics_id",
                "provider_request_id",
            ):
                require(
                    isinstance(attempt.get(key), str) and attempt[key].strip(),
                    f"Missing {key}",
                )
            identity = (attempt["provider"], attempt["provider_request_id"])
            require(
                identity not in provider_requests, "Duplicate provider request receipt"
            )
            provider_requests.add(identity)
        require(isinstance(attempt.get("usage"), dict), "Invalid usage object")
        require(
            isinstance(attempt.get("stage"), str) and attempt["stage"].strip(),
            "Missing stage",
        )
        require(
            isinstance(attempt.get("status"), str) and attempt["status"].strip(),
            "Missing status",
        )
        namespaces.add(
            (
                attempt.get("provider"),
                attempt.get("model"),
                attempt.get("usage_semantics_id"),
            )
        )
        usage = attempt["usage"]
        scope = attempt.get("usage_scope", {})
        require(isinstance(scope, dict), "Invalid usage scope")
        for flag, child, parent in (
            ("cached_is_subset_of_input", "cached_input_tokens", "input_tokens"),
            (
                "reasoning_is_subset_of_output",
                "reasoning_output_tokens",
                "output_tokens",
            ),
        ):
            require(
                scope.get(flag) is None or type(scope[flag]) is bool,
                "Invalid subset declaration",
            )
            if (
                scope.get(flag) is True
                and usage.get(child) is not None
                and usage.get(parent) is not None
            ):
                require(
                    type(usage[child]) is int
                    and type(usage[parent]) is int
                    and 0 <= usage[child] <= usage[parent],
                    "Contradictory declared token subset",
                )
        for name, item in components.items():
            value = usage.get(name)
            if value is None or attempt.get("usage_source") != "provider_reported":
                item["missing_attempts"].append(attempt["attempt_id"])
            else:
                require(type(value) is int and value >= 0, "Invalid benchmark data")
                item["reported_sum"] += value
        total = usage.get("total_tokens")
        if total is None or attempt.get("usage_source") != "provider_reported":
            missing.append(attempt["attempt_id"])
        else:
            require(type(total) is int and total >= 0, "Invalid benchmark data")
            known_tokens += total
        # Details can overlap total/input/output; never add cached/reasoning a second time.
        cost = attempt.get("cost")
        require(cost is None or isinstance(cost, dict), "Invalid cost object")
        if cost is None or cost.get("amount") is None:
            cost_missing.append(attempt["attempt_id"])
        else:
            require(
                type(cost["amount"]) in (int, float)
                and math.isfinite(cost["amount"])
                and cost["amount"] >= 0,
                "Invalid benchmark data",
            )
            known_cost += cost["amount"]
            require(
                isinstance(cost.get("currency"), str) and cost["currency"].strip(),
                "Missing cost currency",
            )
            currencies.add(cost["currency"])
        elapsed = attempt.get("latency_ms")
        if elapsed is not None:
            require(
                type(elapsed) in (int, float)
                and math.isfinite(elapsed)
                and elapsed >= 0,
                "Invalid benchmark data",
            )
            stage_ms[attempt["stage"]] = stage_ms.get(attempt["stage"], 0) + elapsed
    same_units = len(namespaces) == 1 and all(
        isinstance(x, str) and x.strip() for x in next(iter(namespaces))
    )
    useful = run.get("time_to_first_useful_persisted_ms")
    require(
        useful is None
        or (type(useful) in (int, float) and math.isfinite(useful) and useful >= 0),
        "Invalid time to first useful result",
    )
    wall = None
    if run.get("started_at") and run.get("ended_at"):
        wall = (
            datetime.fromisoformat(run["ended_at"])
            - datetime.fromisoformat(run["started_at"])
        ).total_seconds() * 1000
        require(wall >= 0, "Invalid benchmark data")
    return {
        "usage_evidence_kind": "synthetic_fixture_envelope_only",
        "real_provider_usage_verified": False,
        "attempt_count": len(attempts),
        "failed_attempt_count": sum(a["status"] != "success" for a in attempts),
        "total_tokens": known_tokens if not missing and same_units else None,
        "known_token_subtotal": known_tokens if same_units else None,
        "missing_usage_attempts": missing,
        "native_usage_comparable": same_units,
        "usage_components_separate_not_additive": components if same_units else None,
        "cost_total": known_cost if not cost_missing and len(currencies) == 1 else None,
        "known_cost_subtotal": known_cost if len(currencies) <= 1 else None,
        "cost_currency": next(iter(currencies)) if len(currencies) == 1 else None,
        "missing_cost_attempts": cost_missing,
        "wall_latency_ms": wall,
        "summed_attempt_latency_ms_by_stage": stage_ms,
        "time_to_first_useful_persisted_ms": run.get(
            "time_to_first_useful_persisted_ms"
        ),
        "questions": audit_questions(run.get("question_events", [])),
        "weighted_score": None,
        "score_status": "not_computed_weights_and_quality_gates_pending",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    prepare = sub.add_parser("prepare")
    prepare.add_argument("source", type=Path)
    prepare.add_argument("--variant", choices=sorted(VARIANTS), required=True)
    prepare.add_argument("--question-budget", type=int, choices=(0, 1), default=1)
    prepare.add_argument("--out", type=Path, required=True)
    scoring = sub.add_parser("score")
    scoring.add_argument("source", type=Path)
    scoring.add_argument("reference", type=Path)
    scoring.add_argument("prediction", type=Path)
    receipts = sub.add_parser("receipts")
    receipts.add_argument("run", type=Path)
    args = parser.parse_args()
    from freeze import verify

    verify(ROOT, read(ROOT / "manifests/input.manifest.json"))
    if args.command == "prepare":
        raw = args.source.read_bytes()
        source = strict_json_loads(raw)
        result = {
            "schema": "aulalista-prepared-requests.v1",
            "source_sha256": digest(raw),
            "synthetic": True,
            "calls_executed": 0,
            "variant": args.variant,
            "requests": requests(source, args.variant, args.question_budget),
        }
        rendered = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
        with args.out.open("x", encoding="utf-8") as output:
            output.write(rendered)
        print(
            json.dumps(
                {
                    "prepared_requests": len(result["requests"]),
                    "calls_executed": 0,
                    "out": str(args.out),
                    "bytes_utf8": len(rendered.encode()),
                    "tokens": None,
                }
            )
        )
    elif args.command == "score":
        source, reference = read(args.source), read(args.reference)
        try:
            prediction = read(args.prediction)
            parse_error = None
        except (ValueError, UnicodeDecodeError):
            prediction, parse_error = None, "invalid_json_prediction"
        result = score(source, reference, prediction)
        if parse_error:
            result["prediction_parse_error"] = parse_error
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    else:
        run = read(args.run)
        print(
            json.dumps(
                summarize_receipts(run, args.run.parent),
                ensure_ascii=False,
                indent=2,
                allow_nan=False,
            )
        )


if __name__ == "__main__":
    main()
