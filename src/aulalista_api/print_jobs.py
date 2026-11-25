"""Idempotent print job queue and dispatcher for Epson Email Print."""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
    select,
)
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, Session, mapped_column

from aulalista_api.annexes import Annex, annex_document
from aulalista_api.database import Base
from aulalista_api.mail_sender import MailSender, MailSendError
from aulalista_api.materials import MaterialError, authorize
from aulalista_api.pdf_annex import (
    PdfGenerationError,
    render_annex_pdf,
    render_test_page_pdf,
)
from aulalista_api.print_settings import (
    DEFAULT_COPIES,
    DEFAULT_PRINT_TIME,
    TeacherPrintSettings,
    validate_printer_email,
)


class PrintJob(Base):
    __tablename__ = "print_job"
    __table_args__ = (
        ForeignKeyConstraint(
            ["annex_id", "scope_id"],
            ["annex.id", "annex.scope_id"],
            name="fk_print_job_annex_scope",
        ),
        UniqueConstraint(
            "scope_id", "idempotency_key", name="uq_print_job_idempotency"
        ),
        Index("ix_print_job_due", "status", "scheduled_for"),
        Index("ix_print_job_scope_created", "scope_id", "created_at"),
        CheckConstraint("job_kind IN ('annex', 'test_page')", name="ck_print_job_kind"),
        CheckConstraint("copies BETWEEN 1 AND 50", name="ck_print_job_copies"),
        CheckConstraint(
            "status IN ('pending', 'sending', 'sent', 'failed', 'cancelled')",
            name="ck_print_job_status",
        ),
        CheckConstraint("attempts >= 0", name="ck_print_job_attempts"),
        CheckConstraint(
            "(status = 'sent') = (sent_at IS NOT NULL)",
            name="ck_print_job_sent_at",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    scope_id: Mapped[UUID] = mapped_column(ForeignKey("personal_scope.id"))
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("principal.id"))
    annex_id: Mapped[UUID | None] = mapped_column(nullable=True)
    job_kind: Mapped[str] = mapped_column(String(16))
    annex_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    annex_title: Mapped[str] = mapped_column(String(200))
    printer_email: Mapped[str] = mapped_column(String(320))
    copies: Mapped[int] = mapped_column(Integer)
    scheduled_for: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(16), default="pending")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str | None] = mapped_column(String(300), nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    sent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class PrintAnnexRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["now", "scheduled"] = "now"
    copies: int | None = Field(default=None, ge=1, le=50)
    scheduled_for: datetime | None = None
    printer_email: str | None = Field(default=None, max_length=320)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=128)

    @field_validator("printer_email")
    @classmethod
    def check_email(cls, value: str | None) -> str | None:
        return validate_printer_email(value)

    @field_validator("idempotency_key")
    @classmethod
    def check_key(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned or any(ch.isspace() for ch in cleaned):
            raise ValueError("invalid_idempotency_key")
        return cleaned


class TestPageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    printer_email: str | None = Field(default=None, max_length=320)

    @field_validator("printer_email")
    @classmethod
    def check_email(cls, value: str | None) -> str | None:
        return validate_printer_email(value)


def print_job_document(row: PrintJob) -> dict:
    return {
        "id": str(row.id),
        "scope_id": str(row.scope_id),
        "annex_id": str(row.annex_id) if row.annex_id else None,
        "job_kind": row.job_kind,
        "annex_revision": row.annex_revision,
        "annex_title": row.annex_title,
        "printer_email": row.printer_email,
        "copies": row.copies,
        "scheduled_for": row.scheduled_for.astimezone(UTC).isoformat(),
        "status": row.status,
        "attempts": row.attempts,
        "last_error": row.last_error,
        "idempotency_key": row.idempotency_key,
        "created_at": row.created_at.astimezone(UTC).isoformat(),
        "sent_at": row.sent_at.astimezone(UTC).isoformat() if row.sent_at else None,
    }


def _slugify_filename(title: str, copies: int) -> str:
    slug = re.sub(r"[^A-Za-z0-9]+", "_", title).strip("_")[:50] or "anexo"
    return f"{slug}_{copies}x.pdf"


def _now() -> datetime:
    return datetime.now(UTC)


class PrintJobsService:
    def __init__(self, engine: Engine, mail_sender: MailSender):
        self.engine = engine
        self.mail_sender = mail_sender

    def enqueue_annex_print(
        self,
        actor,
        scope_id: UUID,
        annex_id: UUID,
        payload: PrintAnnexRequest,
    ) -> dict:
        # billing imports PrintJob for its meter, so this import cannot be at the top.
        from aulalista_api.billing import lock_print_quota, require_print_quota

        instant = _now()
        if payload.mode == "scheduled":
            if payload.scheduled_for is None:
                raise MaterialError(422, "scheduled_for_required")
            scheduled_for = (
                payload.scheduled_for.astimezone(UTC)
                if payload.scheduled_for.tzinfo is not None
                else payload.scheduled_for.replace(tzinfo=UTC)
            )
        else:
            scheduled_for = instant

        idempotency_key = payload.idempotency_key or f"annex-{annex_id}-{uuid4()}"

        job_id: UUID
        created = False
        with Session(self.engine) as session:
            actor_id = authorize(session, actor, scope_id)
            lock_print_quota(session, scope_id)

            existing = session.scalar(
                select(PrintJob).where(
                    PrintJob.scope_id == scope_id,
                    PrintJob.idempotency_key == idempotency_key,
                )
            )
            if existing is not None:
                return print_job_document(existing)

            annex = session.scalar(
                select(Annex).where(Annex.id == annex_id, Annex.scope_id == scope_id)
            )
            if annex is None:
                raise MaterialError(404, "not_found")
            if annex.status != "approved":
                raise MaterialError(409, "annex_not_approved")

            settings = session.get(TeacherPrintSettings, scope_id)
            printer_email = payload.printer_email or (
                settings.printer_email if settings else None
            )
            if not printer_email:
                raise MaterialError(422, "printer_email_required")

            copies = (
                payload.copies
                if payload.copies is not None
                else (settings.default_copies if settings else DEFAULT_COPIES)
            )
            require_print_quota(session, scope_id, instant)

            job = PrintJob(
                id=uuid4(),
                scope_id=scope_id,
                actor_id=actor_id,
                annex_id=annex.id,
                job_kind="annex",
                annex_revision=annex.revision,
                annex_title=annex.title,
                printer_email=printer_email,
                copies=copies,
                scheduled_for=scheduled_for,
                status="pending",
                attempts=0,
                last_error=None,
                idempotency_key=idempotency_key,
                created_at=instant,
                sent_at=None,
            )
            session.add(job)
            try:
                session.commit()
                created = True
                job_id = job.id
            except IntegrityError:
                session.rollback()
                replay = session.scalar(
                    select(PrintJob).where(
                        PrintJob.scope_id == scope_id,
                        PrintJob.idempotency_key == idempotency_key,
                    )
                )
                if replay is None:
                    raise
                return print_job_document(replay)

        if created and payload.mode == "now":
            dispatched = self.dispatch_single_job(job_id)
            if dispatched is not None:
                return dispatched

        with Session(self.engine) as session:
            row = session.get(PrintJob, job_id)
            assert row is not None
            return print_job_document(row)

    def send_test_page(self, actor, scope_id: UUID, payload: TestPageRequest) -> dict:
        # billing imports PrintJob for its meter, so this import cannot be at the top.
        from aulalista_api.billing import lock_print_quota, require_print_quota

        instant = _now()
        with Session(self.engine) as session:
            actor_id = authorize(session, actor, scope_id)
            settings = session.get(TeacherPrintSettings, scope_id)
            printer_email = payload.printer_email or (
                settings.printer_email if settings else None
            )
            if not printer_email:
                raise MaterialError(422, "printer_email_required")
            lock_print_quota(session, scope_id)
            require_print_quota(session, scope_id, instant)
            job = PrintJob(
                id=uuid4(),
                scope_id=scope_id,
                actor_id=actor_id,
                annex_id=None,
                job_kind="test_page",
                annex_revision=None,
                annex_title="Hoja de prueba Epson",
                printer_email=printer_email,
                copies=1,
                scheduled_for=instant,
                status="pending",
                attempts=0,
                last_error=None,
                idempotency_key=f"test-page-{uuid4()}",
                created_at=instant,
                sent_at=None,
            )
            session.add(job)
            session.commit()
            job_id = job.id

        result = self.dispatch_single_job(job_id)
        if result is not None:
            return result
        with Session(self.engine) as session:
            row = session.get(PrintJob, job_id)
            assert row is not None
            return print_job_document(row)

    def list_jobs(self, actor, scope_id: UUID, *, limit: int = 50) -> list[dict]:
        with Session(self.engine) as session:
            authorize(session, actor, scope_id)
            rows = session.scalars(
                select(PrintJob)
                .where(PrintJob.scope_id == scope_id)
                .order_by(PrintJob.created_at.desc(), PrintJob.id.desc())
                .limit(max(1, min(100, limit)))
            ).all()
            return [print_job_document(r) for r in rows]

    def cancel_job(self, actor, scope_id: UUID, job_id: UUID) -> dict:
        with Session(self.engine) as session:
            authorize(session, actor, scope_id)
            job = session.scalar(
                select(PrintJob)
                .where(PrintJob.id == job_id, PrintJob.scope_id == scope_id)
                .with_for_update()
            )
            if job is None:
                raise MaterialError(404, "not_found")
            if job.status != "pending":
                raise MaterialError(409, "job_not_cancellable")
            job.status = "cancelled"
            session.commit()
            session.refresh(job)
            return print_job_document(job)

    def retry_job(self, actor, scope_id: UUID, job_id: UUID) -> dict:
        with Session(self.engine) as session:
            authorize(session, actor, scope_id)
            job = session.scalar(
                select(PrintJob)
                .where(PrintJob.id == job_id, PrintJob.scope_id == scope_id)
                .with_for_update()
            )
            if job is None:
                raise MaterialError(404, "not_found")
            if job.status != "failed":
                raise MaterialError(409, "job_not_retryable")
            job.status = "pending"
            job.last_error = None
            job.scheduled_for = _now()
            session.commit()
        dispatched = self.dispatch_single_job(job_id)
        if dispatched is not None:
            return dispatched
        with Session(self.engine) as session:
            row = session.get(PrintJob, job_id)
            assert row is not None
            return print_job_document(row)

    def delete_job(self, actor, scope_id: UUID, job_id: UUID) -> None:
        with Session(self.engine) as session:
            authorize(session, actor, scope_id)
            job = session.scalar(
                select(PrintJob)
                .where(PrintJob.id == job_id, PrintJob.scope_id == scope_id)
                .with_for_update()
            )
            if job is None:
                raise MaterialError(404, "not_found")
            if job.status == "sending":
                raise MaterialError(409, "print_job_sending")
            session.delete(job)
            session.commit()

    def clear_jobs(
        self, actor, scope_id: UUID, *, status_filter: str | None = None
    ) -> dict[str, int]:
        normalized = (status_filter or "all").strip().lower()
        allowed_filters: dict[str, tuple[str, ...] | None] = {
            "all": None,
            "finished": ("sent", "failed", "cancelled"),
            "failed": ("failed",),
            "sent": ("sent",),
            "cancelled": ("cancelled",),
            "pending": ("pending",),
        }
        if normalized not in allowed_filters:
            raise MaterialError(422, "invalid_request")
        target_statuses = allowed_filters[normalized]

        with Session(self.engine) as session:
            authorize(session, actor, scope_id)
            stmt = select(PrintJob).where(PrintJob.scope_id == scope_id)
            if target_statuses is not None:
                stmt = stmt.where(PrintJob.status.in_(target_statuses))
            rows = session.scalars(stmt.with_for_update()).all()
            deleted = 0
            skipped_sending = 0
            for row in rows:
                if row.status == "sending":
                    skipped_sending += 1
                    continue
                session.delete(row)
                deleted += 1
            session.commit()
            return {"deleted": deleted, "skipped_sending": skipped_sending}

    def dispatch_single_job(self, job_id: UUID) -> dict | None:
        """Atomically claim one pending job (`pending` -> `sending`) and send it once."""
        claimed = self._claim_jobs(limit=1, only_job_id=job_id)
        if not claimed:
            return None
        return self._execute_claimed_job(claimed[0])

    def dispatch_due_jobs(
        self, *, limit: int = 20, as_of: datetime | None = None
    ) -> dict:
        """Idempotently claim and dispatch due `pending` jobs without ever double-printing."""
        claimed = self._claim_jobs(limit=max(1, min(100, limit)), as_of=as_of or _now())
        sent = 0
        failed = 0
        results: list[dict] = []
        for item in claimed:
            doc = self._execute_claimed_job(item)
            results.append(doc)
            if doc["status"] == "sent":
                sent += 1
            else:
                failed += 1
        return {
            "claimed": len(claimed),
            "sent": sent,
            "failed": failed,
            "jobs": results,
        }

    def _claim_jobs(
        self,
        *,
        limit: int,
        as_of: datetime | None = None,
        only_job_id: UUID | None = None,
    ) -> list[dict]:
        """Claim pending jobs inside a short transaction using FOR UPDATE SKIP LOCKED."""
        claimed_payloads: list[dict] = []
        with Session(self.engine) as session:
            stmt = select(PrintJob).where(PrintJob.status == "pending")
            if only_job_id is not None:
                stmt = stmt.where(PrintJob.id == only_job_id)
            elif as_of is not None:
                stmt = stmt.where(PrintJob.scheduled_for <= as_of)
            stmt = (
                stmt.order_by(PrintJob.scheduled_for.asc(), PrintJob.created_at.asc())
                .limit(limit)
                .with_for_update(skip_locked=True)
            )
            jobs = session.scalars(stmt).all()
            for job in jobs:
                job.status = "sending"
                job.attempts += 1
                job.last_error = None

                annex_payload = None
                settings_snapshot = (DEFAULT_COPIES, DEFAULT_PRINT_TIME)
                if job.job_kind == "annex":
                    if job.annex_id is not None:
                        annex = session.scalar(
                            select(Annex).where(
                                Annex.id == job.annex_id,
                                Annex.scope_id == job.scope_id,
                            )
                        )
                        if annex is not None:
                            annex_payload = annex_document(annex)
                else:
                    settings = session.get(TeacherPrintSettings, job.scope_id)
                    if settings is not None:
                        settings_snapshot = (
                            settings.default_copies,
                            settings.default_print_time,
                        )

                claimed_payloads.append(
                    {
                        "job_id": job.id,
                        "job_kind": job.job_kind,
                        "annex_title": job.annex_title,
                        "printer_email": job.printer_email,
                        "copies": job.copies,
                        "annex": annex_payload,
                        "settings_snapshot": settings_snapshot,
                    }
                )
            session.commit()
        return claimed_payloads

    def _execute_claimed_job(self, item: dict) -> dict:
        job_id: UUID = item["job_id"]
        error_code: str | None = None
        try:
            if item["job_kind"] == "test_page":
                default_copies, default_time = item["settings_snapshot"]
                pdf_bytes = render_test_page_pdf(
                    printer_email=item["printer_email"],
                    default_copies=default_copies,
                    default_print_time=default_time,
                )
                filename = "aulalista_hoja_de_prueba.pdf"
                subject = "AulaLista - Hoja de prueba"
            else:
                if item["annex"] is None:
                    raise PdfGenerationError("annex_not_found", status=404)
                pdf_bytes = render_annex_pdf(item["annex"], copies=item["copies"])
                filename = _slugify_filename(item["annex_title"], item["copies"])
                subject = f"AulaLista - {item['annex_title']} ({item['copies']}x)"

            self.mail_sender.send_pdf(
                to_email=item["printer_email"],
                filename=filename,
                pdf_bytes=pdf_bytes,
                subject=subject,
            )
        except (PdfGenerationError, MailSendError) as err:
            error_code = err.code
        except Exception:
            error_code = "print_dispatch_error"

        with Session(self.engine) as session:
            job = session.get(PrintJob, job_id, with_for_update=True)
            assert job is not None
            if error_code is None:
                job.status = "sent"
                job.sent_at = _now()
                job.last_error = None
            else:
                job.status = "failed"
                job.sent_at = None
                job.last_error = error_code[:300]
            session.commit()
            session.refresh(job)
            return print_job_document(job)
