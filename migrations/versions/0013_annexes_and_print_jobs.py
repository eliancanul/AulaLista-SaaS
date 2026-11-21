"""Printable annexes, teacher printer settings, and Email Print job queue."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0013_annexes_and_print_jobs"
down_revision = "0012_chat_context"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "annex",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "scope_id",
            sa.Uuid(),
            sa.ForeignKey("personal_scope.id"),
            nullable=False,
        ),
        sa.Column(
            "actor_id",
            sa.Uuid(),
            sa.ForeignKey("principal.id"),
            nullable=False,
        ),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("subject", sa.String(length=120), nullable=False),
        sa.Column("grade", sa.String(length=80), nullable=False),
        sa.Column("topic", sa.String(length=240), nullable=False),
        sa.Column("instructions", sa.Text(), nullable=False),
        sa.Column("content", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "status", sa.String(length=16), nullable=False, server_default="draft"
        ),
        sa.Column("provenance", sa.String(length=32), nullable=False),
        sa.Column("model", sa.String(length=128), nullable=True),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("id", "scope_id", name="uq_annex_scope"),
        sa.CheckConstraint("status IN ('draft', 'approved')", name="ck_annex_status"),
        sa.CheckConstraint(
            "provenance IN ('openai-annex-v1', 'fake-annex-v1', 'manual-annex-v1')",
            name="ck_annex_provenance",
        ),
        sa.CheckConstraint("revision >= 1", name="ck_annex_revision"),
        sa.CheckConstraint(
            "(status = 'approved') = (approved_at IS NOT NULL)",
            name="ck_annex_approved_at",
        ),
    )
    op.create_index("ix_annex_scope_updated", "annex", ["scope_id", "updated_at"])

    op.create_table(
        "teacher_print_settings",
        sa.Column(
            "scope_id",
            sa.Uuid(),
            sa.ForeignKey("personal_scope.id"),
            primary_key=True,
        ),
        sa.Column("printer_email", sa.String(length=320), nullable=True),
        sa.Column("default_copies", sa.Integer(), nullable=False, server_default="25"),
        sa.Column(
            "default_print_time",
            sa.String(length=5),
            nullable=False,
            server_default="06:30",
        ),
        sa.Column(
            "timezone",
            sa.String(length=64),
            nullable=False,
            server_default="America/Mexico_City",
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "default_copies BETWEEN 1 AND 50", name="ck_print_settings_copies"
        ),
        sa.CheckConstraint(
            "default_print_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'",
            name="ck_print_settings_time",
        ),
    )

    op.create_table(
        "print_job",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "scope_id",
            sa.Uuid(),
            sa.ForeignKey("personal_scope.id"),
            nullable=False,
        ),
        sa.Column(
            "actor_id",
            sa.Uuid(),
            sa.ForeignKey("principal.id"),
            nullable=False,
        ),
        sa.Column("annex_id", sa.Uuid(), nullable=True),
        sa.Column("job_kind", sa.String(length=16), nullable=False),
        sa.Column("annex_revision", sa.Integer(), nullable=True),
        sa.Column("annex_title", sa.String(length=200), nullable=False),
        sa.Column("printer_email", sa.String(length=320), nullable=False),
        sa.Column("copies", sa.Integer(), nullable=False),
        sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "status", sa.String(length=16), nullable=False, server_default="pending"
        ),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.String(length=300), nullable=True),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["annex_id", "scope_id"],
            ["annex.id", "annex.scope_id"],
            name="fk_print_job_annex_scope",
        ),
        sa.UniqueConstraint(
            "scope_id", "idempotency_key", name="uq_print_job_idempotency"
        ),
        sa.CheckConstraint(
            "job_kind IN ('annex', 'test_page')", name="ck_print_job_kind"
        ),
        sa.CheckConstraint("copies BETWEEN 1 AND 50", name="ck_print_job_copies"),
        sa.CheckConstraint(
            "status IN ('pending', 'sending', 'sent', 'failed', 'cancelled')",
            name="ck_print_job_status",
        ),
        sa.CheckConstraint("attempts >= 0", name="ck_print_job_attempts"),
        sa.CheckConstraint(
            "(status = 'sent') = (sent_at IS NOT NULL)",
            name="ck_print_job_sent_at",
        ),
    )
    op.create_index("ix_print_job_due", "print_job", ["status", "scheduled_for"])
    op.create_index(
        "ix_print_job_scope_created", "print_job", ["scope_id", "created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_print_job_scope_created", table_name="print_job")
    op.drop_index("ix_print_job_due", table_name="print_job")
    op.drop_table("print_job")
    op.drop_table("teacher_print_settings")
    op.drop_index("ix_annex_scope_updated", table_name="annex")
    op.drop_table("annex")
