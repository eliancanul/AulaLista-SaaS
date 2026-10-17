"""Planeaciones y revisiones fixture independientes de fuentes T2."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0003_planning_fixture"
down_revision = "0002_source_versions"
branch_labels = None
depends_on = None


def upgrade():
    op.create_unique_constraint(
        "uq_source_version_scope", "source_version", ["id", "scope_id"]
    )
    op.create_table(
        "planning",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "scope_id", sa.Uuid(), sa.ForeignKey("personal_scope.id"), nullable=False
        ),
        sa.Column("current_revision", sa.Integer(), nullable=False),
        sa.UniqueConstraint("id", "scope_id", name="uq_planning_scope"),
        sa.CheckConstraint("current_revision > 0", name="ck_planning_revision"),
    )
    op.create_table(
        "planning_revision",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("planning_id", sa.Uuid(), nullable=False),
        sa.Column("scope_id", sa.Uuid(), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("source_version_id", sa.Uuid(), nullable=False),
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
            ["planning_id", "scope_id"],
            ["planning.id", "planning.scope_id"],
            name="fk_revision_planning_scope",
        ),
        sa.ForeignKeyConstraint(
            ["source_version_id", "scope_id"],
            ["source_version.id", "source_version.scope_id"],
            name="fk_planning_source_scope",
        ),
        sa.UniqueConstraint(
            "planning_id", "number", name="uq_planning_revision_number"
        ),
        sa.UniqueConstraint("scope_id", "operation_id", name="uq_planning_operation"),
        sa.CheckConstraint("number > 0", name="ck_planning_revision_number"),
        sa.CheckConstraint(
            "request_fingerprint ~ '^[0-9a-f]{64}$'", name="ck_planning_fingerprint"
        ),
        sa.CheckConstraint(
            "octet_length(request::text) BETWEEN 1 AND 4096",
            name="ck_planning_request_size",
        ),
        sa.CheckConstraint(
            "octet_length(result::text) BETWEEN 1 AND 8192",
            name="ck_planning_result_size",
        ),
    )
    op.execute("""
        CREATE TRIGGER planning_revision_immutable
        BEFORE UPDATE OR DELETE OR TRUNCATE ON planning_revision
        FOR EACH STATEMENT EXECUTE FUNCTION reject_source_version_mutation()
    """)


def downgrade():
    op.drop_table("planning_revision")
    op.drop_table("planning")
    op.drop_constraint("uq_source_version_scope", "source_version")
