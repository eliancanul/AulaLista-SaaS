"""Non-secret, nullable session discriminator. No content, backfill or new grant."""

import sqlalchemy as sa
from alembic import op

revision = "0006_editor_recovery"
down_revision = "0005_auth"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "auth_session", sa.Column("recovery_context_id", sa.Uuid(), nullable=True)
    )


def downgrade():
    op.drop_column("auth_session", "recovery_context_id")
