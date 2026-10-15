"""Identidad interna sin credenciales y ámbito personal de un propietario."""

import sqlalchemy as sa
from alembic import op

revision = "0001_personal_scope"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "principal",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "personal_scope",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_principal_id", sa.Uuid(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["owner_principal_id"], ["principal.id"], name="fk_personal_scope_owner"
        ),
        sa.UniqueConstraint("owner_principal_id", name="uq_personal_scope_owner"),
    )


def downgrade():
    op.drop_table("personal_scope")
    op.drop_table("principal")
