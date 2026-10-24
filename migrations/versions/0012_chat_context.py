"""One retained active chat per scope, immutable context and opening receipts."""

import sqlalchemy as sa
from alembic import op

revision = "0012_chat_context"
down_revision = "0011_private_chat"
branch_labels = None
depends_on = None


def upgrade():
    # Schema migration holds the tables against admission while backfilling.
    op.execute("LOCK TABLE chat_conversation, chat_turn IN ACCESS EXCLUSIVE MODE")
    op.add_column(
        "chat_conversation",
        sa.Column("context_revision", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "chat_turn",
        sa.Column("context_revision", sa.Integer(), nullable=False, server_default="0"),
    )
    op.drop_constraint("ck_chat_conversation_version", "chat_conversation")
    op.create_check_constraint(
        "ck_chat_conversation_version",
        "chat_conversation",
        "version >= 0 AND context_revision >= 0",
    )
    op.drop_constraint("ck_chat_turn_number", "chat_turn")
    op.create_check_constraint("ck_chat_turn_number", "chat_turn", "number >= 1")
    for table, extra in (
        ("chat_active_conversation", []),
        (
            "chat_open_operation",
            [sa.Column("operation_id", sa.Uuid(), primary_key=True)],
        ),
    ):
        op.create_table(
            table,
            sa.Column("scope_id", sa.Uuid(), primary_key=True),
            sa.Column("conversation_id", sa.Uuid(), nullable=False),
            *extra,
            sa.ForeignKeyConstraint(
                ["conversation_id", "scope_id"],
                ["chat_conversation.id", "chat_conversation.scope_id"],
            ),
        )
    op.create_table(
        "chat_context_revision",
        sa.Column("conversation_id", sa.Uuid(), primary_key=True),
        sa.Column("revision", sa.Integer(), primary_key=True),
        sa.Column("scope_id", sa.Uuid(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("principal.id"), nullable=False),
        sa.Column("operation_id", sa.Uuid()),
        sa.Column("request_fingerprint", sa.String()),
        sa.Column("through_turn", sa.Integer(), nullable=False),
        sa.Column("notes", sa.String(), nullable=False),
        sa.Column("origin", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["conversation_id", "scope_id"],
            ["chat_conversation.id", "chat_conversation.scope_id"],
        ),
        sa.UniqueConstraint(
            "scope_id", "operation_id", name="uq_chat_context_operation"
        ),
        sa.CheckConstraint(
            "revision >= 0 AND through_turn >= 0", name="ck_chat_context_numbers"
        ),
        sa.CheckConstraint(
            "char_length(notes) <= 4096 AND octet_length(notes) <= 8192 AND (notes = '' OR notes ~ '[^[:space:]]')",
            name="ck_chat_context_notes",
        ),
        sa.CheckConstraint(
            "(revision = 0 AND origin = 'initial' AND through_turn = 0 AND notes = '' AND operation_id IS NULL AND request_fingerprint IS NULL) OR (revision > 0 AND operation_id IS NOT NULL AND request_fingerprint IS NOT NULL AND request_fingerprint ~ '^[0-9a-f]{64}$' AND ((origin = 'reset' AND notes = '') OR (origin = 'manual' AND notes <> '')))",
            name="ck_chat_context_origin",
        ),
    )
    op.execute("""
        INSERT INTO chat_active_conversation(scope_id, conversation_id)
        SELECT DISTINCT ON (scope_id) scope_id, id FROM chat_conversation
        ORDER BY scope_id, updated_at DESC, id DESC;
        INSERT INTO chat_open_operation(scope_id, operation_id, conversation_id)
        SELECT scope_id, operation_id, id FROM chat_conversation;
        INSERT INTO chat_context_revision(conversation_id, revision, scope_id, actor_id,
            through_turn, notes, origin, created_at)
        SELECT id, 0, scope_id, actor_id, 0, '', 'initial', created_at FROM chat_conversation;
    """)
    op.create_foreign_key(
        "fk_chat_turn_context",
        "chat_turn",
        "chat_context_revision",
        ["conversation_id", "context_revision"],
        ["conversation_id", "revision"],
    )
    op.execute("""
        CREATE FUNCTION guard_chat_retained_row() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'chat history is retained' USING ERRCODE = '23514';
        END; $$;
        CREATE TRIGGER chat_active_retained BEFORE UPDATE OR DELETE ON chat_active_conversation
            FOR EACH ROW EXECUTE FUNCTION guard_chat_retained_row();
        CREATE TRIGGER chat_open_retained BEFORE UPDATE OR DELETE ON chat_open_operation
            FOR EACH ROW EXECUTE FUNCTION guard_chat_retained_row();
        CREATE TRIGGER chat_context_retained BEFORE UPDATE OR DELETE ON chat_context_revision
            FOR EACH ROW EXECUTE FUNCTION guard_chat_retained_row();

        CREATE OR REPLACE FUNCTION guard_chat_conversation() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'chat history is retained' USING ERRCODE = '23514';
            ELSIF TG_OP = 'INSERT' THEN
                IF NEW.version <> 0 OR NEW.context_revision <> 0 OR NOT EXISTS (
                    SELECT 1 FROM personal_scope WHERE id = NEW.scope_id
                    AND owner_principal_id = NEW.actor_id
                ) THEN
                    RAISE EXCEPTION 'invalid initial chat version' USING ERRCODE = '23514';
                END IF;
            ELSIF (to_jsonb(NEW) - ARRAY['title','version','context_revision','updated_at']) IS DISTINCT FROM
                  (to_jsonb(OLD) - ARRAY['title','version','context_revision','updated_at'])
               OR NOT ((NEW.version = OLD.version + 1 AND NEW.context_revision = OLD.context_revision)
                    OR (NEW.version = OLD.version AND NEW.context_revision = OLD.context_revision + 1))
               OR NEW.updated_at < OLD.updated_at
               OR (NEW.title IS DISTINCT FROM OLD.title AND NOT (OLD.version = 0 AND NEW.version = 1)) THEN
                RAISE EXCEPTION 'invalid chat version change' USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END; $$;

        CREATE OR REPLACE FUNCTION check_chat_version() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM chat_conversation c WHERE c.id = NEW.id AND (
                    c.version <> COALESCE((SELECT max(t.number) FROM chat_turn t WHERE t.conversation_id = c.id), 0)
                    OR c.context_revision IS DISTINCT FROM
                        (SELECT max(r.revision) FROM chat_context_revision r WHERE r.conversation_id = c.id)
                )
            ) THEN
                RAISE EXCEPTION 'chat header requires retained history' USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END; $$;

        CREATE FUNCTION guard_chat_context_insert() RETURNS trigger LANGUAGE plpgsql AS $$
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
        CREATE TRIGGER chat_context_insert BEFORE INSERT ON chat_context_revision
            FOR EACH ROW EXECUTE FUNCTION guard_chat_context_insert();

        CREATE FUNCTION guard_chat_turn_context() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM chat_conversation c
                JOIN chat_active_conversation a ON a.conversation_id = c.id AND a.scope_id = c.scope_id
                WHERE c.id = NEW.conversation_id AND c.context_revision = NEW.context_revision)
                OR (NEW.number > 1 AND NOT EXISTS (
                    SELECT 1 FROM chat_turn t WHERE t.conversation_id = NEW.conversation_id
                        AND t.number = NEW.number - 1))
            THEN
                RAISE EXCEPTION 'inactive chat context' USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END; $$;
        CREATE TRIGGER chat_turn_context BEFORE INSERT ON chat_turn
            FOR EACH ROW EXECUTE FUNCTION guard_chat_turn_context();
    """)


def downgrade():
    # Rolling back would lose active selection and immutable context receipts.
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM chat_conversation) THEN
                RAISE EXCEPTION 'retained chat history prevents downgrade';
            END IF;
        END; $$;
        DROP TRIGGER chat_turn_context ON chat_turn;
        DROP FUNCTION guard_chat_turn_context();
        DROP TRIGGER chat_context_insert ON chat_context_revision;
        DROP FUNCTION guard_chat_context_insert();
        DROP TRIGGER chat_context_retained ON chat_context_revision;
        DROP TRIGGER chat_open_retained ON chat_open_operation;
        DROP TRIGGER chat_active_retained ON chat_active_conversation;
        DROP FUNCTION guard_chat_retained_row();
    """)
    op.drop_constraint("fk_chat_turn_context", "chat_turn")
    op.drop_table("chat_context_revision")
    op.drop_table("chat_open_operation")
    op.drop_table("chat_active_conversation")
    op.drop_constraint("ck_chat_conversation_version", "chat_conversation")
    op.drop_column("chat_turn", "context_revision")
    op.drop_column("chat_conversation", "context_revision")
    op.create_check_constraint(
        "ck_chat_conversation_version", "chat_conversation", "version BETWEEN 0 AND 100"
    )
    op.drop_constraint("ck_chat_turn_number", "chat_turn")
    op.create_check_constraint(
        "ck_chat_turn_number", "chat_turn", "number BETWEEN 1 AND 100"
    )
    op.execute("""
        CREATE OR REPLACE FUNCTION guard_chat_conversation() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'chat history is retained' USING ERRCODE = '23514';
            ELSIF TG_OP = 'INSERT' THEN
                IF NEW.version <> 0 OR NOT EXISTS (
                    SELECT 1 FROM personal_scope WHERE id = NEW.scope_id
                    AND owner_principal_id = NEW.actor_id
                ) THEN
                    RAISE EXCEPTION 'invalid initial chat version' USING ERRCODE = '23514';
                END IF;
            ELSIF (to_jsonb(NEW) - ARRAY['title','version','updated_at']) IS DISTINCT FROM
                  (to_jsonb(OLD) - ARRAY['title','version','updated_at'])
               OR NEW.version <> OLD.version + 1 OR NEW.updated_at < OLD.updated_at
               OR (OLD.version <> 0 AND NEW.title IS DISTINCT FROM OLD.title) THEN
                RAISE EXCEPTION 'invalid chat version change' USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END; $$;
        CREATE OR REPLACE FUNCTION check_chat_version() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM chat_conversation c WHERE c.id = NEW.id
                AND c.version <> (SELECT count(*) FROM chat_turn t WHERE t.conversation_id = c.id)
            ) THEN
                RAISE EXCEPTION 'chat version requires an admitted turn' USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END; $$;
    """)
