"""Subscription plans, transparent monthly usage quotas, ledger, and Stripe-ready billing (#128)."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from datetime import UTC, datetime, timedelta
from typing import Any, Literal
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
    select,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Mapped, Session, mapped_column

from aulalista_api.agent_chat import AgentChatTurn
from aulalista_api.annexes import Annex
from aulalista_api.auth_models import Identity
from aulalista_api.database import Base, PersonalScope
from aulalista_api.documents import TeacherDocument
from aulalista_api.materials import MaterialError, authorize
from aulalista_api.print_jobs import PrintJob

PlanId = Literal["free", "docente", "escuela"]

PLANS_CATALOG: list[dict[str, Any]] = [
    {
        "id": "free",
        "name": "Gratis · Beta Docente",
        "tagline": "Ideal para empezar a planear, generar anexos y probar la impresión remota.",
        "price_mxn_monthly": 0,
        "currency": "MXN",
        "limits": {
            "ai_turns": 60,
            "annexes": 25,
            "print_jobs": 5,
            "documents": 10,
            "ai_budget_usd": 2.0,
        },
        "features": [
            "Hasta 5 impresiones remotas al mes en tu Epson (ilimitadas en Pro)",
            "Orquestador + agentes por materia",
            "11 herramientas didácticas imprimibles y proyector de aula",
            "Planeaciones y documentos seguros (PDF, DOCX, imágenes) con purga real",
        ],
    },
    {
        "id": "docente",
        "name": "Pro Docente",
        "tagline": "Para maestras y maestros con múltiples grupos, escuelas e impresión diaria sin límite.",
        "price_mxn_monthly": 149,
        "currency": "MXN",
        "limits": {
            "ai_turns": 600,
            "annexes": 200,
            "print_jobs": None,
            "documents": 80,
            "ai_budget_usd": 15.0,
        },
        "features": [
            "Impresión ilimitada y programada a tu Epson sin costo extra",
            "10× más turnos de IA y anexos por mes",
            "Hasta 80 planeaciones y documentos con OCR y derivación directa",
            "Historial completo de revisiones y soporte prioritario",
        ],
    },
    {
        "id": "escuela",
        "name": "Escuela / Directivo",
        "tagline": "Capacidad ampliada para coordinación académica y proyectos de plantel.",
        "price_mxn_monthly": 690,
        "currency": "MXN",
        "limits": {
            "ai_turns": 3000,
            "annexes": 1000,
            "print_jobs": None,
            "documents": 400,
            "ai_budget_usd": 75.0,
        },
        "features": [
            "Impresión ilimitada y gestión multi-escuela SEP/NEM",
            "Cuotas amplias para planteles y academia completa",
            "Búsqueda web citada y respaldo de evidencias",
            "Facturación centralizada lista para Stripe",
        ],
    },
]

PLANS_BY_ID: dict[str, dict[str, Any]] = {plan["id"]: plan for plan in PLANS_CATALOG}


class ScopeSubscription(Base):
    __tablename__ = "scope_subscription"
    __table_args__ = (
        CheckConstraint(
            "plan_id IN ('free', 'docente', 'escuela')",
            name="ck_scope_subscription_plan_id",
        ),
        CheckConstraint(
            "status IN ('active', 'trialing', 'past_due', 'canceled')",
            name="ck_scope_subscription_status",
        ),
    )

    scope_id: Mapped[UUID] = mapped_column(
        ForeignKey("personal_scope.id", ondelete="CASCADE"), primary_key=True
    )
    plan_id: Mapped[str] = mapped_column(String(32), default="free")
    status: Mapped[str] = mapped_column(String(32), default="active")
    billing_provider: Mapped[str] = mapped_column(String(32), default="beta_preview")
    provider_customer_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    provider_subscription_id: Mapped[str | None] = mapped_column(
        String(120), nullable=True
    )
    current_period_start: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    current_period_end: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class UsageLedgerEvent(Base):
    __tablename__ = "usage_ledger_event"
    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_usage_ledger_idempotency_key"),
        Index("ix_usage_ledger_event_scope_created", "scope_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    scope_id: Mapped[UUID] = mapped_column(
        ForeignKey("personal_scope.id", ondelete="CASCADE")
    )
    actor_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("principal.id", ondelete="SET NULL"), nullable=True
    )
    event_type: Mapped[str] = mapped_column(String(64))
    metric: Mapped[str] = mapped_column(String(64), default="")
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    estimated_usd_micros: Mapped[int] = mapped_column(Integer, default=0)
    idempotency_key: Mapped[str | None] = mapped_column(String(160), nullable=True)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class CheckoutRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    plan_id: PlanId
    preview_switch: bool = False
    success_url: str | None = Field(default=None, max_length=500)
    cancel_url: str | None = Field(default=None, max_length=500)


def _month_bounds_utc(now: datetime | None = None) -> tuple[datetime, datetime]:
    ref = (now or datetime.now(UTC)).astimezone(UTC)
    start = ref.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)
    return start, end


def _stripe_enabled() -> bool:
    return (
        os.environ.get("AULALISTA_STRIPE_ENABLED", "").strip().lower() == "true"
        and bool(os.environ.get("STRIPE_SECRET_KEY", "").strip())
    )


def verify_stripe_signature(
    raw_body: bytes,
    signature_header: str | None,
    webhook_secret: str,
    *,
    tolerance_seconds: int = 300,
    now_ts: int | None = None,
) -> bool:
    if not signature_header or not webhook_secret:
        return False
    timestamp: int | None = None
    signatures: list[str] = []
    for part in signature_header.split(","):
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        key = key.strip()
        value = value.strip()
        if key == "t":
            try:
                timestamp = int(value)
            except ValueError:
                return False
        elif key == "v1":
            signatures.append(value)
    if timestamp is None or not signatures:
        return False
    current_ts = int(time.time()) if now_ts is None else now_ts
    if abs(current_ts - timestamp) > tolerance_seconds:
        return False
    signed_payload = f"{timestamp}.".encode("ascii") + raw_body
    expected = hmac.new(
        webhook_secret.encode("utf-8"), signed_payload, hashlib.sha256
    ).hexdigest()
    return any(hmac.compare_digest(expected, sig) for sig in signatures)


def _courtesy_grant_config() -> tuple[set[str], set[str], PlanId]:
    raw_emails = os.environ.get("AULALISTA_PRO_GRANT_EMAILS", "")
    emails = {
        e.strip().lower() for e in raw_emails.split(",") if e.strip() and "@" in e
    }
    raw_scopes = os.environ.get("AULALISTA_PRO_GRANT_SCOPE_IDS", "")
    scope_ids = {s.strip().lower() for s in raw_scopes.split(",") if s.strip()}
    raw_plan = os.environ.get("AULALISTA_PRO_GRANT_PLAN", "docente").strip().lower()
    plan_id: PlanId = raw_plan if raw_plan in ("docente", "escuela") else "docente"
    return emails, scope_ids, plan_id


def _scope_matches_courtesy_grant(
    session: Session, scope_id: UUID
) -> tuple[bool, PlanId, str]:
    emails, scope_ids, plan_id = _courtesy_grant_config()
    if not emails and not scope_ids:
        return False, plan_id, ""
    if str(scope_id).lower() in scope_ids:
        return True, plan_id, f"scope:{scope_id}"
    if emails:
        scope = session.get(PersonalScope, scope_id)
        if scope is not None:
            identities = session.scalars(
                select(Identity).where(
                    Identity.principal_id == scope.owner_principal_id,
                    Identity.email_verified.is_(True),
                )
            ).all()
            for ident in identities:
                norm = (ident.email or "").strip().lower()
                if norm in emails:
                    return True, plan_id, f"email:{norm}"
    return False, plan_id, ""


def grant_courtesy_plan(
    session: Session,
    scope_id: UUID,
    *,
    plan_id: PlanId = "docente",
    reason: str = "manual_courtesy",
) -> ScopeSubscription:
    """Grant a complimentary Pro/Escuela subscription that requires no payment."""
    now = datetime.now(UTC)
    sub = session.get(ScopeSubscription, scope_id)
    if sub is None:
        sub = ScopeSubscription(
            scope_id=scope_id,
            plan_id=plan_id,
            status="active",
            billing_provider="courtesy_pro",
            current_period_start=now,
            current_period_end=None,
            cancel_at_period_end=False,
            created_at=now,
            updated_at=now,
        )
        session.add(sub)
    else:
        sub.plan_id = plan_id
        sub.status = "active"
        sub.billing_provider = "courtesy_pro"
        sub.cancel_at_period_end = False
        sub.current_period_end = None
        sub.updated_at = now
    idem_key = f"courtesy:{scope_id}:{plan_id}"
    existing_ev = session.scalar(
        select(UsageLedgerEvent).where(UsageLedgerEvent.idempotency_key == idem_key)
    )
    if existing_ev is None:
        session.add(
            UsageLedgerEvent(
                scope_id=scope_id,
                actor_id=None,
                event_type="courtesy_pro_granted",
                metric="plan",
                quantity=1,
                idempotency_key=idem_key,
                metadata_json={"plan_id": plan_id, "reason": reason},
                created_at=now,
            )
        )
    session.flush()
    return sub


def _ensure_subscription(session: Session, scope_id: UUID) -> ScopeSubscription:
    matched, courtesy_plan, match_reason = _scope_matches_courtesy_grant(
        session, scope_id
    )
    sub = session.get(ScopeSubscription, scope_id)
    if matched:
        if (
            sub is None
            or sub.billing_provider != "courtesy_pro"
            or sub.plan_id != courtesy_plan
            or sub.status != "active"
        ):
            return grant_courtesy_plan(
                session, scope_id, plan_id=courtesy_plan, reason=match_reason
            )
        return sub
    if sub is not None:
        return sub
    period_start, period_end = _month_bounds_utc()
    now = datetime.now(UTC)
    sub = ScopeSubscription(
        scope_id=scope_id,
        plan_id="free",
        status="active",
        billing_provider="beta_preview",
        current_period_start=period_start,
        current_period_end=period_end,
        cancel_at_period_end=False,
        created_at=now,
        updated_at=now,
    )
    session.add(sub)
    session.flush()
    return sub


def _meter_entry(used: int | float, limit: int | float | None) -> dict[str, Any]:
    if limit is None:
        return {
            "used": used,
            "limit": None,
            "remaining": None,
            "percent": 0.0,
            "unlimited": True,
            "at_limit": False,
            "near_limit": False,
        }
    pct = 0.0 if limit <= 0 else round(min(100.0, (used / limit) * 100.0), 1)
    remaining = max(
        0, round(limit - used, 4) if isinstance(limit, float) else int(limit - used)
    )
    return {
        "used": used,
        "limit": limit,
        "remaining": remaining,
        "percent": pct,
        "unlimited": False,
        "at_limit": used >= limit,
        "near_limit": pct >= 80.0,
    }


def _ledger_payload(row: UsageLedgerEvent) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "event_type": row.event_type,
        "metric": row.metric,
        "quantity": row.quantity,
        "estimated_usd": round(row.estimated_usd_micros / 1_000_000, 6),
        "metadata": row.metadata_json or {},
        "created_at": row.created_at.astimezone(UTC).isoformat(),
    }


class BillingService:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def list_plans(self, actor: UUID, scope_id: UUID) -> dict[str, Any]:
        with Session(self.engine) as session:
            authorize(session, actor, scope_id)
            sub = _ensure_subscription(session, scope_id)
            session.commit()
            return {
                "active_plan_id": sub.plan_id,
                "stripe_configured": _stripe_enabled(),
                "plans": PLANS_CATALOG,
            }

    def get_summary(self, actor: UUID, scope_id: UUID) -> dict[str, Any]:
        with Session(self.engine) as session:
            authorize(session, actor, scope_id)
            summary = self._build_summary(session, scope_id)
            session.commit()
            return summary

    def _build_summary(self, session: Session, scope_id: UUID) -> dict[str, Any]:
        sub = _ensure_subscription(session, scope_id)
        plan = PLANS_BY_ID.get(sub.plan_id, PLANS_BY_ID["free"])
        month_start, month_end = _month_bounds_utc()

        ai_turns = int(
            session.scalar(
                select(func.count(AgentChatTurn.id)).where(
                    AgentChatTurn.scope_id == scope_id,
                    AgentChatTurn.created_at >= month_start,
                    AgentChatTurn.created_at < month_end,
                )
            )
            or 0
        )
        ai_cost_raw = session.scalar(
            select(func.coalesce(func.sum(AgentChatTurn.estimated_cost_usd), 0)).where(
                AgentChatTurn.scope_id == scope_id,
                AgentChatTurn.created_at >= month_start,
                AgentChatTurn.created_at < month_end,
            )
        )
        ai_spend_usd = round(float(ai_cost_raw or 0.0), 4)

        annexes = int(
            session.scalar(
                select(func.count(Annex.id)).where(
                    Annex.scope_id == scope_id,
                    Annex.created_at >= month_start,
                    Annex.created_at < month_end,
                )
            )
            or 0
        )
        print_jobs = int(
            session.scalar(
                select(func.count(PrintJob.id)).where(
                    PrintJob.scope_id == scope_id,
                    PrintJob.created_at >= month_start,
                    PrintJob.created_at < month_end,
                )
            )
            or 0
        )
        documents = int(
            session.scalar(
                select(func.count(TeacherDocument.id)).where(
                    TeacherDocument.scope_id == scope_id,
                    TeacherDocument.created_at >= month_start,
                    TeacherDocument.created_at < month_end,
                )
            )
            or 0
        )

        ledger_rows = session.scalars(
            select(UsageLedgerEvent)
            .where(UsageLedgerEvent.scope_id == scope_id)
            .order_by(UsageLedgerEvent.created_at.desc())
            .limit(30)
        ).all()

        limits = plan["limits"]
        usage = {
            "ai_turns": _meter_entry(ai_turns, limits["ai_turns"]),
            "annexes": _meter_entry(annexes, limits["annexes"]),
            "print_jobs": _meter_entry(print_jobs, limits["print_jobs"]),
            "documents": _meter_entry(documents, limits["documents"]),
            "ai_budget_usd": _meter_entry(ai_spend_usd, limits["ai_budget_usd"]),
        }
        any_at_limit = any(item["at_limit"] for item in usage.values())
        any_near_limit = any(item["near_limit"] for item in usage.values())

        is_courtesy = sub.billing_provider == "courtesy_pro"
        return {
            "scope_id": str(scope_id),
            "subscription": {
                "plan_id": sub.plan_id,
                "plan_name": plan["name"],
                "price_mxn_monthly": 0 if is_courtesy else plan["price_mxn_monthly"],
                "currency": plan["currency"],
                "status": sub.status,
                "billing_provider": sub.billing_provider,
                "is_courtesy": is_courtesy,
                "cancel_at_period_end": sub.cancel_at_period_end,
                "current_period_start": sub.current_period_start.astimezone(
                    UTC
                ).isoformat(),
                "current_period_end": (
                    sub.current_period_end.astimezone(UTC).isoformat()
                    if sub.current_period_end
                    else None
                    if is_courtesy
                    else month_end.isoformat()
                ),
            },
            "period": {
                "start": month_start.isoformat(),
                "end": month_end.isoformat(),
            },
            "usage": usage,
            "quota_status": (
                "limit_reached"
                if any_at_limit
                else "near_limit"
                if any_near_limit
                else "healthy"
            ),
            "stripe_configured": _stripe_enabled(),
            "ledger": [_ledger_payload(row) for row in ledger_rows],
            "plans": PLANS_CATALOG,
        }

    def start_checkout(
        self, actor: UUID, scope_id: UUID, payload: CheckoutRequest
    ) -> dict[str, Any]:
        if payload.plan_id not in PLANS_BY_ID:
            raise MaterialError(422, "invalid_plan")

        if _stripe_enabled() and not payload.preview_switch and payload.plan_id != "free":
            price_env = f"STRIPE_PRICE_{payload.plan_id.upper()}"
            price_id = os.environ.get(price_env, "").strip()
            secret_key = os.environ.get("STRIPE_SECRET_KEY", "").strip()
            if not price_id or not secret_key:
                raise MaterialError(503, "stripe_price_not_configured")
            success_url = payload.success_url or "https://acenta.app/?billing=success"
            cancel_url = payload.cancel_url or "https://acenta.app/?billing=cancelled"
            form_data = urlencode(
                {
                    "mode": "subscription",
                    "line_items[0][price]": price_id,
                    "line_items[0][quantity]": "1",
                    "success_url": success_url,
                    "cancel_url": cancel_url,
                    "client_reference_id": str(scope_id),
                    "metadata[scope_id]": str(scope_id),
                    "metadata[plan_id]": payload.plan_id,
                }
            ).encode("utf-8")
            req = Request(
                "https://api.stripe.com/v1/checkout/sessions",
                data=form_data,
                headers={
                    "Authorization": f"Bearer {secret_key}",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                method="POST",
            )
            try:
                with urlopen(req, timeout=10.0) as resp:
                    stripe_data = json.loads(resp.read().decode("utf-8"))
            except Exception:
                raise MaterialError(502, "stripe_checkout_failed") from None
            with Session(self.engine) as session:
                authorize(session, actor, scope_id)
                session.add(
                    UsageLedgerEvent(
                        scope_id=scope_id,
                        actor_id=actor,
                        event_type="checkout_started",
                        metric="plan",
                        quantity=1,
                        metadata_json={
                            "target_plan_id": payload.plan_id,
                            "stripe_session_id": stripe_data.get("id", ""),
                        },
                    )
                )
                session.commit()
            return {
                "mode": "stripe_checkout",
                "checkout_url": stripe_data.get("url"),
                "session_id": stripe_data.get("id"),
            }

        if not payload.preview_switch and payload.plan_id != "free":
            raise MaterialError(503, "stripe_not_configured")

        # Safe beta preview plan switch (or downgrade to free)
        now = datetime.now(UTC)
        with Session(self.engine) as session:
            authorize(session, actor, scope_id)
            sub = _ensure_subscription(session, scope_id)
            previous_plan = sub.plan_id
            sub.plan_id = payload.plan_id
            sub.status = "active"
            sub.billing_provider = "beta_preview"
            sub.cancel_at_period_end = False
            sub.current_period_start = now
            sub.current_period_end = now + timedelta(days=30)
            sub.updated_at = now
            session.add(
                UsageLedgerEvent(
                    scope_id=scope_id,
                    actor_id=actor,
                    event_type="plan_changed",
                    metric="plan",
                    quantity=1,
                    metadata_json={
                        "from_plan": previous_plan,
                        "to_plan": payload.plan_id,
                        "mode": "beta_preview",
                    },
                    created_at=now,
                )
            )
            session.flush()
            summary = self._build_summary(session, scope_id)
            session.commit()
            return {"mode": "beta_preview", "summary": summary}

    def open_portal(self, actor: UUID, scope_id: UUID) -> dict[str, Any]:
        if not _stripe_enabled():
            raise MaterialError(503, "stripe_not_configured")
        secret_key = os.environ.get("STRIPE_SECRET_KEY", "").strip()
        with Session(self.engine) as session:
            authorize(session, actor, scope_id)
            sub = _ensure_subscription(session, scope_id)
            customer_id = sub.provider_customer_id
            session.commit()
        if not customer_id:
            raise MaterialError(409, "no_stripe_customer")
        form_data = urlencode(
            {
                "customer": customer_id,
                "return_url": "https://acenta.app/",
            }
        ).encode("utf-8")
        req = Request(
            "https://api.stripe.com/v1/billing_portal/sessions",
            data=form_data,
            headers={
                "Authorization": f"Bearer {secret_key}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            method="POST",
        )
        try:
            with urlopen(req, timeout=10.0) as resp:
                stripe_data = json.loads(resp.read().decode("utf-8"))
        except Exception:
            raise MaterialError(502, "stripe_portal_failed") from None
        return {"portal_url": stripe_data.get("url")}

    def handle_stripe_webhook(
        self, raw_body: bytes, signature_header: str | None
    ) -> dict[str, Any]:
        secret = os.environ.get("STRIPE_WEBHOOK_SECRET", "").strip()
        if not secret:
            raise MaterialError(503, "stripe_webhook_not_configured")
        if not verify_stripe_signature(raw_body, signature_header, secret):
            raise MaterialError(400, "invalid_stripe_signature")
        try:
            event = json.loads(raw_body.decode("utf-8"))
        except Exception:
            raise MaterialError(400, "invalid_json") from None

        event_id = str(event.get("id", "")).strip()
        event_type = str(event.get("type", "")).strip()
        obj = event.get("data", {}).get("object", {})
        if not event_id or not event_type or not isinstance(obj, dict):
            raise MaterialError(400, "invalid_stripe_event")

        metadata = obj.get("metadata") if isinstance(obj.get("metadata"), dict) else {}
        scope_raw = (
            metadata.get("scope_id")
            or obj.get("client_reference_id")
            or ""
        )
        try:
            scope_id = UUID(str(scope_raw))
        except ValueError:
            return {"received": True, "ignored": "missing_scope_id"}

        idem_key = f"stripe:{event_id}"
        now = datetime.now(UTC)

        with Session(self.engine) as session:
            existing = session.scalar(
                select(UsageLedgerEvent).where(
                    UsageLedgerEvent.idempotency_key == idem_key
                )
            )
            if existing is not None:
                return {"received": True, "duplicate": True}

            sub = _ensure_subscription(session, scope_id)
            target_plan = str(metadata.get("plan_id") or sub.plan_id)
            if target_plan not in PLANS_BY_ID:
                target_plan = sub.plan_id

            if event_type == "checkout.session.completed":
                sub.plan_id = target_plan
                sub.status = "active"
                sub.billing_provider = "stripe"
                sub.provider_customer_id = str(obj.get("customer") or "") or sub.provider_customer_id
                sub.provider_subscription_id = (
                    str(obj.get("subscription") or "") or sub.provider_subscription_id
                )
                sub.cancel_at_period_end = False
                sub.updated_at = now
            elif event_type == "customer.subscription.updated":
                sub.plan_id = target_plan
                stripe_status = str(obj.get("status") or "active")
                sub.status = (
                    stripe_status
                    if stripe_status in ("active", "trialing", "past_due", "canceled")
                    else "active"
                )
                sub.billing_provider = "stripe"
                sub.cancel_at_period_end = bool(obj.get("cancel_at_period_end", False))
                sub.updated_at = now
            elif event_type == "customer.subscription.deleted":
                if sub.billing_provider != "courtesy_pro":
                    sub.plan_id = "free"
                    sub.status = "canceled"
                    sub.billing_provider = "stripe"
                    sub.cancel_at_period_end = False
                    sub.updated_at = now

            session.add(
                UsageLedgerEvent(
                    scope_id=scope_id,
                    actor_id=None,
                    event_type="stripe_webhook",
                    metric="plan",
                    quantity=1,
                    idempotency_key=idem_key,
                    metadata_json={
                        "stripe_event_id": event_id,
                        "stripe_event_type": event_type,
                        "plan_id": sub.plan_id,
                        "status": sub.status,
                    },
                    created_at=now,
                )
            )
            session.commit()
            return {
                "received": True,
                "duplicate": False,
                "plan_id": sub.plan_id,
                "status": sub.status,
            }
