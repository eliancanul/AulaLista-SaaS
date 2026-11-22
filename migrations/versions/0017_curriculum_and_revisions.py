"""Add traceable SEP/NEM curricular profiles and immutable annex revision history."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0017_curriculum_and_revisions"
down_revision = "0016_account_and_support"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "curricular_profile",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "scope_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("personal_scope.id"),
            nullable=False,
        ),
        sa.Column("school_id", sa.String(length=80), nullable=False),
        sa.Column("subject_id", sa.String(length=80), nullable=False),
        sa.Column("grade", sa.String(length=60), nullable=False, server_default=""),
        sa.Column("phase", sa.String(length=32), nullable=False, server_default=""),
        sa.Column(
            "campo_formativo", sa.String(length=100), nullable=False, server_default=""
        ),
        sa.Column(
            "pdas",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "ejes_articuladores",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "scope_id",
            "school_id",
            "subject_id",
            name="uq_curricular_profile_scope_school_subject",
        ),
    )
    op.create_index(
        "ix_curricular_profile_scope",
        "curricular_profile",
        ["scope_id", "school_id"],
    )

    op.create_table(
        "annex_revision",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "annex_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("annex.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "scope_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("personal_scope.id"),
            nullable=False,
        ),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("subject", sa.String(length=120), nullable=False),
        sa.Column("grade", sa.String(length=80), nullable=False),
        sa.Column("topic", sa.String(length=240), nullable=False),
        sa.Column("instructions", sa.Text(), nullable=False),
        sa.Column(
            "content",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column(
            "change_summary", sa.String(length=240), nullable=False, server_default=""
        ),
        sa.Column(
            "curricular_trace",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("annex_id", "revision", name="uq_annex_revision_number"),
        sa.CheckConstraint("revision >= 1", name="ck_annex_revision_positive"),
    )
    op.create_index(
        "ix_annex_revision_annex_rev",
        "annex_revision",
        ["annex_id", "revision"],
    )


def downgrade() -> None:
    op.drop_index("ix_annex_revision_annex_rev", table_name="annex_revision")
    op.drop_table("annex_revision")
    op.drop_index("ix_curricular_profile_scope", table_name="curricular_profile")
    op.drop_table("curricular_profile")
