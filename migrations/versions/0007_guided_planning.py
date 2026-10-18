"""Allow source-less guided planning without weakening copy provenance."""

import sqlalchemy as sa
from alembic import op

revision = "0007_guided_planning"
down_revision = "0006_editor_recovery"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("planning_revision", "source_version_id", nullable=True)
    op.create_unique_constraint(
        "uq_planning_revision_scope", "planning_revision", ["id", "scope_id"]
    )
    op.create_foreign_key(
        "fk_planning_origin_scope",
        "planning_revision",
        "planning_revision",
        ["origin_revision_id", "scope_id"],
        ["id", "scope_id"],
    )
    # The existing three-column FK skips comparison when either source is NULL.
    op.execute("""
        CREATE FUNCTION check_planning_origin_source() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.origin_revision_id IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM planning_revision origin
                WHERE origin.id = NEW.origin_revision_id
                  AND origin.source_version_id IS NOT DISTINCT FROM NEW.source_version_id
            ) THEN
                RAISE EXCEPTION 'inconsistent planning origin' USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END; $$;
        CREATE TRIGGER planning_origin_source BEFORE INSERT ON planning_revision
        FOR EACH ROW EXECUTE FUNCTION check_planning_origin_source()
    """)


def downgrade():
    # Fail transactionally if retained source-less history cannot fit the old schema.
    op.alter_column(
        "planning_revision",
        "source_version_id",
        existing_type=sa.Uuid(),
        nullable=False,
    )
    op.execute("DROP TRIGGER planning_origin_source ON planning_revision")
    op.execute("DROP FUNCTION check_planning_origin_source()")
    op.drop_constraint("fk_planning_origin_scope", "planning_revision")
    op.drop_constraint("uq_planning_revision_scope", "planning_revision")
