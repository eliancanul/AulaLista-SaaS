"""Add teacher_document, document_blob, and document_revocation_tombstone tables."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0018_secure_documents"
down_revision = "0017_curriculum_and_revisions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "teacher_document",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "scope_id",
            sa.Uuid(),
            sa.ForeignKey("personal_scope.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "actor_id",
            sa.Uuid(),
            sa.ForeignKey("principal.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("filename", sa.String(length=180), nullable=False),
        sa.Column("detected_mime", sa.String(length=120), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("extracted_text", sa.Text(), nullable=True),
        sa.Column("page_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ocr_engine", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("error_code", sa.String(length=120), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'ready', 'failed', 'revoked')",
            name="ck_teacher_document_status",
        ),
    )
    op.create_index(
        "ix_teacher_document_scope_created",
        "teacher_document",
        ["scope_id", "created_at"],
    )

    op.create_table(
        "document_blob",
        sa.Column(
            "document_id",
            sa.Uuid(),
            sa.ForeignKey("teacher_document.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "scope_id",
            sa.Uuid(),
            sa.ForeignKey("personal_scope.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    op.create_table(
        "document_revocation_tombstone",
        sa.Column("document_id", sa.Uuid(), primary_key=True),
        sa.Column(
            "scope_id",
            sa.Uuid(),
            sa.ForeignKey("personal_scope.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("reason", sa.String(length=120), nullable=False, server_default="teacher_revoked"),
        sa.Column(
            "revoked_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_document_revocation_tombstone_scope",
        "document_revocation_tombstone",
        ["scope_id", "revoked_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_document_revocation_tombstone_scope",
        table_name="document_revocation_tombstone",
    )
    op.drop_table("document_revocation_tombstone")
    op.drop_table("document_blob")
    op.drop_index("ix_teacher_document_scope_created", table_name="teacher_document")
    op.drop_table("teacher_document")
