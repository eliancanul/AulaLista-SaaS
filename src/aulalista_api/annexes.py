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


class AnnexGenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    subject: str = Field(min_length=1, max_length=120)
    grade: str = Field(min_length=1, max_length=80)
    topic: str = Field(min_length=1, max_length=240)
    annex_type: str = Field(default="hoja-de-trabajo", min_length=1, max_length=64)
    language: Literal["es", "en"] = "es"
    extra_instructions: str = Field(default="", max_length=800)

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

    @field_validator("title", "subject", "grade", "topic", "instructions")
    @classmethod
    def clean(cls, value: str) -> str:
        cleaned = sanitize_print_text(value)
        if not cleaned:
            raise ValueError("empty_text")
        return cleaned


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


def _now() -> datetime:
    return datetime.now(UTC)


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
        with Session(self.engine) as session:
            actor_id = authorize(session, actor, scope_id)

        try:
            generated = self.generator.generate(
                AnnexGenerationSpec(
                    subject=payload.subject,
                    grade=payload.grade,
                    topic=payload.topic,
                    annex_type=payload.annex_type,
                    language=payload.language,
                    extra_instructions=payload.extra_instructions,
                )
            )
        except AnnexGeneratorError as error:
            raise MaterialError(error.status, error.code) from None

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
                content=generated.payload.content.model_dump(mode="json"),
                status="draft",
                provenance=generated.provenance,
                model=generated.model,
                revision=1,
                approved_at=None,
                created_at=instant,
                updated_at=instant,
            )
            session.add(row)
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
