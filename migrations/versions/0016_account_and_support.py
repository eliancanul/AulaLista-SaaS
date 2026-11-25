"""Add principal account preferences, link challenges, and support debug backlog."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0016_account_and_support"
down_revision = "0015_agent_chat"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "principal_account_preferences",
        sa.Column(
            "principal_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("principal.id"),
            primary_key=True,
        ),
        sa.Column(
            "promotional_consent",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "promotional_consent_updated_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "consent_history",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    op.create_table(
        "account_link_challenge",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "principal_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("principal.id"),
            nullable=False,
        ),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("code_mac", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "consumed",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint("attempts BETWEEN 0 AND 5", name="ck_account_link_attempts"),
    )
    op.create_index(
        "ix_account_link_principal",
        "account_link_challenge",
        ["principal_id", "created_at"],
    )

    op.create_table(
        "support_ticket",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "scope_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("personal_scope.id"),
            nullable=False,
        ),
        sa.Column(
            "actor_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("principal.id"),
            nullable=False,
        ),
        sa.Column("category", sa.String(length=32), nullable=False),
        sa.Column("severity", sa.String(length=16), nullable=False),
        sa.Column(
            "status", sa.String(length=16), nullable=False, server_default="open"
        ),
        sa.Column("summary", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("view_name", sa.String(length=64), nullable=True),
        sa.Column("route_url", sa.String(length=512), nullable=True),
        sa.Column("screenshot_png", sa.LargeBinary(), nullable=True),
        sa.Column("screenshot_mime", sa.String(length=32), nullable=True),
        sa.Column("screenshot_sha256", sa.String(length=64), nullable=True),
        sa.Column("screenshot_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "debug_bundle",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "server_diagnostics",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("triage_notes", sa.Text(), nullable=False, server_default=""),
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
        sa.CheckConstraint(
            "category IN ('bug', 'ui', 'impresion', 'ia', 'cuenta', 'sugerencia')",
            name="ck_support_ticket_category",
        ),
        sa.CheckConstraint(
            "severity IN ('low', 'medium', 'high', 'critical')",
            name="ck_support_ticket_severity",
        ),
        sa.CheckConstraint(
            "status IN ('open', 'investigating', 'resolved', 'wontfix')",
            name="ck_support_ticket_status",
        ),
        sa.CheckConstraint(
            "screenshot_bytes >= 0",
            name="ck_support_ticket_screenshot_bytes",
        ),
    )
    op.create_index(
        "ix_support_ticket_scope_created",
        "support_ticket",
        ["scope_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_support_ticket_scope_created", table_name="support_ticket")
    op.drop_table("support_ticket")
    op.drop_index("ix_account_link_principal", table_name="account_link_challenge")
    op.drop_table("account_link_challenge")
    op.drop_table("principal_account_preferences")
