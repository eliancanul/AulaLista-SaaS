"""Persisted school and subject workspace organizer per teacher scope."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0014_school_spaces"
down_revision = "0013_annexes_and_print_jobs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "teacher_school_spaces",
        sa.Column(
            "scope_id",
            sa.Uuid(),
            sa.ForeignKey("personal_scope.id"),
            primary_key=True,
        ),
        sa.Column(
            "payload",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )


def downgrade() -> None:
    op.drop_table("teacher_school_spaces")
