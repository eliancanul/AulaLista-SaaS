"""Multi-agent teacher chat channels (orchestrator + per-subject isolated agents)."""

import sqlalchemy as sa
from alembic import op

revision = "0015_agent_chat"
down_revision = "0014_school_spaces"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_chat_channel",
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
        sa.Column("channel_key", sa.String(length=180), nullable=False),
        sa.Column("agent_kind", sa.String(length=24), nullable=False),
        sa.Column("school_id", sa.String(length=80), nullable=False),
        sa.Column("school_name", sa.String(length=80), nullable=False),
        sa.Column("grade", sa.String(length=40), nullable=False),
        sa.Column(
            "shift", sa.String(length=40), nullable=False, server_default="Matutino"
        ),
        sa.Column("subject_id", sa.String(length=80), nullable=True),
        sa.Column("subject_name", sa.String(length=80), nullable=True),
        sa.Column("context_notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("through_turn", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("context_revision", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "summary_topic", sa.String(length=160), nullable=False, server_default=""
        ),
        sa.Column("digest", sa.String(length=400), nullable=False, server_default=""),
        sa.Column("version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "scope_id", "channel_key", name="uq_agent_chat_scope_channel"
        ),
        sa.CheckConstraint(
            "agent_kind IN ('orchestrator', 'subject')",
            name="ck_agent_chat_kind",
        ),
        sa.CheckConstraint(
            "version >= 0 AND through_turn >= 0 AND context_revision >= 0",
            name="ck_agent_chat_counters",
        ),
    )
    op.create_index(
        "ix_agent_chat_channel_scope_school",
        "agent_chat_channel",
        ["scope_id", "school_id"],
    )

    op.create_table(
        "agent_chat_turn",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "channel_id",
            sa.Uuid(),
            sa.ForeignKey("agent_chat_channel.id", ondelete="CASCADE"),
            nullable=False,
        ),
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
        sa.Column("operation_id", sa.Uuid(), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("context_revision", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("user_text", sa.Text(), nullable=False),
        sa.Column("assistant_text", sa.Text(), nullable=True),
        sa.Column("state", sa.String(length=24), nullable=False),
        sa.Column("error_code", sa.String(length=120), nullable=True),
        sa.Column("model", sa.String(length=128), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column("estimated_cost_usd", sa.Numeric(18, 9), nullable=True),
        sa.Column("delegated_subject_id", sa.String(length=80), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint(
            "scope_id", "operation_id", name="uq_agent_chat_turn_operation"
        ),
        sa.UniqueConstraint("channel_id", "number", name="uq_agent_chat_turn_number"),
        sa.CheckConstraint(
            "state IN ('generating', 'succeeded', 'failed')",
            name="ck_agent_chat_turn_state",
        ),
        sa.CheckConstraint("number >= 1", name="ck_agent_chat_turn_positive"),
    )
    op.create_index(
        "ix_agent_chat_turn_channel_number",
        "agent_chat_turn",
        ["channel_id", "number"],
    )


def downgrade() -> None:
    op.drop_index("ix_agent_chat_turn_channel_number", table_name="agent_chat_turn")
    op.drop_table("agent_chat_turn")
    op.drop_index("ix_agent_chat_channel_scope_school", table_name="agent_chat_channel")
    op.drop_table("agent_chat_channel")
