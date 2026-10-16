"""Revisiones editadas, origen de copias y borradores privados versionados."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0004_planning_edits"
down_revision = "0003_planning_fixture"
branch_labels = None
depends_on = None


def upgrade():
    op.create_unique_constraint(
        "uq_planning_revision_source",
        "planning_revision",
        ["id", "scope_id", "source_version_id"],
    )
    op.create_unique_constraint(
        "uq_planning_revision_target",
        "planning_revision",
        ["id", "planning_id", "scope_id"],
    )
    op.add_column(
        "planning_revision", sa.Column("origin_revision_id", sa.Uuid(), nullable=True)
    )
    op.create_foreign_key(
        "fk_planning_origin_source",
        "planning_revision",
        "planning_revision",
        ["origin_revision_id", "scope_id", "source_version_id"],
        ["id", "scope_id", "source_version_id"],
    )
    op.drop_constraint("ck_planning_request_size", "planning_revision")
    op.create_check_constraint(
        "ck_planning_request_size",
        "planning_revision",
        "octet_length(request::text) BETWEEN 1 AND 8192",
    )
    op.create_table(
        "planning_draft",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("planning_id", sa.Uuid(), nullable=False),
        sa.Column("scope_id", sa.Uuid(), nullable=False),
        sa.Column("current_revision", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["planning_id", "scope_id"],
            ["planning.id", "planning.scope_id"],
            name="fk_draft_planning_scope",
        ),
        sa.UniqueConstraint("id", "planning_id", "scope_id", name="uq_draft_target"),
        sa.CheckConstraint("current_revision > 0", name="ck_draft_revision"),
    )
    op.create_table(
        "planning_draft_revision",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("draft_id", sa.Uuid(), nullable=False),
        sa.Column("planning_id", sa.Uuid(), nullable=False),
        sa.Column("scope_id", sa.Uuid(), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("base_revision_id", sa.Uuid(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("principal.id"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("operation_id", sa.Uuid(), nullable=False),
        sa.Column("request_fingerprint", sa.String(), nullable=False),
        sa.Column("request", postgresql.JSONB(), nullable=False),
        sa.Column("result", postgresql.JSONB(), nullable=False),
        sa.ForeignKeyConstraint(
            ["draft_id", "planning_id", "scope_id"],
            [
                "planning_draft.id",
                "planning_draft.planning_id",
                "planning_draft.scope_id",
            ],
            name="fk_draft_revision_target",
        ),
        sa.ForeignKeyConstraint(
            ["base_revision_id", "planning_id", "scope_id"],
            [
                "planning_revision.id",
                "planning_revision.planning_id",
                "planning_revision.scope_id",
            ],
            name="fk_draft_base_target",
        ),
        sa.UniqueConstraint("draft_id", "number", name="uq_draft_revision_number"),
        sa.UniqueConstraint("scope_id", "operation_id", name="uq_draft_operation"),
        sa.CheckConstraint("number > 0", name="ck_draft_revision_number"),
        sa.CheckConstraint(
            "request_fingerprint ~ '^[0-9a-f]{64}$'", name="ck_draft_fingerprint"
        ),
        sa.CheckConstraint(
            "octet_length(request::text) BETWEEN 1 AND 8192",
            name="ck_draft_request_size",
        ),
        sa.CheckConstraint(
            "octet_length(result::text) BETWEEN 1 AND 8192", name="ck_draft_result_size"
        ),
    )
    op.execute("""
        CREATE TRIGGER planning_draft_revision_immutable
        BEFORE UPDATE OR DELETE OR TRUNCATE ON planning_draft_revision
        FOR EACH STATEMENT EXECUTE FUNCTION reject_source_version_mutation()
    """)
    op.create_index("ix_planning_scope_id", "planning", ["scope_id", "id"])
    op.create_index("ix_planning_draft_scope_id", "planning_draft", ["scope_id", "id"])


def downgrade():
    op.drop_index("ix_planning_draft_scope_id", table_name="planning_draft")
    op.drop_index("ix_planning_scope_id", table_name="planning")
    op.drop_table("planning_draft_revision")
    op.drop_table("planning_draft")
    op.drop_constraint("fk_planning_origin_source", "planning_revision")
    op.drop_column("planning_revision", "origin_revision_id")
    op.drop_constraint("uq_planning_revision_target", "planning_revision")
    op.drop_constraint("uq_planning_revision_source", "planning_revision")
    op.drop_constraint("ck_planning_request_size", "planning_revision")
    op.create_check_constraint(
        "ck_planning_request_size",
        "planning_revision",
        "octet_length(request::text) BETWEEN 1 AND 4096",
    )
