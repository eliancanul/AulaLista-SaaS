"""Add subscription plans and usage ledger tables for transparent quotas and Stripe-ready billing.

Revision ID: 0019_plans_and_billing
Revises: 0018_secure_documents
Create Date: 2026-11-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0019_plans_and_billing"
down_revision: str | None = "0018_secure_documents"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "scope_subscription",
        sa.Column(
            "scope_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("personal_scope.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "plan_id", sa.String(length=32), nullable=False, server_default="free"
        ),
        sa.Column(
            "status", sa.String(length=32), nullable=False, server_default="active"
        ),
        sa.Column(
            "billing_provider",
            sa.String(length=32),
            nullable=False,
            server_default="beta_preview",
        ),
        sa.Column("provider_customer_id", sa.String(length=120), nullable=True),
        sa.Column("provider_subscription_id", sa.String(length=120), nullable=True),
        sa.Column(
            "current_period_start",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "cancel_at_period_end",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "plan_id IN ('free', 'docente', 'escuela')",
            name="ck_scope_subscription_plan_id",
        ),
        sa.CheckConstraint(
            "status IN ('active', 'trialing', 'past_due', 'canceled')",
            name="ck_scope_subscription_status",
        ),
    )

    op.create_table(
        "usage_ledger_event",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "scope_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("personal_scope.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "actor_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("principal.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("metric", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "estimated_usd_micros", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column("idempotency_key", sa.String(length=160), nullable=True),
        sa.Column(
            "metadata_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("idempotency_key", name="uq_usage_ledger_idempotency_key"),
    )
    op.create_index(
        "ix_usage_ledger_event_scope_created",
        "usage_ledger_event",
        ["scope_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_usage_ledger_event_scope_created", table_name="usage_ledger_event"
    )
    op.drop_table("usage_ledger_event")
    op.drop_table("scope_subscription")
