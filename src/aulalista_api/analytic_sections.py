"""Manual analytic sections: private, immutable revisions, without generation."""

import hashlib
import json
from datetime import UTC, datetime
from typing import Annotated
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
    update,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, Session, mapped_column, relationship

from aulalista_api.database import Base
from aulalista_api.guided_planning import (
    ExactReference,
    GuidedPlanningRequest,
    ManualContext,
    Text,
)
from aulalista_api.materials import MaterialError, SourceVersion, authorize

MAX_SECTION_BYTES = 8192
MAX_SECTION_DATA_BYTES = 8000
RevisionNumber = Annotated[int, Field(strict=True, ge=1, le=2_147_483_646)]


class ContentPda(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content: Annotated[Text, Field(max_length=500)]
    pda: Annotated[Text, Field(max_length=500)]


class AnalyticSectionData(BaseModel):
    model_config = ConfigDict(extra="forbid")
    contract_version: Annotated[int, Field(strict=True, ge=1, le=1)]
    name: Annotated[Text, Field(max_length=200)]
    grade: Annotated[Text, Field(max_length=80)]
    period: Annotated[Text, Field(max_length=80)]
    context: ManualContext | None = None
    situation: Annotated[Text, Field(max_length=1000)]
    entries: Annotated[list[ContentPda], Field(min_length=1, max_length=8)]
    formative_field: Annotated[Text, Field(max_length=120)] | None = None
    articulating_axes: Annotated[
        list[Annotated[Text, Field(max_length=80)]], Field(max_length=7)
    ] = Field(default_factory=list)
    language: Annotated[Text, Field(max_length=40)] = "es"
    reference: ExactReference | None = None


class AnalyticSectionEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    contract_version: Annotated[int, Field(strict=True, ge=1, le=1)]
    expected_revision: RevisionNumber
    data: AnalyticSectionData


class DerivePlanningRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    contract_version: Annotated[int, Field(strict=True, ge=1, le=1)]
    subject: Annotated[Text, Field(max_length=120)]
    duration_minutes: Annotated[int, Field(strict=True, ge=15, le=180)] = 50
    method: Annotated[Text, Field(max_length=80)] = "active-learning"


class AnalyticSection(Base):
    __tablename__ = "analytic_section"
    __table_args__ = (
        UniqueConstraint("id", "scope_id", name="uq_analytic_section_scope"),
        Index("ix_analytic_section_scope_id", "scope_id", "id"),
        CheckConstraint("current_revision > 0", name="ck_analytic_section_revision"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    scope_id: Mapped[UUID] = mapped_column(ForeignKey("personal_scope.id"))
    current_revision: Mapped[int]


class AnalyticSectionRevision(Base):
    __tablename__ = "analytic_section_revision"
    __table_args__ = (
        ForeignKeyConstraint(
            ["section_id", "scope_id"],
            ["analytic_section.id", "analytic_section.scope_id"],
            name="fk_analytic_revision_section_scope",
        ),
        ForeignKeyConstraint(
            ["source_version_id", "scope_id"],
            ["source_version.id", "source_version.scope_id"],
            name="fk_analytic_source_scope",
        ),
        UniqueConstraint("id", "scope_id", name="uq_analytic_revision_scope"),
        UniqueConstraint("section_id", "number", name="uq_analytic_revision_number"),
        UniqueConstraint("scope_id", "operation_id", name="uq_analytic_operation"),
        CheckConstraint("number > 0", name="ck_analytic_revision_number"),
        CheckConstraint(
            "request_fingerprint ~ '^[0-9a-f]{64}$'", name="ck_analytic_fingerprint"
        ),
        CheckConstraint(
            "octet_length(data::text) BETWEEN 1 AND 16384",
            name="ck_analytic_data_size",
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    section_id: Mapped[UUID]
    scope_id: Mapped[UUID]
    number: Mapped[int]
    source_version_id: Mapped[UUID | None]
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("principal.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    operation_id: Mapped[UUID]
    request_fingerprint: Mapped[str]
    data: Mapped[dict] = mapped_column(JSONB)
    source_version: Mapped[SourceVersion | None] = relationship(
        foreign_keys="[AnalyticSectionRevision.source_version_id, AnalyticSectionRevision.scope_id]",
        viewonly=True,
        lazy="joined",
    )


def section_document(revision: AnalyticSectionRevision, source: SourceVersion | None):
    return {
        "receipt": {
            "contract_version": 1,
            "namespace": "analytic-section-v1",
            "section_id": str(revision.section_id),
            "revision_id": str(revision.id),
            "revision": revision.number,
            "scope_id": str(revision.scope_id),
            "actor_id": str(revision.actor_id),
            "operation_id": str(revision.operation_id),
            "created_at": revision.created_at.astimezone(UTC).isoformat(),
            "source_id": str(source.source_id) if source else None,
            "source_version_id": str(source.id) if source else None,
            "source_version": source.number if source else None,
            "source_sha256": source.content_sha256 if source else None,
        },
        "data": revision.data,
        "provenance": "manual-v1",
    }


def render_section(session, revision):
    source = (
        session.get(SourceVersion, revision.source_version_id)
        if revision.source_version_id is not None
        else None
    )
    return section_document(revision, source)


def exact_section(session, scope_id, section_id, number):
    revision = session.scalar(
        select(AnalyticSectionRevision).where(
            AnalyticSectionRevision.scope_id == scope_id,
            AnalyticSectionRevision.section_id == section_id,
            AnalyticSectionRevision.number == number,
        )
    )
    if revision is None:
        raise MaterialError(404, "not_found")
    return revision


def derived_guided_request(section, request):
    data = AnalyticSectionData.model_validate(section.data)
    return GuidedPlanningRequest(
        contract_version=2,
        fixture_context="guided-water-v1",
        subject=request.subject,
        grade=data.grade,
        topic=data.name,
        duration_minutes=request.duration_minutes,
        method=request.method,
        language=data.language,
        context=data.context,
        formative_field=data.formative_field,
        articulating_axes=data.articulating_axes,
        reference=data.reference,
    )


class AnalyticSections:
    def __init__(self, engine):
        self.engine = engine

    def write(
        self,
        actor_id,
        scope_id,
        operation_id,
        data,
        *,
        section_id=None,
        expected_revision=None,
    ):
        payload = data.model_dump(mode="json")
        if (
            len(
                json.dumps(
                    payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False
                ).encode()
            )
            > MAX_SECTION_DATA_BYTES
        ):
            raise MaterialError(413, "content_too_large")
        canonical = json.dumps(
            [str(section_id) if section_id else None, expected_revision, payload],
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        ).encode()
        if len(canonical) > MAX_SECTION_BYTES:
            raise MaterialError(413, "content_too_large")
        digest = hashlib.sha256(b"analytic-section-v1\0" + canonical).hexdigest()
        lock = int.from_bytes(
            hashlib.sha256(
                b"analytic-section-v1\0" + scope_id.bytes + operation_id.bytes
            ).digest()[:8],
            "big",
            signed=True,
        )
        with Session(self.engine) as session, session.begin():
            actor_id = authorize(session, actor_id, scope_id)
            session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock})
            previous = session.scalar(
                select(AnalyticSectionRevision).where(
                    AnalyticSectionRevision.scope_id == scope_id,
                    AnalyticSectionRevision.operation_id == operation_id,
                )
            )
            if previous is not None:
                if previous.request_fingerprint != digest:
                    raise MaterialError(409, "conflict")
                saved = render_section(session, previous)
            else:
                source = None
                if data.reference is not None:
                    source = session.scalar(
                        select(SourceVersion).where(
                            SourceVersion.scope_id == scope_id,
                            SourceVersion.source_id == data.reference.source_id,
                            SourceVersion.number == data.reference.source_version,
                        )
                    )
                    if source is None:
                        raise MaterialError(404, "not_found")
                if section_id is None:
                    section = AnalyticSection(scope_id=scope_id, current_revision=1)
                    session.add(section)
                    session.flush()
                    target_id, number = section.id, 1
                else:
                    base = exact_section(
                        session, scope_id, section_id, expected_revision
                    )
                    number = session.scalar(
                        update(AnalyticSection)
                        .where(
                            AnalyticSection.id == section_id,
                            AnalyticSection.scope_id == scope_id,
                            AnalyticSection.current_revision == expected_revision,
                        )
                        .values(current_revision=expected_revision + 1)
                        .returning(AnalyticSection.current_revision)
                    )
                    if number is None:
                        raise MaterialError(409, "conflict")
                    if base.data == payload:
                        raise MaterialError(422, "unchanged_text")
                    target_id = section_id
                revision = AnalyticSectionRevision(
                    section_id=target_id,
                    scope_id=scope_id,
                    number=number,
                    source_version_id=source.id if source else None,
                    actor_id=actor_id,
                    operation_id=operation_id,
                    request_fingerprint=digest,
                    data=payload,
                )
                session.add(revision)
                session.flush()
                saved = section_document(revision, source)
        return saved

    def read(
        self, actor_id, scope_id, *, section_id=None, number=None, operation_id=None
    ):
        with Session(self.engine) as session, session.begin():
            authorize(session, actor_id, scope_id)
            query = select(AnalyticSectionRevision).where(
                AnalyticSectionRevision.scope_id == scope_id,
            )
            if operation_id is not None:
                query = query.where(
                    AnalyticSectionRevision.operation_id == operation_id
                )
            elif number is not None:
                return render_section(
                    session, exact_section(session, scope_id, section_id, number)
                )
            else:
                query = query.join(
                    AnalyticSection,
                    AnalyticSectionRevision.section_id == AnalyticSection.id,
                ).where(
                    AnalyticSection.id == section_id,
                    AnalyticSectionRevision.number == AnalyticSection.current_revision,
                )
            revision = session.scalar(query)
            if revision is None:
                raise MaterialError(404, "not_found")
            return render_section(session, revision)

    def list_items(self, actor_id, scope_id, *, after=None, limit=50):
        with Session(self.engine) as session, session.begin():
            authorize(session, actor_id, scope_id)
            query = (
                select(AnalyticSectionRevision)
                .join(
                    AnalyticSection,
                    AnalyticSectionRevision.section_id == AnalyticSection.id,
                )
                .where(
                    AnalyticSection.scope_id == scope_id,
                    AnalyticSectionRevision.number == AnalyticSection.current_revision,
                )
            )
            if after is not None:
                if (
                    session.scalar(
                        select(AnalyticSection.id).where(
                            AnalyticSection.id == after,
                            AnalyticSection.scope_id == scope_id,
                        )
                    )
                    is None
                ):
                    raise MaterialError(422, "invalid_request")
                query = query.where(AnalyticSection.id > after)
            rows = session.scalars(
                query.order_by(AnalyticSection.id).limit(limit + 1)
            ).all()
            return {
                "items": [render_section(session, row) for row in rows[:limit]],
                "next_cursor": str(rows[limit - 1].section_id)
                if len(rows) > limit
                else None,
            }
