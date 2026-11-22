"""Support tickets with auto-captured screenshots and full debug backlog."""

from __future__ import annotations

import base64
import binascii
import hashlib
import os
import threading
from collections import deque
from datetime import UTC, datetime
from typing import Any, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    func,
    select,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Mapped, Session, mapped_column

from aulalista_api.database import SCHEMA_REVISION, Base
from aulalista_api.materials import MaterialError, authorize

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024  # 2 MiB
MAX_SUPPORT_REQUEST_BYTES = 3 * 1024 * 1024  # 3 MiB (base64 overhead + debug logs)

_REDACTED_KEY_FRAGMENTS = (
    "password",
    "secret",
    "token",
    "cookie",
    "authorization",
    "csrf",
    "api_key",
    "apikey",
    "credential",
)

SupportCategory = Literal["bug", "ui", "impresion", "ia", "cuenta", "sugerencia"]
SupportSeverity = Literal["low", "medium", "high", "critical"]
SupportStatus = Literal["open", "investigating", "resolved", "wontfix"]


class ServerDiagnosticsRecorder:
    """In-memory ring buffer of recent 4xx/5xx API responses for debug triage."""

    def __init__(self, maxlen: int = 50) -> None:
        self._lock = threading.Lock()
        self._events: deque[dict[str, Any]] = deque(maxlen=maxlen)

    def record(
        self,
        *,
        method: str,
        path: str,
        status_code: int,
        duration_ms: int,
        error: str | None = None,
    ) -> None:
        entry = {
            "at": datetime.now(UTC).isoformat(),
            "method": method[:12],
            "path": path.split("?", 1)[0][:240],
            "status": int(status_code),
            "duration_ms": max(0, int(duration_ms)),
            "error": error[:200] if error else None,
        }
        with self._lock:
            self._events.append(entry)

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            recent = list(self._events)
        return {
            "captured_at": datetime.now(UTC).isoformat(),
            "schema_revision": SCHEMA_REVISION,
            "flags": {
                "openai_chat_enabled": os.environ.get(
                    "AULALISTA_OPENAI_CHAT_ENABLED", ""
                ).strip().lower()
                == "true",
                "openai_annexes_enabled": os.environ.get(
                    "AULALISTA_OPENAI_ANNEXES_ENABLED", ""
                ).strip().lower()
                == "true",
                "email_otp_enabled": os.environ.get(
                    "AULALISTA_EMAIL_OTP_ENABLED", ""
                ).strip().lower()
                == "true",
                "smtp_configured": bool(os.environ.get("SMTP_HOST", "").strip()),
                "local_insecure": os.environ.get(
                    "AULALISTA_LOCAL_INSECURE", ""
                ).strip().lower()
                == "true",
            },
            "recent_server_errors": recent[-25:],
        }


class SupportTicket(Base):
    __tablename__ = "support_ticket"
    __table_args__ = (
        Index("ix_support_ticket_scope_created", "scope_id", "created_at"),
        CheckConstraint(
            "category IN ('bug', 'ui', 'impresion', 'ia', 'cuenta', 'sugerencia')",
            name="ck_support_ticket_category",
        ),
        CheckConstraint(
            "severity IN ('low', 'medium', 'high', 'critical')",
            name="ck_support_ticket_severity",
        ),
        CheckConstraint(
            "status IN ('open', 'investigating', 'resolved', 'wontfix')",
            name="ck_support_ticket_status",
        ),
        CheckConstraint(
            "screenshot_bytes >= 0", name="ck_support_ticket_screenshot_bytes"
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    scope_id: Mapped[UUID] = mapped_column(ForeignKey("personal_scope.id"))
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("principal.id"))
    category: Mapped[str] = mapped_column(String(32))
    severity: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default="open")
    summary: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    view_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    route_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    screenshot_png: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    screenshot_mime: Mapped[str | None] = mapped_column(String(32), nullable=True)
    screenshot_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    screenshot_bytes: Mapped[int] = mapped_column(Integer, default=0)
    debug_bundle: Mapped[dict] = mapped_column(JSONB, default=dict)
    server_diagnostics: Mapped[dict] = mapped_column(JSONB, default=dict)
    triage_notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class SupportTicketCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    category: SupportCategory = "bug"
    severity: SupportSeverity = "medium"
    summary: str = Field(min_length=3, max_length=200)
    description: str = Field(default="", max_length=4000)
    view_name: str | None = Field(default=None, max_length=64)
    route_url: str | None = Field(default=None, max_length=512)
    screenshot_data_url: str | None = Field(default=None, max_length=3_000_000)
    debug_bundle: dict[str, Any] = Field(default_factory=dict)


class SupportTicketUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: SupportStatus | None = None
    severity: SupportSeverity | None = None
    triage_notes: str | None = Field(default=None, max_length=4000)


def sanitize_debug_value(value: Any, *, depth: int = 0) -> Any:
    """Recursively strip secrets and bound payload sizes for safe diagnostic storage."""
    if depth > 6:
        return "[truncated]"
    if isinstance(value, dict):
        cleaned: dict[str, Any] = {}
        for idx, (raw_key, raw_val) in enumerate(value.items()):
            if idx >= 80:
                cleaned["_truncated_keys"] = True
                break
            key = str(raw_key)[:80]
            lowered = key.lower()
            if any(frag in lowered for frag in _REDACTED_KEY_FRAGMENTS):
                cleaned[key] = "[redacted]"
            else:
                cleaned[key] = sanitize_debug_value(raw_val, depth=depth + 1)
        return cleaned
    if isinstance(value, list):
        return [sanitize_debug_value(item, depth=depth + 1) for item in value[:120]]
    if isinstance(value, str):
        return value[:1500]
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return str(value)[:500]


def decode_png_screenshot(data_url: str | None) -> tuple[bytes | None, str | None, str | None]:
    if not data_url:
        return None, None, None
    raw = data_url.strip()
    if raw.startswith("data:"):
        header, _, b64_part = raw.partition(",")
        if "image/png" not in header.lower() or ";base64" not in header.lower():
            raise MaterialError(422, "invalid_screenshot_format")
        raw = b64_part
    try:
        binary = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError):
        raise MaterialError(422, "invalid_screenshot_base64") from None
    if len(binary) > MAX_SCREENSHOT_BYTES:
        raise MaterialError(413, "screenshot_too_large")
    if not binary.startswith(PNG_SIGNATURE):
        raise MaterialError(422, "invalid_screenshot_png")
    digest = hashlib.sha256(binary).hexdigest()
    return binary, "image/png", digest


def _ticket_summary(row: SupportTicket, *, include_bundles: bool = False) -> dict:
    has_screenshot = bool(row.screenshot_bytes and row.screenshot_sha256)
    doc = {
        "id": str(row.id),
        "scope_id": str(row.scope_id),
        "category": row.category,
        "severity": row.severity,
        "status": row.status,
        "summary": row.summary,
        "description": row.description,
        "view_name": row.view_name,
        "route_url": row.route_url,
        "has_screenshot": has_screenshot,
        "screenshot_bytes": row.screenshot_bytes,
        "screenshot_sha256": row.screenshot_sha256,
        "screenshot_url": (
            f"/scopes/{row.scope_id}/support/tickets/{row.id}/screenshot"
            if has_screenshot
            else None
        ),
        "triage_notes": row.triage_notes,
        "console_error_count": len(
            (row.debug_bundle or {}).get("consoleErrors", [])
        ),
        "failed_request_count": sum(
            1
            for req in (row.debug_bundle or {}).get("networkLog", [])
            if isinstance(req, dict) and (req.get("status", 0) == 0 or req.get("status", 200) >= 400)
        ),
        "created_at": row.created_at.astimezone(UTC).isoformat(),
        "updated_at": row.updated_at.astimezone(UTC).isoformat(),
    }
    if include_bundles:
        doc["debug_bundle"] = row.debug_bundle or {}
        doc["server_diagnostics"] = row.server_diagnostics or {}
    return doc


class SupportService:
    def __init__(
        self,
        engine: Engine,
        diagnostics: ServerDiagnosticsRecorder | None = None,
    ) -> None:
        self.engine = engine
        self.diagnostics = diagnostics or ServerDiagnosticsRecorder()

    def create_ticket(
        self, actor, scope_id: UUID, req: SupportTicketCreateRequest
    ) -> dict:
        png_bytes, mime, sha256 = decode_png_screenshot(req.screenshot_data_url)
        cleaned_bundle = sanitize_debug_value(req.debug_bundle or {})
        server_diag = self.diagnostics.snapshot()
        now = datetime.now(UTC)

        with Session(self.engine) as db:
            principal_id = authorize(db, actor, scope_id)
            ticket = SupportTicket(
                id=uuid4(),
                scope_id=scope_id,
                actor_id=principal_id,
                category=req.category,
                severity=req.severity,
                status="open",
                summary=req.summary.strip(),
                description=req.description.strip(),
                view_name=req.view_name.strip() if req.view_name else None,
                route_url=req.route_url.split("?", 1)[0][:512] if req.route_url else None,
                screenshot_png=png_bytes,
                screenshot_mime=mime,
                screenshot_sha256=sha256,
                screenshot_bytes=len(png_bytes) if png_bytes else 0,
                debug_bundle=cleaned_bundle if isinstance(cleaned_bundle, dict) else {},
                server_diagnostics=server_diag,
                triage_notes="",
                created_at=now,
                updated_at=now,
            )
            db.add(ticket)
            db.commit()
            db.refresh(ticket)
            return _ticket_summary(ticket, include_bundles=True)

    def list_tickets(
        self,
        actor,
        scope_id: UUID,
        *,
        status: str | None = None,
        severity: str | None = None,
        limit: int = 50,
    ) -> dict:
        capped = max(1, min(limit, 100))
        with Session(self.engine) as db:
            authorize(db, actor, scope_id)
            all_rows = db.scalars(
                select(SupportTicket)
                .where(SupportTicket.scope_id == scope_id)
                .order_by(SupportTicket.created_at.desc())
                .limit(200)
            ).all()

            counts_by_status = {"open": 0, "investigating": 0, "resolved": 0, "wontfix": 0}
            counts_by_severity = {"low": 0, "medium": 0, "high": 0, "critical": 0}
            filtered: list[SupportTicket] = []
            for row in all_rows:
                if row.status in counts_by_status:
                    counts_by_status[row.status] += 1
                if row.severity in counts_by_severity:
                    counts_by_severity[row.severity] += 1
                if status and row.status != status:
                    continue
                if severity and row.severity != severity:
                    continue
                filtered.append(row)

            return {
                "scope_id": str(scope_id),
                "total": len(all_rows),
                "counts_by_status": counts_by_status,
                "counts_by_severity": counts_by_severity,
                "items": [_ticket_summary(r) for r in filtered[:capped]],
            }

    def get_ticket(self, actor, scope_id: UUID, ticket_id: UUID) -> dict:
        with Session(self.engine) as db:
            authorize(db, actor, scope_id)
            row = db.scalar(
                select(SupportTicket).where(
                    SupportTicket.id == ticket_id,
                    SupportTicket.scope_id == scope_id,
                )
            )
            if row is None:
                raise MaterialError(404, "not_found")
            return _ticket_summary(row, include_bundles=True)

    def get_screenshot(
        self, actor, scope_id: UUID, ticket_id: UUID
    ) -> tuple[bytes, str, str]:
        with Session(self.engine) as db:
            authorize(db, actor, scope_id)
            row = db.scalar(
                select(SupportTicket).where(
                    SupportTicket.id == ticket_id,
                    SupportTicket.scope_id == scope_id,
                )
            )
            if row is None or not row.screenshot_png:
                raise MaterialError(404, "not_found")
            return (
                row.screenshot_png,
                row.screenshot_mime or "image/png",
                row.screenshot_sha256 or "",
            )

    def update_ticket(
        self,
        actor,
        scope_id: UUID,
        ticket_id: UUID,
        req: SupportTicketUpdateRequest,
    ) -> dict:
        with Session(self.engine) as db:
            authorize(db, actor, scope_id)
            row = db.scalar(
                select(SupportTicket)
                .where(
                    SupportTicket.id == ticket_id,
                    SupportTicket.scope_id == scope_id,
                )
                .with_for_update()
            )
            if row is None:
                raise MaterialError(404, "not_found")
            if req.status is not None:
                row.status = req.status
            if req.severity is not None:
                row.severity = req.severity
            if req.triage_notes is not None:
                row.triage_notes = req.triage_notes.strip()
            row.updated_at = datetime.now(UTC)
            db.commit()
            db.refresh(row)
            return _ticket_summary(row, include_bundles=True)

    def export_backlog(self, actor, scope_id: UUID) -> dict:
        with Session(self.engine) as db:
            authorize(db, actor, scope_id)
            rows = db.scalars(
                select(SupportTicket)
                .where(SupportTicket.scope_id == scope_id)
                .order_by(SupportTicket.created_at.desc())
                .limit(200)
            ).all()
            return {
                "exported_at": datetime.now(UTC).isoformat(),
                "schema_revision": SCHEMA_REVISION,
                "scope_id": str(scope_id),
                "total_tickets": len(rows),
                "server_diagnostics": self.diagnostics.snapshot(),
                "tickets": [_ticket_summary(r, include_bundles=True) for r in rows],
            }
