"""One retained reservation ledger for every provider operation, across products."""

import hashlib
from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Numeric,
    UniqueConstraint,
    func,
    select,
)
from sqlalchemy.orm import Mapped, mapped_column

from aulalista_api.database import Base

GLOBAL_LOCK = int.from_bytes(
    hashlib.sha256(b"aulalista-openai-generation-global-v1").digest()[:8],
    "big",
    signed=True,
)


class BudgetReservation(Base):
    __tablename__ = "ai_budget_reservation"
    __table_args__ = (
        UniqueConstraint("scope_id", "operation_id", name="uq_ai_budget_operation"),
        CheckConstraint("reserved_usd > 0", name="ck_ai_budget_reserve"),
        CheckConstraint("kind IN ('planning','chat')", name="ck_ai_budget_kind"),
        CheckConstraint(
            "state IN ('counting','generating','succeeded','failed','uncertain')",
            name="ck_ai_budget_state",
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True)
    scope_id: Mapped[UUID] = mapped_column(ForeignKey("personal_scope.id"))
    operation_id: Mapped[UUID]
    kind: Mapped[str]
    state: Mapped[str]
    reserved_usd: Mapped[Decimal] = mapped_column(Numeric(18, 9))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


def reserved_total(session):
    return session.scalar(
        select(func.coalesce(func.sum(BudgetReservation.reserved_usd), 0))
    )


def budget_busy(session):
    return (
        session.scalar(
            select(BudgetReservation.id)
            .where(BudgetReservation.state.in_(("counting", "generating", "uncertain")))
            .limit(1)
        )
        is not None
    )
