"""Resultado fixture durable, independiente de la identidad de la fuente T2."""

import hashlib
import json
from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field
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
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, Session, mapped_column

from aulalista_api.database import Base
from aulalista_api.materials import MaterialError, Source, SourceVersion, authorize
from aulalista_api.planning_fixture import generate

MAX_REQUEST_BYTES = 4096


class PlanningRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    contract_version: Annotated[int, Field(strict=True, ge=1, le=1)]
    fixture_context: Literal["timing-example-v1", "water-observation-v1"]
    prompt: Annotated[str, Field(strict=True, min_length=1, max_length=256)]
    source_id: UUID
    expected_source_version: Annotated[int, Field(strict=True, ge=1, le=2_147_483_646)]

    def canonical(self) -> bytes:
        return json.dumps(
            self.model_dump(mode="json"),
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        ).encode()


class Planning(Base):
    __tablename__ = "planning"
    __table_args__ = (
        UniqueConstraint("id", "scope_id", name="uq_planning_scope"),
        Index("ix_planning_scope_id", "scope_id", "id"),
        CheckConstraint("current_revision > 0", name="ck_planning_revision"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    scope_id: Mapped[UUID] = mapped_column(ForeignKey("personal_scope.id"))
    current_revision: Mapped[int]


class PlanningRevision(Base):
    __tablename__ = "planning_revision"
    __table_args__ = (
        ForeignKeyConstraint(
            ["planning_id", "scope_id"],
            ["planning.id", "planning.scope_id"],
            name="fk_revision_planning_scope",
        ),
        ForeignKeyConstraint(
            ["source_version_id", "scope_id"],
            ["source_version.id", "source_version.scope_id"],
            name="fk_planning_source_scope",
        ),
        ForeignKeyConstraint(
            ["origin_revision_id", "scope_id", "source_version_id"],
            [
                "planning_revision.id",
                "planning_revision.scope_id",
                "planning_revision.source_version_id",
            ],
            name="fk_planning_origin_source",
        ),
        UniqueConstraint(
            "id", "scope_id", "source_version_id", name="uq_planning_revision_source"
        ),
        UniqueConstraint(
            "id", "planning_id", "scope_id", name="uq_planning_revision_target"
        ),
        UniqueConstraint("planning_id", "number", name="uq_planning_revision_number"),
        UniqueConstraint("scope_id", "operation_id", name="uq_planning_operation"),
        CheckConstraint("number > 0", name="ck_planning_revision_number"),
        CheckConstraint(
            "request_fingerprint ~ '^[0-9a-f]{64}$'", name="ck_planning_fingerprint"
        ),
        CheckConstraint(
            "octet_length(request::text) BETWEEN 1 AND 8192",
            name="ck_planning_request_size",
        ),
        CheckConstraint(
            "octet_length(result::text) BETWEEN 1 AND 8192",
            name="ck_planning_result_size",
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    planning_id: Mapped[UUID]
    scope_id: Mapped[UUID]
    number: Mapped[int]
    source_version_id: Mapped[UUID]
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("principal.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    operation_id: Mapped[UUID]
    request_fingerprint: Mapped[str]
    request: Mapped[dict] = mapped_column(JSONB)
    result: Mapped[dict] = mapped_column(JSONB)
    origin_revision_id: Mapped[UUID | None]


def document(revision: PlanningRevision, source: SourceVersion) -> dict:
    saved = {
        "receipt": {
            "contract_version": 1,
            "namespace": "planning-v1",
            "planning_id": str(revision.planning_id),
            "revision_id": str(revision.id),
            "revision": revision.number,
            "scope_id": str(revision.scope_id),
            "actor_id": str(revision.actor_id),
            "operation_id": str(revision.operation_id),
            "created_at": revision.created_at.astimezone(UTC).isoformat(),
            "source_id": str(source.source_id),
            "source_version_id": str(source.id),
            "source_version": source.number,
            "source_sha256": source.content_sha256,
        },
        "request": revision.request,
        "result": revision.result,
    }
    if revision.origin_revision_id is not None:
        saved["origin"] = revision.request["origin"]
    if "initial_request" in revision.request:
        saved["initial_request"] = revision.request["initial_request"]
    return saved


class Plannings:
    def __init__(self, engine):
        self.engine = engine

    def write(
        self,
        actor_id: UUID,
        scope_id: UUID,
        operation_id: UUID,
        request: PlanningRequest,
    ) -> dict:
        canonical = request.canonical()
        if len(canonical) > MAX_REQUEST_BYTES:
            raise MaterialError(413, "content_too_large")
        fingerprint = hashlib.sha256(
            b"aulalista-planning-request-v1\0" + canonical
        ).hexdigest()
        lock = int.from_bytes(
            hashlib.sha256(
                b"planning-v1\0" + scope_id.bytes + operation_id.bytes
            ).digest()[:8],
            "big",
            signed=True,
        )
        with Session(self.engine) as session, session.begin():
            authorize(session, actor_id, scope_id)
            session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock})
            previous = session.scalar(
                select(PlanningRevision).where(
                    PlanningRevision.scope_id == scope_id,
                    PlanningRevision.operation_id == operation_id,
                )
            )
            if previous is not None:
                if previous.request_fingerprint != fingerprint:
                    raise MaterialError(409, "conflict")
                saved = document(
                    previous, session.get(SourceVersion, previous.source_version_id)
                )
            else:
                # Serialize the expected source revision against T2's conditional UPDATE.
                source = session.scalar(
                    select(Source)
                    .where(Source.id == request.source_id, Source.scope_id == scope_id)
                    .with_for_update()
                )
                if source is None:
                    raise MaterialError(404, "not_found")
                if source.current_version != request.expected_source_version:
                    raise MaterialError(409, "conflict")
                version = session.scalar(
                    select(SourceVersion).where(
                        SourceVersion.source_id == source.id,
                        SourceVersion.scope_id == scope_id,
                        SourceVersion.number == request.expected_source_version,
                    )
                )
                if version is None:
                    raise MaterialError(404, "not_found")
                try:
                    result = generate(
                        request.fixture_context, request.prompt, version.content
                    )
                except ValueError:
                    raise MaterialError(422, "unsupported_fixture") from None
                planning = Planning(scope_id=scope_id, current_revision=1)
                session.add(planning)
                session.flush()
                revision = PlanningRevision(
                    planning_id=planning.id,
                    scope_id=scope_id,
                    number=1,
                    source_version_id=version.id,
                    actor_id=actor_id,
                    operation_id=operation_id,
                    request_fingerprint=fingerprint,
                    request=request.model_dump(mode="json"),
                    result=result,
                )
                session.add(revision)
                session.flush()
                saved = document(revision, version)
        # Do not expose success until the context manager has committed.
        return saved

    def read(
        self,
        actor_id: UUID,
        scope_id: UUID,
        *,
        planning_id: UUID | None = None,
        operation_id: UUID | None = None,
    ) -> dict:
        with Session(self.engine) as session, session.begin():
            authorize(session, actor_id, scope_id)
            query = (
                select(PlanningRevision, SourceVersion)
                .join(
                    SourceVersion,
                    PlanningRevision.source_version_id == SourceVersion.id,
                )
                .where(PlanningRevision.scope_id == scope_id)
            )
            if operation_id is not None:
                query = query.where(PlanningRevision.operation_id == operation_id)
            else:
                query = query.join(
                    Planning, PlanningRevision.planning_id == Planning.id
                ).where(
                    Planning.id == planning_id,
                    PlanningRevision.number == Planning.current_revision,
                )
            row = session.execute(query).one_or_none()
            if row is None:
                raise MaterialError(404, "not_found")
            return document(*row)
