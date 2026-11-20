"""Teacher print preferences for Epson Email Print."""

from __future__ import annotations

import re
from datetime import UTC, datetime
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Mapped, Session, mapped_column

from aulalista_api.database import Base
from aulalista_api.materials import MaterialError, authorize

EMAIL_RE = re.compile(
    r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?\.[A-Za-z]{2,63}$"
)
TIME_RE = re.compile(r"^([01][0-9]|2[0-3]):[0-5][0-9]$")

DEFAULT_COPIES = 25
DEFAULT_PRINT_TIME = "06:30"
DEFAULT_TIMEZONE = "America/Mexico_City"


class TeacherPrintSettings(Base):
    __tablename__ = "teacher_print_settings"
    __table_args__ = (
        CheckConstraint(
            "default_copies BETWEEN 1 AND 50", name="ck_print_settings_copies"
        ),
        CheckConstraint(
            "default_print_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'",
            name="ck_print_settings_time",
        ),
    )

    scope_id: Mapped[UUID] = mapped_column(
        ForeignKey("personal_scope.id"), primary_key=True
    )
    printer_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    default_copies: Mapped[int] = mapped_column(Integer, default=DEFAULT_COPIES)
    default_print_time: Mapped[str] = mapped_column(
        String(5), default=DEFAULT_PRINT_TIME
    )
    timezone: Mapped[str] = mapped_column(String(64), default=DEFAULT_TIMEZONE)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


def validate_printer_email(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    if len(cleaned) > 320 or not EMAIL_RE.fullmatch(cleaned) or ".." in cleaned:
        raise ValueError("invalid_printer_email")
    local, domain = cleaned.rsplit("@", 1)
    if local.startswith(".") or local.endswith("."):
        raise ValueError("invalid_printer_email")
    return f"{local}@{domain.lower()}"


class PrintSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    printer_email: str | None = Field(default=None, max_length=320)
    default_copies: int = Field(default=DEFAULT_COPIES, ge=1, le=50)
    default_print_time: str = Field(
        default=DEFAULT_PRINT_TIME, min_length=5, max_length=5
    )
    timezone: str = Field(default=DEFAULT_TIMEZONE, min_length=1, max_length=64)

    @field_validator("printer_email")
    @classmethod
    def check_email(cls, value: str | None) -> str | None:
        return validate_printer_email(value)

    @field_validator("default_print_time")
    @classmethod
    def check_time(cls, value: str) -> str:
        if not TIME_RE.fullmatch(value):
            raise ValueError("invalid_print_time")
        return value

    @field_validator("timezone")
    @classmethod
    def check_tz(cls, value: str) -> str:
        cleaned = value.strip()
        try:
            ZoneInfo(cleaned)
        except ZoneInfoNotFoundError:
            raise ValueError("invalid_timezone") from None
        return cleaned


def settings_document(
    scope_id: UUID,
    row: TeacherPrintSettings | None,
    *,
    smtp_configured: bool,
) -> dict:
    if row is None:
        return {
            "scope_id": str(scope_id),
            "printer_email": None,
            "default_copies": DEFAULT_COPIES,
            "default_print_time": DEFAULT_PRINT_TIME,
            "timezone": DEFAULT_TIMEZONE,
            "smtp_configured": smtp_configured,
            "updated_at": None,
        }
    return {
        "scope_id": str(row.scope_id),
        "printer_email": row.printer_email,
        "default_copies": row.default_copies,
        "default_print_time": row.default_print_time,
        "timezone": row.timezone,
        "smtp_configured": smtp_configured,
        "updated_at": row.updated_at.astimezone(UTC).isoformat(),
    }


class PrintSettingsService:
    def __init__(self, engine: Engine, *, smtp_configured_fn):
        self.engine = engine
        self._smtp_configured_fn = smtp_configured_fn

    def get(self, actor, scope_id: UUID) -> dict:
        with Session(self.engine) as session:
            authorize(session, actor, scope_id)
            row = session.get(TeacherPrintSettings, scope_id)
            return settings_document(
                scope_id, row, smtp_configured=bool(self._smtp_configured_fn())
            )

    def update(self, actor, scope_id: UUID, payload: PrintSettingsUpdate) -> dict:
        instant = datetime.now(UTC)
        with Session(self.engine) as session:
            authorize(session, actor, scope_id)
            row = session.get(TeacherPrintSettings, scope_id, with_for_update=True)
            if row is None:
                row = TeacherPrintSettings(
                    scope_id=scope_id,
                    printer_email=payload.printer_email,
                    default_copies=payload.default_copies,
                    default_print_time=payload.default_print_time,
                    timezone=payload.timezone,
                    updated_at=instant,
                )
                session.add(row)
            else:
                row.printer_email = payload.printer_email
                row.default_copies = payload.default_copies
                row.default_print_time = payload.default_print_time
                row.timezone = payload.timezone
                row.updated_at = instant
            session.commit()
            session.refresh(row)
            return settings_document(
                scope_id, row, smtp_configured=bool(self._smtp_configured_fn())
            )

    def require_printer_email(
        self, session: Session, scope_id: UUID
    ) -> tuple[str, int, str]:
        row = session.get(TeacherPrintSettings, scope_id)
        if row is None or not row.printer_email:
            raise MaterialError(422, "printer_email_required")
        return row.printer_email, row.default_copies, row.default_print_time
