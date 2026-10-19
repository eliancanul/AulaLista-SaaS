"""Private manual sections, exact origins and immutable history."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0008_analytic_sections"
down_revision = "0007_guided_planning"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "analytic_section",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "scope_id", sa.Uuid(), sa.ForeignKey("personal_scope.id"), nullable=False
        ),
        sa.Column("current_revision", sa.Integer(), nullable=False),
        sa.UniqueConstraint("id", "scope_id", name="uq_analytic_section_scope"),
        sa.CheckConstraint("current_revision > 0", name="ck_analytic_section_revision"),
    )
    op.create_index(
        "ix_analytic_section_scope_id", "analytic_section", ["scope_id", "id"]
    )
    op.create_table(
        "analytic_section_revision",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("section_id", sa.Uuid(), nullable=False),
        sa.Column("scope_id", sa.Uuid(), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("source_version_id", sa.Uuid(), nullable=True),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("principal.id"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("operation_id", sa.Uuid(), nullable=False),
        sa.Column("request_fingerprint", sa.String(), nullable=False),
        sa.Column("data", postgresql.JSONB(), nullable=False),
        sa.ForeignKeyConstraint(
            ["section_id", "scope_id"],
            ["analytic_section.id", "analytic_section.scope_id"],
            name="fk_analytic_revision_section_scope",
        ),
        sa.ForeignKeyConstraint(
            ["source_version_id", "scope_id"],
            ["source_version.id", "source_version.scope_id"],
            name="fk_analytic_source_scope",
        ),
        sa.UniqueConstraint("id", "scope_id", name="uq_analytic_revision_scope"),
        sa.UniqueConstraint("section_id", "number", name="uq_analytic_revision_number"),
        sa.UniqueConstraint("scope_id", "operation_id", name="uq_analytic_operation"),
        sa.CheckConstraint("number > 0", name="ck_analytic_revision_number"),
        sa.CheckConstraint(
            "request_fingerprint ~ '^[0-9a-f]{64}$'", name="ck_analytic_fingerprint"
        ),
        sa.CheckConstraint(
            "octet_length(data::text) BETWEEN 1 AND 16384", name="ck_analytic_data_size"
        ),
    )
    op.execute("""
        CREATE TRIGGER analytic_section_revision_immutable
        BEFORE UPDATE OR DELETE OR TRUNCATE ON analytic_section_revision
        FOR EACH STATEMENT EXECUTE FUNCTION reject_source_version_mutation()
    """)
    op.add_column(
        "planning_revision", sa.Column("analytic_revision_id", sa.Uuid(), nullable=True)
    )
    op.create_foreign_key(
        "fk_planning_analytic_scope",
        "planning_revision",
        "analytic_section_revision",
        ["analytic_revision_id", "scope_id"],
        ["id", "scope_id"],
    )
    op.execute("""
        CREATE FUNCTION check_planning_analytic_origin() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.origin_revision_id IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM planning_revision origin WHERE origin.id = NEW.origin_revision_id
                  AND origin.analytic_revision_id IS NOT DISTINCT FROM NEW.analytic_revision_id
            ) THEN
                RAISE EXCEPTION 'inconsistent analytic origin' USING ERRCODE = '23514';
            END IF;
            IF NEW.analytic_revision_id IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM analytic_section_revision origin WHERE origin.id = NEW.analytic_revision_id
                  AND origin.source_version_id IS NOT DISTINCT FROM NEW.source_version_id
            ) THEN
                RAISE EXCEPTION 'inconsistent analytic source' USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END; $$;
        CREATE TRIGGER planning_analytic_origin BEFORE INSERT ON planning_revision
        FOR EACH ROW EXECUTE FUNCTION check_planning_analytic_origin()
    """)


def downgrade():
    # Removing exact provenance would silently change retained derived documents.
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM analytic_section) THEN
                RAISE EXCEPTION 'retained analytic history prevents downgrade' USING ERRCODE = '23514';
            END IF;
        END $$
    """)
    op.execute("DROP TRIGGER planning_analytic_origin ON planning_revision")
    op.execute("DROP FUNCTION check_planning_analytic_origin()")
    op.drop_constraint("fk_planning_analytic_scope", "planning_revision")
    op.drop_column("planning_revision", "analytic_revision_id")
    op.drop_table("analytic_section_revision")
    op.drop_index("ix_analytic_section_scope_id", table_name="analytic_section")
    op.drop_table("analytic_section")
