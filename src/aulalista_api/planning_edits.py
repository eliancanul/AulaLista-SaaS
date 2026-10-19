"""Ediciones, copias y borradores privados: CAS e historia transaccional."""

import hashlib
import json
from copy import deepcopy
from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    UniqueConstraint,
    func,
    select,
    text,
    update,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, Session, mapped_column

from aulalista_api.database import Base
from aulalista_api.materials import MaterialError, SourceVersion, authorize
from aulalista_api.planning_result import RESULT_ADAPTER
from aulalista_api.plannings import (
    Planning,
    PlanningRevision,
    analytic_origin_document,
    document,
    revision_source,
)

MAX_EDIT_BYTES = 8192
RevisionNumber = Annotated[int, Field(strict=True, ge=1, le=2_147_483_646)]


class StatementRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    contract_version: Annotated[int, Field(strict=True, ge=1, le=1)]
    resource_key: Annotated[str, Field(strict=True, min_length=1, max_length=64)]
    element_key: Annotated[str, Field(strict=True, min_length=1, max_length=64)]
    text: Annotated[str, Field(strict=True, min_length=1, max_length=1000)]

    @field_validator("text", "resource_key", "element_key")
    @classmethod
    def valid_text(cls, value):
        if "\0" in value or not value.strip():
            raise ValueError("invalid_request")
        try:
            value.encode("utf-8")
        except UnicodeError:
            raise ValueError("invalid_request") from None
        return value


class EditRequest(StatementRequest):
    expected_revision: RevisionNumber


class CopyRequest(StatementRequest):
    base_revision: RevisionNumber


class DraftRequest(CopyRequest):
    expected_draft_revision: Annotated[int, Field(strict=True, ge=0, le=2_147_483_646)]


class PlanningDraft(Base):
    __tablename__ = "planning_draft"
    __table_args__ = (
        ForeignKeyConstraint(
            ["planning_id", "scope_id"],
            ["planning.id", "planning.scope_id"],
            name="fk_draft_planning_scope",
        ),
        UniqueConstraint("id", "planning_id", "scope_id", name="uq_draft_target"),
        Index("ix_planning_draft_scope_id", "scope_id", "id"),
        CheckConstraint("current_revision > 0", name="ck_draft_revision"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True)
    planning_id: Mapped[UUID]
    scope_id: Mapped[UUID]
    current_revision: Mapped[int]


class PlanningDraftRevision(Base):
    __tablename__ = "planning_draft_revision"
    __table_args__ = (
        ForeignKeyConstraint(
            ["draft_id", "planning_id", "scope_id"],
            [
                "planning_draft.id",
                "planning_draft.planning_id",
                "planning_draft.scope_id",
            ],
            name="fk_draft_revision_target",
        ),
        ForeignKeyConstraint(
            ["base_revision_id", "planning_id", "scope_id"],
            [
                "planning_revision.id",
                "planning_revision.planning_id",
                "planning_revision.scope_id",
            ],
            name="fk_draft_base_target",
        ),
        UniqueConstraint("draft_id", "number", name="uq_draft_revision_number"),
        UniqueConstraint("scope_id", "operation_id", name="uq_draft_operation"),
        CheckConstraint("number > 0", name="ck_draft_revision_number"),
        CheckConstraint(
            "request_fingerprint ~ '^[0-9a-f]{64}$'", name="ck_draft_fingerprint"
        ),
        CheckConstraint(
            "octet_length(request::text) BETWEEN 1 AND 8192",
            name="ck_draft_request_size",
        ),
        CheckConstraint(
            "octet_length(result::text) BETWEEN 1 AND 8192", name="ck_draft_result_size"
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    draft_id: Mapped[UUID]
    planning_id: Mapped[UUID]
    scope_id: Mapped[UUID]
    number: Mapped[int]
    base_revision_id: Mapped[UUID]
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("principal.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    operation_id: Mapped[UUID]
    request_fingerprint: Mapped[str]
    request: Mapped[dict] = mapped_column(JSONB)
    result: Mapped[dict] = mapped_column(JSONB)


def fingerprint(kind: str, planning_id: UUID, request: BaseModel, draft_id=None) -> str:
    payload = [
        kind,
        str(planning_id),
        str(draft_id) if draft_id else None,
        request.model_dump(mode="json"),
    ]
    canonical = json.dumps(
        payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode()
    if len(canonical) > MAX_EDIT_BYTES:
        raise MaterialError(413, "content_too_large")
    return hashlib.sha256(b"aulalista-planning-edit-v1\0" + canonical).hexdigest()


def lock_operation(session, scope_id, operation_id, namespace="planning-v1"):
    lock = int.from_bytes(
        hashlib.sha256(
            namespace.encode() + b"\0" + scope_id.bytes + operation_id.bytes
        ).digest()[:8],
        "big",
        signed=True,
    )
    session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock})


def exact_revision(session, scope_id, planning_id, number):
    revision = session.scalar(
        select(PlanningRevision).where(
            PlanningRevision.scope_id == scope_id,
            PlanningRevision.planning_id == planning_id,
            PlanningRevision.number == number,
        )
    )
    if revision is None:
        raise MaterialError(404, "not_found")
    return revision


def edit_guided(result: dict, request: StatementRequest) -> bool:
    # Virtual targets point into the canonical result, never a duplicate resource copy.
    if request.resource_key == "planning":
        if request.element_key in {"purpose", "formative_assessment"}:
            result[request.element_key] = request.text
            return True
        for index in range(len(result["materials"])):
            if request.element_key == f"material-{index}":
                result["materials"][index] = request.text
                return True
    for activity in result["activities"]:
        if request.resource_key != f"activity:{activity['key']}":
            continue
        if request.element_key == "statement":
            activity["statement"] = request.text
            return True
        if request.element_key == "minutes":
            value = request.text
            if (
                not value.isascii()
                or not value.isdecimal()
                or len(value) > 3
                or value.startswith("0")
                or not 1 <= int(value) <= 180
            ):
                raise MaterialError(422, "invalid_request")
            activity["minutes"] = int(value)
            result["duration_minutes"] = sum(a["minutes"] for a in result["activities"])
            return True
    return False


def edited_result(base: PlanningRevision, request: StatementRequest) -> dict:
    result = deepcopy(base.result)
    changed = False
    if result.get("kind") == "guided-planning-v1":
        changed = edit_guided(result, request)
    else:
        for resource in result.get("resources", []):
            if resource["key"] != request.resource_key:
                continue
            for element in resource["elements"]:
                if (
                    element["key"] == request.element_key
                    and element.get("editable") is True
                    and element["kind"] == "statement"
                ):
                    element["text"] = request.text
                    changed = True
    if not changed:
        raise MaterialError(422, "unsupported_target")
    RESULT_ADAPTER.validate_python(result)
    if len(json.dumps(result, ensure_ascii=False).encode()) > 8192:
        raise MaterialError(413, "content_too_large")
    return result


def draft_document(revision: PlanningDraftRevision, base: PlanningRevision) -> dict:
    saved = {
        "receipt": {
            "contract_version": 1,
            "namespace": "planning-draft-v1",
            "draft_id": str(revision.draft_id),
            "revision_id": str(revision.id),
            "draft_revision": revision.number,
            "planning_id": str(revision.planning_id),
            "base_revision": base.number,
            "base_revision_id": str(base.id),
            "scope_id": str(revision.scope_id),
            "actor_id": str(revision.actor_id),
            "operation_id": str(revision.operation_id),
            "created_at": revision.created_at.astimezone(UTC).isoformat(),
        },
        "request": revision.request,
        "result": revision.result,
        "initial_request": base.request.get("initial_request", base.request),
    }
    if base.analytic_revision_id is not None:
        saved["analytic_origin"] = analytic_origin_document(base)
    return saved


class PlanningEdits:
    def __init__(self, engine):
        self.engine = engine

    def write(
        self, actor_id, scope_id, planning_id, operation_id, request, *, copy=False
    ):
        from aulalista_api.planning_generation import reject_generation_operation

        kind = "copy" if copy else "edit"
        digest = fingerprint(kind, planning_id, request)
        with Session(self.engine) as session, session.begin():
            actor_id = authorize(session, actor_id, scope_id)
            lock_operation(session, scope_id, operation_id)
            reject_generation_operation(session, scope_id, operation_id)
            previous = session.scalar(
                select(PlanningRevision).where(
                    PlanningRevision.scope_id == scope_id,
                    PlanningRevision.operation_id == operation_id,
                )
            )
            if previous is not None:
                if previous.request_fingerprint != digest:
                    raise MaterialError(409, "conflict")
                saved = document(previous, revision_source(session, previous))
            else:
                base_number = (
                    request.base_revision if copy else request.expected_revision
                )
                base = exact_revision(session, scope_id, planning_id, base_number)
                result = edited_result(base, request)
                payload = {
                    "kind": kind,
                    **request.model_dump(mode="json"),
                    "initial_request": base.request.get(
                        "initial_request", base.request
                    ),
                }
                origin_id = base.origin_revision_id
                if copy:
                    origin_id = base.id
                    payload["origin"] = {
                        "planning_id": str(planning_id),
                        "revision_id": str(base.id),
                        "revision": base.number,
                    }
                    planning = Planning(scope_id=scope_id, current_revision=1)
                    session.add(planning)
                    session.flush()
                    target_id, number = planning.id, 1
                else:
                    if origin_id is not None:
                        payload["origin"] = base.request["origin"]
                    advanced = session.scalar(
                        update(Planning)
                        .where(
                            Planning.id == planning_id,
                            Planning.scope_id == scope_id,
                            Planning.current_revision == request.expected_revision,
                        )
                        .values(current_revision=request.expected_revision + 1)
                        .returning(Planning.current_revision)
                    )
                    if advanced is None:
                        raise MaterialError(409, "conflict")
                    if result == base.result:
                        raise MaterialError(422, "unchanged_text")
                    target_id, number = planning_id, advanced
                if (
                    len(json.dumps(payload, ensure_ascii=False).encode())
                    > MAX_EDIT_BYTES
                ):
                    raise MaterialError(413, "content_too_large")
                revision = PlanningRevision(
                    planning_id=target_id,
                    scope_id=scope_id,
                    number=number,
                    source_version_id=base.source_version_id,
                    actor_id=actor_id,
                    operation_id=operation_id,
                    request_fingerprint=digest,
                    request=payload,
                    result=result,
                    origin_revision_id=origin_id,
                    analytic_revision_id=base.analytic_revision_id,
                )
                session.add(revision)
                session.flush()
                saved = document(revision, revision_source(session, base))
        return saved

    def preserve_draft(
        self, actor_id, scope_id, planning_id, draft_id, operation_id, request
    ):
        digest = fingerprint("draft", planning_id, request, draft_id)
        with Session(self.engine) as session, session.begin():
            actor_id = authorize(session, actor_id, scope_id)
            lock_operation(session, scope_id, operation_id, "planning-draft-v1")
            previous = session.scalar(
                select(PlanningDraftRevision).where(
                    PlanningDraftRevision.scope_id == scope_id,
                    PlanningDraftRevision.operation_id == operation_id,
                )
            )
            if previous is not None:
                if previous.request_fingerprint != digest:
                    raise MaterialError(409, "conflict")
                saved = draft_document(
                    previous, session.get(PlanningRevision, previous.base_revision_id)
                )
            else:
                base = exact_revision(
                    session, scope_id, planning_id, request.base_revision
                )
                result = edited_result(base, request)
                # Serialize creation as well as CAS for a stable client-chosen draft ID.
                lock_operation(session, scope_id, draft_id, "planning-draft-id-v1")
                query = select(PlanningDraft).where(PlanningDraft.id == draft_id)
                if request.expected_draft_revision != 0:
                    query = query.where(
                        PlanningDraft.scope_id == scope_id,
                        PlanningDraft.planning_id == planning_id,
                    )
                draft = session.scalar(query)
                if draft is not None and (
                    draft.scope_id != scope_id or draft.planning_id != planning_id
                ):
                    raise MaterialError(404, "not_found")
                if draft is None:
                    if request.expected_draft_revision != 0:
                        raise MaterialError(404, "not_found")
                    draft = PlanningDraft(
                        id=draft_id,
                        scope_id=scope_id,
                        planning_id=planning_id,
                        current_revision=1,
                    )
                    session.add(draft)
                    session.flush()
                    number = 1
                else:
                    number = session.scalar(
                        update(PlanningDraft)
                        .where(
                            PlanningDraft.id == draft_id,
                            PlanningDraft.scope_id == scope_id,
                            PlanningDraft.current_revision
                            == request.expected_draft_revision,
                        )
                        .values(current_revision=request.expected_draft_revision + 1)
                        .returning(PlanningDraft.current_revision)
                    )
                    if number is None:
                        raise MaterialError(409, "conflict")
                revision = PlanningDraftRevision(
                    draft_id=draft_id,
                    planning_id=planning_id,
                    scope_id=scope_id,
                    number=number,
                    base_revision_id=base.id,
                    actor_id=actor_id,
                    operation_id=operation_id,
                    request_fingerprint=digest,
                    request=request.model_dump(mode="json"),
                    result=result,
                )
                session.add(revision)
                session.flush()
                saved = draft_document(revision, base)
        return saved

    def read_revision(self, actor_id, scope_id, planning_id, number):
        with Session(self.engine) as session, session.begin():
            actor_id = authorize(session, actor_id, scope_id)
            revision = exact_revision(session, scope_id, planning_id, number)
            return document(revision, revision_source(session, revision))

    def read_draft(self, actor_id, scope_id, *, draft_id=None, operation_id=None):
        with Session(self.engine) as session, session.begin():
            actor_id = authorize(session, actor_id, scope_id)
            query = (
                select(PlanningDraftRevision, PlanningRevision)
                .join(
                    PlanningRevision,
                    PlanningDraftRevision.base_revision_id == PlanningRevision.id,
                )
                .where(PlanningDraftRevision.scope_id == scope_id)
            )
            if operation_id is not None:
                query = query.where(PlanningDraftRevision.operation_id == operation_id)
            else:
                query = query.join(
                    PlanningDraft, PlanningDraftRevision.draft_id == PlanningDraft.id
                ).where(
                    PlanningDraft.id == draft_id,
                    PlanningDraftRevision.number == PlanningDraft.current_revision,
                )
            row = session.execute(query).one_or_none()
            if row is None:
                raise MaterialError(404, "not_found")
            return draft_document(*row)

    def list_items(self, actor_id, scope_id, *, drafts=False, after=None, limit=50):
        with Session(self.engine) as session, session.begin():
            actor_id = authorize(session, actor_id, scope_id)
            if drafts:
                query = (
                    select(PlanningDraft, PlanningDraftRevision, PlanningRevision)
                    .join(
                        PlanningDraftRevision,
                        (PlanningDraftRevision.draft_id == PlanningDraft.id)
                        & (
                            PlanningDraftRevision.number
                            == PlanningDraft.current_revision
                        ),
                    )
                    .join(
                        PlanningRevision,
                        PlanningDraftRevision.base_revision_id == PlanningRevision.id,
                    )
                )
                model = PlanningDraft
                render = draft_document
            else:
                query = (
                    select(Planning, PlanningRevision, SourceVersion)
                    .join(
                        PlanningRevision,
                        (PlanningRevision.planning_id == Planning.id)
                        & (PlanningRevision.number == Planning.current_revision),
                    )
                    .outerjoin(
                        SourceVersion,
                        PlanningRevision.source_version_id == SourceVersion.id,
                    )
                )
                model = Planning
                render = document
            query = query.where(model.scope_id == scope_id)
            if after is not None:
                query = query.where(model.id > after)
            rows = session.execute(query.order_by(model.id).limit(limit + 1)).all()
            return {
                "items": [render(revision, base) for _, revision, base in rows[:limit]],
                "next_cursor": str(rows[limit - 1][0].id)
                if len(rows) > limit
                else None,
            }
