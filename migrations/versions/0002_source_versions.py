"""Fuentes, versiones inmutables y recibo scoped en la misma fila."""

import sqlalchemy as sa
from alembic import op

revision = "0002_source_versions"
down_revision = "0001_personal_scope"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "source",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("scope_id", sa.Uuid(), nullable=False),
        sa.Column("current_version", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["scope_id"], ["personal_scope.id"]),
        sa.UniqueConstraint("id", "scope_id", name="uq_source_scope"),
        sa.CheckConstraint("current_version > 0", name="ck_source_revision"),
    )
    op.create_table(
        "source_version",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("source_id", sa.Uuid(), nullable=False),
        sa.Column("scope_id", sa.Uuid(), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("content_sha256", sa.String(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("operation_id", sa.Uuid(), nullable=False),
        sa.Column("request_fingerprint", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["actor_id"], ["principal.id"]),
        sa.ForeignKeyConstraint(
            ["source_id", "scope_id"],
            ["source.id", "source.scope_id"],
            name="fk_version_source_scope",
        ),
        sa.UniqueConstraint("source_id", "number", name="uq_source_version_number"),
        sa.UniqueConstraint("scope_id", "operation_id", name="uq_scope_operation"),
        sa.CheckConstraint("number > 0", name="ck_version_number"),
        sa.CheckConstraint(
            "octet_length(content) BETWEEN 1 AND 65536 AND size = octet_length(content)",
            name="ck_version_size",
        ),
        sa.CheckConstraint(
            "content_sha256 = encode(sha256(content), 'hex')", name="ck_version_hash"
        ),
        sa.CheckConstraint(
            "request_fingerprint ~ '^[0-9a-f]{64}$'", name="ck_version_fingerprint"
        ),
    )
    op.execute("""
        CREATE FUNCTION reject_source_version_mutation() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'Source versions are immutable' USING ERRCODE = '23514';
        END;
        $$
    """)
    op.execute("""
        CREATE TRIGGER source_version_immutable
        BEFORE UPDATE OR DELETE OR TRUNCATE ON source_version
        FOR EACH STATEMENT EXECUTE FUNCTION reject_source_version_mutation()
    """)


def downgrade():
    op.drop_table("source_version")
    op.execute("DROP FUNCTION reject_source_version_mutation()")
    op.drop_table("source")
