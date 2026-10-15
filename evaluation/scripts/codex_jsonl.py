"""Provisional offline Codex JSONL normalizer; never launches Codex or a model.

One complete native instrumentation stream was checked by SHA256. Test streams
are authored synthetic or explicitly sanitized derivatives of that receipt. This
module deliberately does not feed the benchmark's synthetic receipt aggregator.
"""

import hashlib
import importlib.util
import math
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "codex_json_boundary", Path(__file__).with_name("benchmark.py")
)
_boundary = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_boundary)
loads, require = _boundary.strict_json_loads, _boundary.require

TOKEN_FIELDS = (
    "input_tokens",
    "cached_input_tokens",
    "cache_write_input_tokens",
    "output_tokens",
    "reasoning_output_tokens",
    "total_tokens",
)
SUBSETS = (
    ("cached_is_subset_of_input", "cached_input_tokens", "input_tokens"),
    ("reasoning_is_subset_of_output", "reasoning_output_tokens", "output_tokens"),
)
ITEM_EVENTS = {"item.started", "item.updated", "item.completed"}


def _identity(value, field):
    require(isinstance(value, str) and bool(value.strip()), f"Missing {field}")
    return value


def usage_from_event(event, semantics=None):
    """Preserve native components; relations need explicit documented semantics."""
    require(
        isinstance(event, dict)
        and event.get("type") in ("turn.completed", "turn.failed"),
        "Expected terminal turn event",
    )
    semantics = {} if semantics is None else semantics
    require(isinstance(semantics, dict), "Invalid semantics declaration")
    require(
        set(semantics) <= {name for name, _, _ in SUBSETS} | {"evidence"},
        "Unknown semantics field",
    )
    flags = [semantics.get(name) for name, _, _ in SUBSETS]
    require(
        all(value is None or type(value) is bool for value in flags),
        "Invalid subset declaration",
    )
    if any(value is not None for value in flags):
        _identity(semantics.get("evidence"), "semantics evidence")
    usage = event.get("usage")
    if usage is None:
        return {name: None for name in TOKEN_FIELDS}
    require(isinstance(usage, dict), "Invalid native usage object")
    require(
        set(usage) <= set(TOKEN_FIELDS),
        "Unsupported native usage field; review adapter schema",
    )
    for name, value in usage.items():
        require(
            value is None or (type(value) is int and value >= 0),
            f"Invalid native token field: {name}",
        )
    for flag, child, parent in SUBSETS:
        if (
            semantics.get(flag) is True
            and usage.get(child) is not None
            and usage.get(parent) is not None
        ):
            require(
                usage[child] <= usage[parent],
                f"Contradictory documented subset: {flag}",
            )
    return {name: usage.get(name) for name in TOKEN_FIELDS}


def normalize_jsonl(raw, invocation, semantics=None):
    """Normalize one whole stream without claiming effective model or coverage.

    run_id/attempt_id/model_requested/cli_version come from launch metadata, not
    provider testimony. event_line and ordinal are local locators, never native
    request/turn IDs. Unsupported/inconsistent streams fail closed.
    """
    require(isinstance(raw, bytes) and bool(raw), "Empty JSONL receipt")
    require(isinstance(invocation, dict), "Invalid invocation metadata")
    for key in ("run_id", "attempt_id", "model_requested"):
        _identity(invocation.get(key), key)
    version = invocation.get("cli_version")
    require(
        version is None or (isinstance(version, str) and bool(version.strip())),
        "Invalid CLI version",
    )
    effort = invocation.get("reasoning_effort_requested")
    require(
        effort is None or (isinstance(effort, str) and bool(effort.strip())),
        "Invalid requested effort",
    )
    exit_code, elapsed = invocation.get("exit_code"), invocation.get("wall_latency_ms")
    require(exit_code is None or type(exit_code) is int, "Invalid process exit code")
    require(
        elapsed is None
        or (type(elapsed) in (int, float) and math.isfinite(elapsed) and elapsed >= 0),
        "Invalid process wall latency",
    )
    sha = hashlib.sha256(raw).hexdigest()
    require(invocation.get("raw_sha256") == sha, "JSONL receipt hash mismatch")
    thread_id, active, turns, errors, warnings = None, None, [], [], []
    native_turn_ids = set()
    for line_number, line in enumerate(raw.decode("utf-8").splitlines(), 1):
        if not line.strip():
            continue
        event = loads(line)
        require(
            isinstance(event, dict) and isinstance(event.get("type"), str),
            "Invalid JSONL event",
        )
        kind = event["type"]
        if "usage" in event and kind not in ("turn.completed", "turn.failed"):
            raise ValueError(
                "Usage outside supported terminal event; coverage unverified"
            )
        if kind == "thread.started":
            require(
                thread_id is None and active is None and not turns,
                "Duplicate or late thread start",
            )
            thread_id = _identity(event.get("thread_id"), "thread_id")
        elif kind == "turn.started":
            require(
                thread_id is not None and active is None,
                "Missing thread or overlapping turn",
            )
            native_id = event.get("turn_id")
            if native_id is not None:
                _identity(native_id, "turn_id")
                require(native_id not in native_turn_ids, "Duplicate native turn ID")
                native_turn_ids.add(native_id)
            active = {
                "ordinal": len(turns) + 1,
                "native_turn_id": native_id,
                "started_line": line_number,
            }
        elif kind in ("turn.completed", "turn.failed"):
            require(
                thread_id is not None and active is not None,
                "Orphan or duplicate terminal event",
            )
            terminal_id = event.get("turn_id")
            require(
                terminal_id is None or terminal_id == active["native_turn_id"],
                "Mismatched native turn ID",
            )
            turns.append(
                dict(
                    active,
                    status="success" if kind == "turn.completed" else "failed",
                    terminal_line=line_number,
                    usage=usage_from_event(event, semantics),
                )
            )
            active = None
        elif kind in ITEM_EVENTS:
            require(
                thread_id is not None and active is not None,
                "Item outside an active turn",
            )
            require(isinstance(event.get("item"), dict), "Invalid item event")
            item = event["item"]
            if item.get("type") == "error":
                message = item.get("message", "")
                require(isinstance(message, str), "Invalid error-item message")
                warning_kind = (
                    "context_budget_truncated"
                    if message.startswith("Exceeded skills context budget.")
                    else "native_error_item"
                )
                warnings.append({"event_line": line_number, "kind": warning_kind})
            # Content is not copied into metrics or treated as a token estimate.
        elif kind == "error":
            errors.append({"event_line": line_number})
        else:
            raise ValueError(f"Unsupported JSONL event: {kind}")
    require(
        thread_id is not None,
        "Missing thread.started; a usage fragment is not a complete receipt",
    )
    if active is not None:
        turns.append(
            dict(
                active,
                status="incomplete",
                terminal_line=None,
                usage={name: None for name in TOKEN_FIELDS},
            )
        )
    require(bool(turns) or bool(errors), "No turn or failure evidence")
    complete = bool(turns) and active is None and not errors
    return {
        "schema": "aulalista-codex-jsonl-provisional.v1",
        "run_id": invocation["run_id"],
        "attempt_id": invocation["attempt_id"],
        "raw_sha256": sha,
        "thread_id": thread_id,
        "provider_request_id": None,
        "model_requested": invocation["model_requested"],
        "model_effective": None,
        "reasoning_effort_requested": effort,
        "process_exit_code_declared": exit_code,
        "process_wall_latency_ms_declared": elapsed,
        "process_success": None if exit_code is None else exit_code == 0,
        "model_effective_provenance": "not_reported_by_supported_events",
        "cli_version_declared": version,
        "turns": turns,
        "errors": errors,
        "warnings": warnings,
        "context_comparable": False if warnings else None,
        "context_integrity": (
            "truncated"
            if any(w["kind"] == "context_budget_truncated" for w in warnings)
            else "warning_present"
            if warnings
            else "not_verified"
        ),
        "stream_structurally_complete": complete,
        "effective_model_verified": False,
        "provider_usage_coverage_verified": False,
        "native_total_tokens": None,
        "ready_for_model_comparison": False,
        "semantics_declaration": semantics or {},
        "limitations": [
            "Only one native stream observed; other CLI builds/event shapes remain unverified",
            "No total formula or subset relationship inferred",
            "Requested model is not verified effective identity",
            "Item/tool subcall coverage is not established",
        ],
    }


def normalize_attempts(attempts, semantics=None):
    """Reject reused attempts, raw streams or threads before returning records.

    Thread reuse (including resume) needs a separate reviewed contract; it is
    rejected here rather than silently merging or duplicating consumption.
    """
    require(isinstance(attempts, list) and bool(attempts), "No attempts")
    seen_attempts, seen_raw, seen_threads, output = set(), set(), set(), []
    for entry in attempts:
        require(isinstance(entry, dict), "Invalid attempt entry")
        result = normalize_jsonl(entry.get("raw"), entry.get("invocation"), semantics)
        identity = (result["run_id"], result["attempt_id"])
        require(identity not in seen_attempts, "Duplicate run/attempt identity")
        require(result["raw_sha256"] not in seen_raw, "Duplicate raw JSONL receipt")
        require(
            result["thread_id"] not in seen_threads,
            "Thread reuse requires reviewed resume semantics",
        )
        seen_attempts.add(identity)
        seen_raw.add(result["raw_sha256"])
        seen_threads.add(result["thread_id"])
        output.append(result)
    return output
