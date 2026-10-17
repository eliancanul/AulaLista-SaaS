"""Identidades independientes, sesiones revocables y OTP de consumo único."""

import sqlalchemy as sa
from alembic import op

revision = "0005_auth"
down_revision = "0004_planning_edits"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "auth_identity",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("issuer", sa.String(100), nullable=False),
        sa.Column("subject", sa.String(320), nullable=False),
        sa.Column(
            "principal_id", sa.Uuid(), sa.ForeignKey("principal.id"), nullable=False
        ),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("email_verified", sa.Boolean(), nullable=False),
        sa.UniqueConstraint("issuer", "subject", name="uq_auth_identity"),
    )
    op.create_table(
        "auth_pre_session",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed", sa.Boolean(), nullable=False),
    )
    op.create_table(
        "auth_session",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column(
            "principal_id", sa.Uuid(), sa.ForeignKey("principal.id"), nullable=False
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("idle_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked", sa.Boolean(), nullable=False),
    )
    op.create_index("ix_auth_session_principal_id", "auth_session", ["principal_id"])
    op.create_table(
        "auth_email_challenge",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "pre_hash",
            sa.String(64),
            sa.ForeignKey("auth_pre_session.token_hash"),
            nullable=False,
        ),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("code_mac", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("consumed", sa.Boolean(), nullable=False),
        sa.CheckConstraint("attempts BETWEEN 0 AND 5", name="ck_auth_attempts"),
    )
    op.create_index("ix_auth_email_challenge_email", "auth_email_challenge", ["email"])
    op.create_table(
        "auth_rate",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("bucket", sa.Integer(), primary_key=True),
        sa.Column("count", sa.Integer(), nullable=False),
    )


def downgrade():
    for table in (
        "auth_rate",
        "auth_email_challenge",
        "auth_session",
        "auth_pre_session",
        "auth_identity",
    ):
        op.drop_table(table)
