"""Physical text occurrences and conservative annex links, never semantic truth.

All boundaries are recomputed from the controlled representation. This bounded
line grammar does not certify PDF geometry, OCR coverage or resource obligation.
"""

import re
from dataclasses import dataclass

from aulalista_api.source_evidence import VerificationContext, VerifiedBatch, reference
from aulalista_api.source_integrity import IntegrityError, canonical, sha256

HEADING = re.compile(r"^[ \t]*(?P<label>Proyecto|Sesi[oó]n)\b(?P<tail>[^\r\n]*)", re.I)
SESSION_NUMBER = re.compile(r"[ \t]+([1-9][0-9]{0,5})(?=$|[ \t:])")
BULLET = re.compile(r"^[ \t]{0,3}[-•][ \t]*\S")
SECTION = re.compile(
    r"^[ \t]*(Inicio:|Desarrollo:|Cierre:|Indicadores de|Ajustes razonables:|Observaciones:)",
    re.I,
)
ANNEX = re.compile(r"\banexos?\b", re.I)
NUMBER = re.compile(r"[1-9][0-9]{0,5}(?![\w])")
CONNECTOR = re.compile(r"(?:[ \t]*,[ \t]*|[ \t]+[ye][ \t]+)", re.I)
QUALIFIER = re.compile(r"\b(no|nunca|sin|si|cuando|opcional|opcionalmente)\b", re.I)
KEY = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\Z")


def _require(condition, reason):
    if not condition:
        raise IntegrityError(reason)


def _identity(context, kind, page, start, end):
    return sha256(canonical([context.sha256, kind, page, start, end]).encode())


def _append_span(anchor, page, start, end):
    spans = anchor["spans"]
    if spans and spans[-1]["page"] == page and spans[-1]["end"] == start:
        spans[-1]["end"] = end
    else:
        spans.append({"page": page, "start": start, "end": end})


def _parse_mention(text, match, line_start, line_end):
    """One lexical occurrence; an explicit list can name several numbered refs."""
    cursor = match.end()
    space = re.match(r"[ \t]+", text[cursor:line_end])
    cursor += len(space[0]) if space else 0
    first = NUMBER.match(text, cursor, line_end) if space else None
    numbers, number_spans, end = [], [], match.end()
    state = "unnumbered"
    if first:
        numbers, end = [int(first[0])], first.end()
        number_spans = [
            {"number": int(first[0]), "start": first.start(), "end": first.end()}
        ]
        state = "numbered"
        while connector := CONNECTOR.match(text, end, line_end):
            next_number = NUMBER.match(text, connector.end(), line_end)
            if not next_number:
                # A declared list connector must be followed by another supported
                # numeral. A page/point label after a comma is a separate field.
                following = text[connector.end() : line_end]
                if connector[0].strip() != "," or not re.match(
                    r"(?:punto|p[aá]gina)\b", following, re.I
                ):
                    state = "unsupported_number_expression"
                break
            numbers.append(int(next_number[0]))
            number_spans.append(
                {
                    "number": int(next_number[0]),
                    "start": next_number.start(),
                    "end": next_number.end(),
                }
            )
            end = next_number.end()
        # A range/decimal/time-like continuation is outside this list grammar.
        tail = text[end:line_end]
        if re.match(
            r"[ \t]*(?:[-–—/:…]|[.,]{2,}|(?:a|al|hasta)\b|[.,][ \t]*[.,\d])", tail, re.I
        ):
            state = "unsupported_number_expression"
        continuation = tail.lstrip()
        separate_label = re.match(r"(?:punto|p[aá]gina)\b", continuation, re.I)
        if (
            continuation
            and continuation[0] not in ".,;!?\"'“”‘’«»()[]{}"
            and not separate_label
        ):
            state = "unsupported_number_expression"
    elif space and cursor < line_end and text[cursor].isdigit():
        state = "unsupported_number_expression"
    syntax_supported = state == "numbered"
    line = text[line_start:line_end]
    if QUALIFIER.search(line):
        state = "qualified_unresolved"
    return {
        "end": end,
        "candidate_numbers": numbers,
        "number_spans": number_spans if syntax_supported else [],
        "numbers": numbers if state == "numbered" else [],
        "parse_state": state,
        "obligation": "not_inferred",
    }


@dataclass(frozen=True)
class AnchorIndex:
    """Immutable pinned context; every projection recomputes physical boundaries."""

    context: VerificationContext
    target_id: str

    def __post_init__(self):
        _require(
            isinstance(self.context, VerificationContext), "trusted context required"
        )
        target = self.context.target(self.target_id)
        _require(
            target["role"] is None and target["context_id"] is None,
            "index requires a generic source target; roles come from source boundaries",
        )

    @property
    def representation(self):
        rep_id = self.context.target(self.target_id)["representation_id"]
        return next(
            r
            for r in self.context.snapshot.data["representations"]
            if r["id"] == rep_id
        )

    def ref(self, page, start, end):
        return reference(self.context, self.target_id, page, start, end)

    @property
    def data(self):
        projects, sessions, activities, segments, warnings = [], [], [], [], []
        project = session = activity = None
        reason = "before_first_session"
        pages = self.representation["pages"]
        for page in pages:
            number, text = page["number"], page["text"]
            if page["state"] != "readable":
                project = session = activity = None
                reason = "continuity_unproven_after_unreadable_page"
                warnings.append(
                    {"page": number, "reason": reason, "state": page["state"]}
                )
                continue
            lines, offset = [], 0
            for line in text.splitlines(keepends=True):
                lines.append((offset, line))
                offset += len(line)
            preludes = set()
            for i, (start, line) in enumerate(lines):
                heading = HEADING.match(line)
                if (
                    heading
                    and heading["label"].lower() != "proyecto"
                    and "Tema:" in line
                    and i
                ):
                    # Saved layout can put the next session's theme/date above
                    # its heading. Do not credit that prelude to the previous one.
                    if "Fecha:" in lines[i - 1][1]:
                        preludes.add(lines[i - 1][0])
            for start, line in lines:
                end = start + len(line)
                heading = HEADING.match(line)
                resource_line = any(
                    u["role"] == "resource" and u["start"] < end and start < u["end"]
                    for u in page["units"]
                )
                if resource_line:
                    # Resource content is not an extension of the preceding
                    # activity and cannot contribute a self-identifying key.
                    activity = None
                elif start in preludes:
                    session = activity = None
                    reason = "heading_prelude_unassigned"
                elif heading:
                    activity = None
                    label_start = start + heading.start("label")
                    if heading["label"].lower() == "proyecto":
                        session = None
                        if heading["tail"].strip():
                            stop = start + heading.end()
                            project = {
                                "id": _identity(
                                    self.context, "project", number, label_start, stop
                                ),
                                "ordinal": len(projects) + 1,
                                "evidence": self.ref(number, label_start, stop),
                                "spans": [],
                            }
                            projects.append(project)
                            reason = "project_without_session"
                        else:
                            project = None
                            reason = "uncertain_project_heading"
                    else:
                        parsed = SESSION_NUMBER.match(heading["tail"])
                        if parsed:
                            stop = start + heading.start("tail") + parsed.end()
                            session = {
                                "id": _identity(
                                    self.context, "session", number, label_start, stop
                                ),
                                "ordinal": len(sessions) + 1,
                                "number": int(parsed[1]),
                                "project_id": project["id"] if project else None,
                                "evidence": self.ref(number, label_start, stop),
                                "spans": [],
                            }
                            sessions.append(session)
                            reason = None
                        else:
                            session = None
                            reason = "uncertain_session_heading"
                elif SECTION.match(line):
                    activity = None
                elif BULLET.match(line):
                    activity = {
                        "id": _identity(self.context, "activity", number, start, end),
                        "ordinal": len(activities) + 1,
                        "session_id": session["id"] if session else None,
                        "project_id": project["id"] if project else None,
                        "evidence": self.ref(number, start, end),
                        "spans": [],
                    }
                    activities.append(activity)
                segment = {
                    "page": number,
                    "start": start,
                    "end": end,
                    "project_id": project["id"] if project else None,
                    "session_id": session["id"] if session else None,
                    "activity_id": activity["id"] if activity else None,
                    "reason": reason if session is None else None,
                }
                segments.append(segment)
                for anchor in (project, session, activity):
                    if anchor is not None:
                        _append_span(anchor, number, start, end)
        mentions = []
        for page in pages:
            if page["state"] != "readable":
                continue
            text = page["text"]
            for match in ANNEX.finditer(text):
                start = match.start()
                line_start = text.rfind("\n", 0, start) + 1
                line_end = text.find("\n", match.end())
                if line_end < 0:
                    line_end = len(text)
                parsed = _parse_mention(text, match, line_start, line_end)
                number_references = [
                    {
                        "id": _identity(
                            self.context,
                            "annex-number",
                            page["number"],
                            r["start"],
                            r["end"],
                        ),
                        "number": r["number"],
                        "evidence": self.ref(page["number"], r["start"], r["end"]),
                    }
                    for r in parsed.pop("number_spans")
                ]
                segment = next(
                    (
                        s
                        for s in segments
                        if s["page"] == page["number"]
                        and s["start"] <= start
                        and parsed["end"] <= s["end"]
                    ),
                    None,
                )
                if segment and segment["activity_id"]:
                    block = next(
                        a for a in activities if a["id"] == segment["activity_id"]
                    )
                    block_text = "\n".join(
                        pages[s["page"] - 1]["text"][s["start"] : s["end"]]
                        for s in block["spans"]
                    )
                    if QUALIFIER.search(block_text):
                        parsed["parse_state"] = "qualified_unresolved"
                        parsed["numbers"] = []
                mentions.append(
                    {
                        "id": _identity(
                            self.context,
                            "mention",
                            page["number"],
                            start,
                            parsed["end"],
                        ),
                        "ordinal": len(mentions) + 1,
                        "keyword_end": match.end(),
                        "number_references": number_references,
                        "evidence": self.ref(page["number"], start, parsed["end"]),
                        "context_evidence": self.ref(
                            page["number"], line_start, line_end
                        ),
                        "project_id": segment["project_id"] if segment else None,
                        "session_id": segment["session_id"] if segment else None,
                        "activity_id": segment["activity_id"] if segment else None,
                        **parsed,
                    }
                )
        return {
            "schema": "aulalista-physical-index.v1",
            "context_sha256": self.context.sha256,
            "snapshot_sha256": self.context.snapshot.sha256,
            "representation_sha256": self.representation["sha256"],
            "pages": [
                {"number": p["number"], "state": p["state"], "reason": p["reason"]}
                for p in pages
            ],
            "projects": projects,
            "sessions": sessions,
            "activities": activities,
            "segments": segments,
            "mentions": mentions,
            "unassigned_spans": [s for s in segments if s["session_id"] is None],
            "warnings": warnings,
            "visual_or_semantic_boundaries_verified": False,
        }

    def _verified(self, ref):
        claim = {
            "target": self.target_id,
            "kind": "literal",
            "value": ref.get("quote") if type(ref) is dict else None,
            "evidence": [ref],
        }
        result = VerifiedBatch.from_claims(self.context, [claim]).project()
        return (
            next(r for r in result["results"] if r["target"] == self.target_id)["state"]
            == "literal"
        )

    def _relation(self, proposed, mention, activity):
        reasons = []
        if mention["parse_state"] != "numbered":
            reasons.append("mention_expression_unresolved")
        if mention["session_id"] is None or activity is None:
            reasons.append("physical_context_unassigned")
        if proposed.get("session_id") != mention["session_id"]:
            reasons.append("session_mismatch")
        if proposed.get("activity_id") != mention["activity_id"]:
            reasons.append("activity_mismatch")
        evidence = proposed.get("evidence")
        if not self._verified(evidence):
            reasons.append("invalid_source_evidence")
        else:
            source_page = self.representation["pages"][evidence["page"] - 1]
            if any(
                u["role"] == "resource"
                and u["start"] < evidence["end"]
                and evidence["start"] < u["end"]
                for u in source_page["units"]
            ):
                reasons.append("relation_evidence_overlaps_resource_content")
            occurrence = mention["evidence"]
            if not (
                evidence["page"] == occurrence["page"]
                and evidence["start"] <= occurrence["start"]
                and occurrence["end"] <= evidence["end"]
            ):
                reasons.append("evidence_does_not_contain_complete_mention")
            if activity is None or not any(
                s["page"] == evidence["page"]
                and s["start"] <= evidence["start"]
                and evidence["end"] <= s["end"]
                for s in activity["spans"]
            ):
                reasons.append("evidence_outside_activity")
        return {
            "state": "evidenced" if not reasons else "unknown",
            "reasons": sorted(reasons),
            "evidence": evidence,
        }

    def _key_present(self, ref, key):
        # Look outside a cropped quote as well: resource-1 is not resource-12.
        text = self.representation["pages"][ref["page"] - 1]["text"]
        for match in re.finditer(re.escape(key), text[ref["start"] : ref["end"]]):
            start, end = ref["start"] + match.start(), ref["start"] + match.end()
            left, right = text[start - 1 : start] if start else "", text[end : end + 1]
            # Only explicit safe delimiters identify a whole key. Unknown
            # symbols/format controls are not evidence of a filename boundary.
            safe = "\"'“”‘’«»()[]{};:,!?"
            if all(not c or c.isspace() or c in safe for c in (left, right)):
                return True
        return False

    def _catalogue(self, candidates):
        _require(type(candidates) is list, "trusted candidates must be a list")
        ids, catalogue = set(), []
        for candidate in candidates:
            _require(
                type(candidate) is dict
                and set(candidate) == {"id", "number", "key", "location"},
                "invalid resource candidate",
            )
            cid, number, key, location = (
                candidate[k] for k in ("id", "number", "key", "location")
            )
            _require(
                type(cid) is str and cid and cid not in ids,
                "duplicate or invalid candidate ID",
            )
            _require(
                type(number) is int and 1 <= number <= 999999,
                "invalid candidate number",
            )
            _require(
                type(key) is str and KEY.fullmatch(key), "invalid explicit resource key"
            )
            ids.add(cid)
            available, reason = False, "resource_location_missing"
            if location is not None:
                reason = "resource_location_not_verified"
                if self._verified(location):
                    page = self.representation["pages"][location["page"] - 1]
                    available = self._key_present(location, key) and any(
                        u["role"] == "resource"
                        and u["start"] <= location["start"]
                        and location["end"] <= u["end"]
                        and u["metadata"].get("annex_number") == number
                        and type(u["metadata"].get("annex_number")) is int
                        and u["metadata"].get("resource_key") == key
                        and u["metadata"].get("origin") == "source"
                        for u in page["units"]
                    )
                    if available:
                        reason = None
            catalogue.append(
                {**candidate, "available": bool(available), "reason": reason}
            )
        return sorted(catalogue, key=lambda c: c["id"])

    def evaluate(self, proposals, candidates=None):
        """Recompute source targets and canonical relations; model flags never win.

        Candidates are trusted local catalogue configuration, not model output.
        A valid relation proves only physical text membership. Resource identity
        additionally needs a complete explicit key and independently checked
        location in a source-annotated resource unit of this same snapshot.
        """
        _require(type(proposals) is list, "relation proposals must be a list")
        data = self.data
        catalogue = self._catalogue([] if candidates is None else candidates)
        activities = {a["id"]: a for a in data["activities"]}
        targets = {
            r["id"]: (m, r) for m in data["mentions"] for r in m["number_references"]
        }
        groups = {key: [] for key in targets}
        extras = []
        for proposal in proposals:
            if (
                type(proposal) is not dict
                or type(proposal.get("reference_id")) is not str
                or proposal["reference_id"] not in groups
            ):
                extras.append(
                    {"reason": "unknown_physical_reference", "proposal": proposal}
                )
            else:
                groups[proposal["reference_id"]].append(proposal)
        rows = []
        for rid, (mention, number_ref) in targets.items():
            group = groups[rid]
            checks = sorted(
                (
                    self._relation(p, mention, activities.get(mention["activity_id"]))
                    for p in group
                ),
                key=canonical,
            )
            evidenced = bool(checks) and all(c["state"] == "evidenced" for c in checks)
            reasons = sorted({r for c in checks for r in c["reasons"]})
            if not checks:
                reasons = ["relation_not_proposed"]
            elif not evidenced and any(c["state"] == "evidenced" for c in checks):
                reasons.append("not_all_duplicate_relations_verified")
            options = [c for c in catalogue if c["number"] == number_ref["number"]]
            located, availability = None, "missing" if not options else "ambiguous"
            if evidenced:
                keyed = [
                    c
                    for c in options
                    if all(
                        self._key_present(check["evidence"], c["key"])
                        for check in checks
                    )
                ]
                if len(keyed) == 1:
                    if keyed[0]["available"]:
                        located, availability = keyed[0], "located"
                    else:
                        availability = "missing"
            else:
                availability = "unresolved"
            rows.append(
                {
                    "reference_id": rid,
                    "mention_id": mention["id"],
                    "number": number_ref["number"],
                    "session_id": mention["session_id"],
                    "project_id": mention["project_id"],
                    "activity_id": mention["activity_id"],
                    "state": "evidenced" if evidenced else "unknown",
                    "reasons": reasons,
                    "occurrences": checks,
                    "candidate_ids": [c["id"] for c in options],
                    "resource_state": availability,
                    "resource_id": located["id"] if located else None,
                    "resource_evidence": located["location"] if located else None,
                    "obligation": "not_inferred",
                    "warnings": [],
                }
            )
        repeated = []
        for number in sorted({r["number"] for r in rows}):
            uses = [r for r in rows if r["number"] == number]
            if len(uses) > 1:
                unresolved = any(r["resource_state"] != "located" for r in uses)
                repeated.append(
                    {
                        "number": number,
                        "reference_ids": [r["reference_id"] for r in uses],
                        "identity_unresolved": unresolved,
                        "error_inferred_from_repetition": False,
                    }
                )
                if unresolved:
                    for row in uses:
                        row["warnings"].append("repeated_number_identity_unresolved")
        for row in rows:
            if row["resource_state"] != "located":
                row["warnings"].append("resource_not_identified_and_located")
        return {
            "schema": "aulalista-annex-relations.v1",
            "index": data,
            "catalogue": catalogue,
            "relations": rows,
            "extra_predictions": sorted(extras, key=canonical),
            "repeated_numbers": repeated,
            "counts": {
                "lexical_mentions": len(data["mentions"]),
                "numbered_references": len(targets),
                "unresolved_mentions": sum(
                    m["parse_state"] != "numbered" for m in data["mentions"]
                ),
                "evidenced_relations": sum(r["state"] == "evidenced" for r in rows),
                "missing_relations": sum(not groups[rid] for rid in targets),
                "extra_predictions": len(extras),
                "duplicate_predictions": sum(
                    max(0, len(g) - 1) for g in groups.values()
                ),
                "located_relations": sum(
                    r["resource_state"] == "located" for r in rows
                ),
                "ambiguous_relations": sum(
                    r["resource_state"] == "ambiguous"
                    or "repeated_number_identity_unresolved" in r["warnings"]
                    for r in rows
                ),
                "missing_resources": sum(
                    r["resource_state"] == "missing" for r in rows
                ),
            },
            "semantic_correctness_verified": False,
            "new_clarification_requests": 0,
        }
