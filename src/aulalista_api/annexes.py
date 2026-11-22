"""Printable school annexes: generate with OpenAI, edit, approve for printing."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    select,
    update,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Mapped, Session, mapped_column

from aulalista_api.database import Base
from aulalista_api.materials import MaterialError, authorize
from aulalista_api.openai_annex import (
    AnnexContentData,
    AnnexGenerationSpec,
    AnnexGenerator,
    AnnexGeneratorError,
    sanitize_print_text,
)

MAX_ANNEX_REQUEST_BYTES = 32_768


class Annex(Base):
    __tablename__ = "annex"
    __table_args__ = (
        UniqueConstraint("id", "scope_id", name="uq_annex_scope"),
        Index("ix_annex_scope_updated", "scope_id", "updated_at"),
        CheckConstraint("status IN ('draft', 'approved')", name="ck_annex_status"),
        CheckConstraint(
            "provenance IN ('openai-annex-v1', 'fake-annex-v1', 'manual-annex-v1')",
            name="ck_annex_provenance",
        ),
        CheckConstraint("revision >= 1", name="ck_annex_revision"),
        CheckConstraint(
            "(status = 'approved') = (approved_at IS NOT NULL)",
            name="ck_annex_approved_at",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    scope_id: Mapped[UUID] = mapped_column(ForeignKey("personal_scope.id"))
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("principal.id"))
    title: Mapped[str] = mapped_column(String(200))
    subject: Mapped[str] = mapped_column(String(120))
    grade: Mapped[str] = mapped_column(String(80))
    topic: Mapped[str] = mapped_column(String(240))
    instructions: Mapped[str] = mapped_column(Text)
    content: Mapped[dict] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(16), default="draft")
    provenance: Mapped[str] = mapped_column(String(32))
    model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    approved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class AnnexRevision(Base):
    __tablename__ = "annex_revision"
    __table_args__ = (
        UniqueConstraint("annex_id", "revision", name="uq_annex_revision_number"),
        Index("ix_annex_revision_annex_rev", "annex_id", "revision"),
        CheckConstraint("revision >= 1", name="ck_annex_revision_positive"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    annex_id: Mapped[UUID] = mapped_column(ForeignKey("annex.id", ondelete="CASCADE"))
    scope_id: Mapped[UUID] = mapped_column(ForeignKey("personal_scope.id"))
    revision: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(200))
    subject: Mapped[str] = mapped_column(String(120))
    grade: Mapped[str] = mapped_column(String(80))
    topic: Mapped[str] = mapped_column(String(240))
    instructions: Mapped[str] = mapped_column(Text)
    content: Mapped[dict] = mapped_column(JSONB)
    change_summary: Mapped[str] = mapped_column(String(240), default="")
    curricular_trace: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class AnnexGenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    subject: str = Field(min_length=1, max_length=120)
    grade: str = Field(min_length=1, max_length=80)
    topic: str = Field(min_length=1, max_length=240)
    annex_type: str = Field(default="hoja-de-trabajo", min_length=1, max_length=64)
    language: Literal["es", "en"] = "es"
    extra_instructions: str = Field(default="", max_length=800)
    school_id: str | None = Field(default=None, max_length=80)
    subject_id: str | None = Field(default=None, max_length=80)
    curricular_trace: dict | None = None

    @field_validator("subject", "grade", "topic", "annex_type", "extra_instructions")
    @classmethod
    def clean(cls, value: str) -> str:
        return sanitize_print_text(value)


class AnnexCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=200)
    subject: str = Field(min_length=1, max_length=120)
    grade: str = Field(min_length=1, max_length=80)
    topic: str = Field(min_length=1, max_length=240)
    instructions: str = Field(min_length=1, max_length=800)
    content: AnnexContentData

    @field_validator("title", "subject", "grade", "topic", "instructions")
    @classmethod
    def clean(cls, value: str) -> str:
        cleaned = sanitize_print_text(value)
        if not cleaned:
            raise ValueError("empty_text")
        return cleaned


class AnnexUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=200)
    subject: str = Field(min_length=1, max_length=120)
    grade: str = Field(min_length=1, max_length=80)
    topic: str = Field(min_length=1, max_length=240)
    instructions: str = Field(min_length=1, max_length=800)
    content: AnnexContentData
    change_summary: str = Field(default="", max_length=240)

    @field_validator("title", "subject", "grade", "topic", "instructions")
    @classmethod
    def clean_required(cls, value: str) -> str:
        cleaned = sanitize_print_text(value)
        if not cleaned:
            raise ValueError("empty_text")
        return cleaned

    @field_validator("change_summary")
    @classmethod
    def clean_summary(cls, value: str) -> str:
        return sanitize_print_text(value)


def annex_document(row: Annex) -> dict:
    return {
        "id": str(row.id),
        "scope_id": str(row.scope_id),
        "title": row.title,
        "subject": row.subject,
        "grade": row.grade,
        "topic": row.topic,
        "instructions": row.instructions,
        "content": row.content,
        "status": row.status,
        "provenance": row.provenance,
        "model": row.model,
        "revision": row.revision,
        "approved_at": (
            row.approved_at.astimezone(UTC).isoformat() if row.approved_at else None
        ),
        "created_at": row.created_at.astimezone(UTC).isoformat(),
        "updated_at": row.updated_at.astimezone(UTC).isoformat(),
    }


def annex_revision_document(row: AnnexRevision) -> dict:
    return {
        "id": str(row.id),
        "annex_id": str(row.annex_id),
        "scope_id": str(row.scope_id),
        "revision": row.revision,
        "title": row.title,
        "subject": row.subject,
        "grade": row.grade,
        "topic": row.topic,
        "instructions": row.instructions,
        "content": row.content,
        "change_summary": row.change_summary,
        "curricular_trace": row.curricular_trace,
        "created_at": row.created_at.astimezone(UTC).isoformat(),
    }


def _now() -> datetime:
    return datetime.now(UTC)


def _snapshot_revision(
    session: Session, row: Annex, *, change_summary: str, created_at: datetime
) -> None:
    content = row.content if isinstance(row.content, dict) else {}
    session.add(
        AnnexRevision(
            id=uuid4(),
            annex_id=row.id,
            scope_id=row.scope_id,
            revision=row.revision,
            title=row.title,
            subject=row.subject,
            grade=row.grade,
            topic=row.topic,
            instructions=row.instructions,
            content=content,
            change_summary=change_summary[:240],
            curricular_trace=content.get("curricular_trace"),
            created_at=created_at,
        )
    )


class Annexes:
    def __init__(self, engine: Engine, generator: AnnexGenerator):
        self.engine = engine
        self.generator = generator

    def capability(self, actor, scope_id: UUID) -> dict:
        with Session(self.engine) as session:
            authorize(session, actor, scope_id)
        return {
            "available": self.generator.is_configured,
            "model": self.generator.model_name,
        }

    def generate(self, actor, scope_id: UUID, payload: AnnexGenerateRequest) -> dict:
        # Authorize BEFORE invoking the external OpenAI API.
        curricular_hint = ""
        with Session(self.engine) as session:
            actor_id = authorize(session, actor, scope_id)
            if payload.school_id:
                from aulalista_api.curriculum import resolve_curricular_context_text

                curricular_hint = resolve_curricular_context_text(
                    session, scope_id, payload.school_id, payload.subject_id
                )

        merged_extra = "\n".join(
            p for p in (payload.extra_instructions, curricular_hint) if p
        )[:800]
        try:
            generated = self.generator.generate(
                AnnexGenerationSpec(
                    subject=payload.subject,
                    grade=payload.grade,
                    topic=payload.topic,
                    annex_type=payload.annex_type,
                    language=payload.language,
                    extra_instructions=merged_extra,
                )
            )
        except AnnexGeneratorError as error:
            raise MaterialError(error.status, error.code) from None

        content_dump = generated.payload.content.model_dump(mode="json")
        if payload.curricular_trace:
            content_dump["curricular_trace"] = payload.curricular_trace
        content_dump["tool_kind"] = payload.annex_type

        instant = _now()
        with Session(self.engine) as session:
            authorize(session, actor, scope_id)
            row = Annex(
                id=uuid4(),
                scope_id=scope_id,
                actor_id=actor_id,
                title=generated.payload.title,
                subject=payload.subject,
                grade=payload.grade,
                topic=payload.topic,
                instructions=generated.payload.instructions,
                content=content_dump,
                status="draft",
                provenance=generated.provenance,
                model=generated.model,
                revision=1,
                approved_at=None,
                created_at=instant,
                updated_at=instant,
            )
            session.add(row)
            session.flush()
            _snapshot_revision(
                session,
                row,
                change_summary="Versión inicial generada",
                created_at=instant,
            )
            session.commit()
            session.refresh(row)
            return annex_document(row)

    def create_manual(self, actor, scope_id: UUID, payload: AnnexCreateRequest) -> dict:
        instant = _now()
        with Session(self.engine) as session:
            actor_id = authorize(session, actor, scope_id)
            row = Annex(
                id=uuid4(),
                scope_id=scope_id,
                actor_id=actor_id,
                title=payload.title,
                subject=payload.subject,
                grade=payload.grade,
                topic=payload.topic,
                instructions=payload.instructions,
                content=payload.content.model_dump(mode="json"),
                status="draft",
                provenance="manual-annex-v1",
                model=None,
                revision=1,
                approved_at=None,
                created_at=instant,
                updated_at=instant,
            )
            session.add(row)
            session.flush()
            _snapshot_revision(
                session,
                row,
                change_summary="Versión inicial manual",
                created_at=instant,
            )
            session.commit()
            session.refresh(row)
            return annex_document(row)

    def list_for_scope(self, actor, scope_id: UUID, *, limit: int = 50) -> list[dict]:
        with Session(self.engine) as session:
            authorize(session, actor, scope_id)
            rows = session.scalars(
                select(Annex)
                .where(Annex.scope_id == scope_id)
                .order_by(Annex.updated_at.desc(), Annex.id.desc())
                .limit(max(1, min(100, limit)))
            ).all()
            return [annex_document(r) for r in rows]

    def read(self, actor, scope_id: UUID, annex_id: UUID) -> dict:
        with Session(self.engine) as session:
            authorize(session, actor, scope_id)
            row = session.scalar(
                select(Annex).where(Annex.id == annex_id, Annex.scope_id == scope_id)
            )
            if row is None:
                raise MaterialError(404, "not_found")
            return annex_document(row)

    def update(
        self, actor, scope_id: UUID, annex_id: UUID, payload: AnnexUpdateRequest
    ) -> dict:
        instant = _now()
        with Session(self.engine) as session:
            authorize(session, actor, scope_id)
            row = session.scalar(
                select(Annex)
                .where(Annex.id == annex_id, Annex.scope_id == scope_id)
                .with_for_update()
            )
            if row is None:
                raise MaterialError(404, "not_found")
            row.title = payload.title
            row.subject = payload.subject
            row.grade = payload.grade
            row.topic = payload.topic
            row.instructions = payload.instructions
            row.content = payload.content.model_dump(mode="json")
            row.revision += 1
            # Editing resets approval so teachers always review before printing.
            row.status = "draft"
            row.approved_at = None
            row.updated_at = instant
            _snapshot_revision(
                session,
                row,
                change_summary=payload.change_summary or f"Edición revisión {row.revision}",
                created_at=instant,
            )
            session.commit()
            session.refresh(row)
            return annex_document(row)

    def list_revisions(self, actor, scope_id: UUID, annex_id: UUID) -> dict:
        with Session(self.engine) as session:
            authorize(session, actor, scope_id)
            annex = session.scalar(
                select(Annex).where(Annex.id == annex_id, Annex.scope_id == scope_id)
            )
            if annex is None:
                raise MaterialError(404, "not_found")
            rows = session.scalars(
                select(AnnexRevision)
                .where(
                    AnnexRevision.annex_id == annex_id,
                    AnnexRevision.scope_id == scope_id,
                )
                .order_by(AnnexRevision.revision.desc())
                .limit(50)
            ).all()
            return {
                "annex_id": str(annex_id),
                "current_revision": annex.revision,
                "items": [annex_revision_document(r) for r in rows],
            }

    def restore_revision(
        self, actor, scope_id: UUID, annex_id: UUID, target_revision: int
    ) -> dict:
        instant = _now()
        with Session(self.engine) as session:
            authorize(session, actor, scope_id)
            row = session.scalar(
                select(Annex)
                .where(Annex.id == annex_id, Annex.scope_id == scope_id)
                .with_for_update()
            )
            if row is None:
                raise MaterialError(404, "not_found")
            snapshot = session.scalar(
                select(AnnexRevision).where(
                    AnnexRevision.annex_id == annex_id,
                    AnnexRevision.scope_id == scope_id,
                    AnnexRevision.revision == target_revision,
                )
            )
            if snapshot is None:
                raise MaterialError(404, "revision_not_found")
            row.title = snapshot.title
            row.subject = snapshot.subject
            row.grade = snapshot.grade
            row.topic = snapshot.topic
            row.instructions = snapshot.instructions
            row.content = dict(snapshot.content or {})
            row.revision += 1
            row.status = "draft"
            row.approved_at = None
            row.updated_at = instant
            _snapshot_revision(
                session,
                row,
                change_summary=f"Restaurado desde revisión {target_revision}",
                created_at=instant,
            )
            session.commit()
            session.refresh(row)
            return annex_document(row)

    def approve(self, actor, scope_id: UUID, annex_id: UUID) -> dict:
        instant = _now()
        with Session(self.engine) as session:
            authorize(session, actor, scope_id)
            row = session.scalar(
                select(Annex)
                .where(Annex.id == annex_id, Annex.scope_id == scope_id)
                .with_for_update()
            )
            if row is None:
                raise MaterialError(404, "not_found")
            if row.status != "approved":
                row.status = "approved"
                row.approved_at = instant
                row.updated_at = instant
                session.commit()
                session.refresh(row)
            return annex_document(row)

    def delete(self, actor, scope_id: UUID, annex_id: UUID) -> None:
        from aulalista_api.print_jobs import PrintJob

        with Session(self.engine) as session:
            authorize(session, actor, scope_id)
            row = session.scalar(
                select(Annex)
                .where(Annex.id == annex_id, Annex.scope_id == scope_id)
                .with_for_update()
            )
            if row is None:
                raise MaterialError(404, "not_found")
            active_job = session.scalar(
                select(PrintJob.id).where(
                    PrintJob.scope_id == scope_id,
                    PrintJob.annex_id == annex_id,
                    PrintJob.status.in_(("pending", "sending")),
                )
            )
            if active_job is not None:
                raise MaterialError(409, "annex_has_pending_print_jobs")
            # Preserve print history while detaching the FK cleanly.
            session.execute(
                update(PrintJob)
                .where(PrintJob.scope_id == scope_id, PrintJob.annex_id == annex_id)
                .values(annex_id=None)
            )
            session.delete(row)
            session.commit()

    def tools_catalog(self, actor, scope_id: UUID) -> dict:
        from aulalista_api.didactic_generators import DIDACTIC_TOOLS_CATALOG

        with Session(self.engine) as session:
            authorize(session, actor, scope_id)
        return {"items": DIDACTIC_TOOLS_CATALOG}

    def generate_tool(
        self,
        actor,
        scope_id: UUID,
        payload,
    ) -> dict:
        from aulalista_api.curriculum import CurricularProfile
        from aulalista_api.didactic_generators import generate_didactic_tool

        instant = _now()
        with Session(self.engine) as session:
            authorize(session, actor, scope_id)
            trace: dict | None = None
            if payload.school_id and payload.subject_id:
                profile = session.scalar(
                    select(CurricularProfile).where(
                        CurricularProfile.scope_id == scope_id,
                        CurricularProfile.school_id == payload.school_id,
                        CurricularProfile.subject_id == payload.subject_id,
                    )
                )
                if profile is not None:
                    trace = {
                        "phase": profile.phase,
                        "campo_formativo": profile.campo_formativo,
                        "pdas": list(profile.pdas or []),
                        "ejes_articuladores": list(profile.ejes_articuladores or []),
                    }
            generated = generate_didactic_tool(payload, curricular_trace=trace)
            row = Annex(
                scope_id=scope_id,
                actor_id=actor,
                title=generated.title,
                subject=payload.subject.strip(),
                grade=payload.grade.strip(),
                topic=payload.topic.strip(),
                instructions=generated.instructions,
                content=generated.content.model_dump(mode="json"),
                status="draft",
                provenance="manual-annex-v1",
                model="didactic-engine-v1",
                revision=1,
                approved_at=None,
                created_at=instant,
                updated_at=instant,
            )
            session.add(row)
            session.flush()
            _snapshot_revision(
                session,
                row,
                change_summary=f"Generado con herramienta {payload.tool_id}",
                created_at=instant,
            )
            session.commit()
            session.refresh(row)
            return annex_document(row)

    def adapt_annex(
        self,
        actor,
        scope_id: UUID,
        annex_id: UUID,
        payload,
    ) -> dict:
        from aulalista_api.didactic_generators import adapt_existing_annex

        instant = _now()
        with Session(self.engine) as session:
            authorize(session, actor, scope_id)
            original = session.scalar(
                select(Annex).where(Annex.id == annex_id, Annex.scope_id == scope_id)
            )
            if original is None:
                raise MaterialError(404, "not_found")
            orig_doc = annex_document(original)
            adapted = adapt_existing_annex(orig_doc, payload)
            row = Annex(
                scope_id=scope_id,
                actor_id=actor,
                title=adapted.title,
                subject=original.subject,
                grade=(payload.target_grade or original.grade).strip(),
                topic=original.topic,
                instructions=adapted.instructions,
                content=adapted.content.model_dump(mode="json"),
                status="draft",
                provenance="manual-annex-v1",
                model="didactic-engine-v1",
                revision=1,
                approved_at=None,
                created_at=instant,
                updated_at=instant,
            )
            session.add(row)
            session.flush()
            _snapshot_revision(
                session,
                row,
                change_summary=f"Adaptado desde '{original.title}' ({payload.adaptation_mode})",
                created_at=instant,
            )
            session.commit()
            session.refresh(row)
            return annex_document(row)

