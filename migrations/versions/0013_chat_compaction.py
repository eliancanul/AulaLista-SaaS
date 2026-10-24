"""Retained automatic summaries and auditable bounded provider steps."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0013_chat_compaction"
down_revision = "0012_chat_context"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("chat_context_revision", sa.Column("summary", JSONB()))
    op.drop_constraint("ck_chat_context_origin", "chat_context_revision")
    op.create_check_constraint(
        "ck_chat_context_origin",
        "chat_context_revision",
        "(revision = 0 AND origin = 'initial' AND through_turn = 0 AND notes = '' AND operation_id IS NULL AND request_fingerprint IS NULL AND summary IS NULL) OR (revision > 0 AND operation_id IS NOT NULL AND request_fingerprint IS NOT NULL AND request_fingerprint ~ '^[0-9a-f]{64}$' AND ((origin = 'reset' AND notes = '' AND summary IS NULL) OR (origin = 'manual' AND notes <> '' AND summary IS NULL) OR (origin = 'summary' AND summary IS NOT NULL AND jsonb_typeof(summary) = 'object' AND summary ?& ARRAY['text','from_turn','steps'] AND octet_length(summary->>'text') BETWEEN 1 AND 4096 AND (summary->>'from_turn')::integer BETWEEN 1 AND through_turn AND (summary->>'steps')::integer BETWEEN 1 AND 8)))",
    )
    op.create_table(
        "chat_compaction_step",
        sa.Column(
            "turn_id", sa.Uuid(), sa.ForeignKey("chat_turn.id"), primary_key=True
        ),
        sa.Column("number", sa.Integer(), primary_key=True),
        sa.Column("payload_sha256", sa.String(), nullable=False),
        sa.Column("sources", JSONB(), nullable=False),
        sa.Column("summary", sa.String(), nullable=False),
        sa.Column("usage", JSONB(), nullable=False),
        sa.CheckConstraint("number BETWEEN 1 AND 8", name="ck_chat_step_number"),
        sa.CheckConstraint(
            "payload_sha256 ~ '^[0-9a-f]{64}$'", name="ck_chat_step_hash"
        ),
        sa.CheckConstraint(
            "octet_length(summary) BETWEEN 1 AND 4096 AND summary ~ '[^[:space:]]'",
            name="ck_chat_step_summary",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(sources) = 'array' AND jsonb_array_length(sources) BETWEEN 1 AND 64 AND octet_length(sources::text) <= 16384",
            name="ck_chat_step_sources",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(usage) = 'object' AND octet_length(usage::text) <= 4096",
            name="ck_chat_step_usage",
        ),
    )
    op.execute("""
        CREATE TRIGGER chat_compaction_retained BEFORE UPDATE OR DELETE ON chat_compaction_step
            FOR EACH ROW EXECUTE FUNCTION guard_chat_retained_row();
        CREATE TRIGGER chat_compaction_no_truncate BEFORE TRUNCATE ON chat_compaction_step
            FOR EACH STATEMENT EXECUTE FUNCTION guard_chat_retained_row();
        CREATE FUNCTION guard_chat_compaction_insert() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM chat_turn t WHERE t.id = NEW.turn_id
                AND t.state = 'generating' AND NEW.number <= (t.configuration->>'summary_steps')::integer
                AND (NEW.number = 1 OR EXISTS (SELECT 1 FROM chat_compaction_step p
                    WHERE p.turn_id = NEW.turn_id AND p.number = NEW.number - 1))) THEN
                RAISE EXCEPTION 'invalid summary step' USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END; $$;
        CREATE TRIGGER chat_compaction_insert BEFORE INSERT ON chat_compaction_step
            FOR EACH ROW EXECUTE FUNCTION guard_chat_compaction_insert();
        CREATE OR REPLACE FUNCTION guard_chat_context_insert() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM chat_conversation c JOIN personal_scope s ON s.id = c.scope_id
                WHERE c.id = NEW.conversation_id AND c.scope_id = NEW.scope_id
                    AND c.context_revision = NEW.revision AND s.owner_principal_id = NEW.actor_id
                    AND (NEW.revision = 0 OR (
                        EXISTS (SELECT 1 FROM chat_context_revision r
                            WHERE r.conversation_id = c.id AND r.revision = NEW.revision - 1
                                AND r.through_turn <= NEW.through_turn AND r.created_at <= NEW.created_at)
                        AND EXISTS (SELECT 1 FROM chat_active_conversation a
                            WHERE a.scope_id = c.scope_id AND a.conversation_id = c.id)
                        AND NOT EXISTS (SELECT 1 FROM chat_turn t WHERE t.conversation_id = c.id
                            AND t.state IN ('generating', 'uncertain'))
                        AND ((NEW.origin <> 'summary' AND c.version = NEW.through_turn)
                        OR (NEW.origin = 'summary' AND c.version = NEW.through_turn + 1
                            AND EXISTS (SELECT 1 FROM chat_turn t
                                JOIN chat_context_revision previous ON previous.conversation_id = c.id
                                    AND previous.revision = NEW.revision - 1
                                WHERE t.conversation_id = c.id AND t.number = c.version
                                    AND t.operation_id = NEW.operation_id AND t.state = 'succeeded'
                                    AND t.context_revision = previous.revision AND NEW.notes = previous.notes
                                    AND NEW.request_fingerprint = t.request_fingerprint
                                    AND (NEW.summary->>'steps')::integer = (t.configuration->>'summary_steps')::integer
                                    AND (NEW.summary->>'from_turn')::integer = previous.through_turn + 1
                                    AND (NEW.summary->>'steps')::integer = (SELECT count(*) FROM chat_compaction_step p WHERE p.turn_id = t.id)
                                    AND NEW.summary->>'text' = (SELECT p.summary FROM chat_compaction_step p WHERE p.turn_id = t.id ORDER BY number DESC LIMIT 1)
                            )))))
            ) THEN
                RAISE EXCEPTION 'invalid chat context revision' USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END; $$;
    """)


def downgrade():
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM chat_compaction_step) OR EXISTS (SELECT 1 FROM chat_context_revision WHERE origin = 'summary') THEN
                RAISE EXCEPTION 'retained summary history prevents downgrade';
            END IF;
        END; $$;
    """)
    op.execute("""
        CREATE OR REPLACE FUNCTION guard_chat_context_insert() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM chat_conversation c JOIN personal_scope s ON s.id = c.scope_id
                WHERE c.id = NEW.conversation_id AND c.scope_id = NEW.scope_id
                    AND c.context_revision = NEW.revision AND s.owner_principal_id = NEW.actor_id
                    AND (NEW.revision = 0 OR (c.version = NEW.through_turn
                        AND EXISTS (SELECT 1 FROM chat_context_revision r
                            WHERE r.conversation_id = c.id AND r.revision = NEW.revision - 1
                                AND r.through_turn <= NEW.through_turn AND r.created_at <= NEW.created_at)
                        AND EXISTS (SELECT 1 FROM chat_active_conversation a
                            WHERE a.scope_id = c.scope_id AND a.conversation_id = c.id)
                        AND NOT EXISTS (SELECT 1 FROM chat_turn t WHERE t.conversation_id = c.id
                            AND t.state IN ('generating', 'uncertain'))))
            ) THEN
                RAISE EXCEPTION 'invalid chat context revision' USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END; $$;
    """)
    op.execute(
        "DROP TRIGGER chat_compaction_insert ON chat_compaction_step; DROP FUNCTION guard_chat_compaction_insert();"
    )
    op.drop_table("chat_compaction_step")
    op.drop_constraint("ck_chat_context_origin", "chat_context_revision")
    op.create_check_constraint(
        "ck_chat_context_origin",
        "chat_context_revision",
        "(revision = 0 AND origin = 'initial' AND through_turn = 0 AND notes = '' AND operation_id IS NULL AND request_fingerprint IS NULL) OR (revision > 0 AND operation_id IS NOT NULL AND request_fingerprint IS NOT NULL AND request_fingerprint ~ '^[0-9a-f]{64}$' AND ((origin = 'reset' AND notes = '') OR (origin = 'manual' AND notes <> '')))",
    )
    op.drop_column("chat_context_revision", "summary")
