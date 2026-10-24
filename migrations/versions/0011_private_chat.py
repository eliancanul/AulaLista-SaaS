"""Private durable chat, sharing the retained global AI reservation ledger."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0011_private_chat"
down_revision = "0010_window_budget"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "chat_conversation",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "scope_id", sa.Uuid(), sa.ForeignKey("personal_scope.id"), nullable=False
        ),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("principal.id"), nullable=False),
        sa.Column("operation_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("id", "scope_id", name="uq_chat_conversation_scope"),
        sa.UniqueConstraint(
            "scope_id", "operation_id", name="uq_chat_create_operation"
        ),
        sa.CheckConstraint(
            "version BETWEEN 0 AND 100", name="ck_chat_conversation_version"
        ),
        sa.CheckConstraint(
            "char_length(title) BETWEEN 1 AND 80 AND octet_length(title) <= 320",
            name="ck_chat_title",
        ),
        sa.CheckConstraint("updated_at >= created_at", name="ck_chat_updated"),
    )
    op.create_table(
        "chat_turn",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column("scope_id", sa.Uuid(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("principal.id"), nullable=False),
        sa.Column("operation_id", sa.Uuid(), nullable=False),
        sa.Column("request_fingerprint", sa.String(), nullable=False),
        sa.Column("payload_sha256", sa.String(), nullable=False),
        sa.Column("profile_fingerprint", sa.String(), nullable=False),
        sa.Column("configuration", JSONB(), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("user_text", sa.String(), nullable=False),
        sa.Column("assistant_text", sa.String()),
        sa.Column("state", sa.String(), nullable=False),
        sa.Column("reserved_usd", sa.Numeric(18, 9), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deadline_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("input_tokens", sa.Integer()),
        sa.Column("output_tokens", sa.Integer()),
        sa.Column("cached_tokens", sa.Integer()),
        sa.Column("cache_write_tokens", sa.Integer()),
        sa.Column("reasoning_tokens", sa.Integer()),
        sa.Column("model", sa.String()),
        sa.Column("service_tier", sa.String()),
        sa.Column("provider_request_id", sa.String()),
        sa.Column("error_code", sa.String()),
        sa.ForeignKeyConstraint(
            ["conversation_id", "scope_id"],
            ["chat_conversation.id", "chat_conversation.scope_id"],
            name="fk_chat_turn_conversation_scope",
        ),
        sa.UniqueConstraint("scope_id", "operation_id", name="uq_chat_turn_operation"),
        sa.UniqueConstraint("conversation_id", "number", name="uq_chat_turn_number"),
        sa.CheckConstraint("number BETWEEN 1 AND 100", name="ck_chat_turn_number"),
        sa.CheckConstraint(
            "char_length(user_text) BETWEEN 1 AND 4096 AND octet_length(user_text) <= 8192 AND user_text ~ '[^[:space:]]'",
            name="ck_chat_user_text",
        ),
        sa.CheckConstraint(
            "assistant_text IS NULL OR (octet_length(assistant_text) BETWEEN 1 AND 32768 AND assistant_text ~ '[^[:space:]]')",
            name="ck_chat_assistant_text",
        ),
        sa.CheckConstraint(
            "request_fingerprint ~ '^[0-9a-f]{64}$' AND payload_sha256 ~ '^[0-9a-f]{64}$' AND profile_fingerprint ~ '^[0-9a-f]{64}$'",
            name="ck_chat_hashes",
        ),
        sa.CheckConstraint(
            "octet_length(configuration::text) BETWEEN 1 AND 16384",
            name="ck_chat_configuration",
        ),
        sa.CheckConstraint("reserved_usd > 0", name="ck_chat_reserve"),
        sa.CheckConstraint(
            "state IN ('generating','succeeded','failed','uncertain')",
            name="ck_chat_state",
        ),
        sa.CheckConstraint(
            "(state = 'succeeded') = (assistant_text IS NOT NULL)",
            name="ck_chat_answer",
        ),
        sa.CheckConstraint(
            "(state = 'generating') = (finished_at IS NULL)", name="ck_chat_terminal"
        ),
        sa.CheckConstraint(
            "(state IN ('failed','uncertain')) = (error_code IS NOT NULL)",
            name="ck_chat_error",
        ),
        sa.CheckConstraint(
            "deadline_at > created_at AND deadline_at <= created_at + interval '75 seconds'",
            name="ck_chat_deadline",
        ),
        *[
            sa.CheckConstraint(
                f"{column} IS NULL OR {column} >= 0", name=f"ck_chat_{column}"
            )
            for column in (
                "input_tokens",
                "output_tokens",
                "cached_tokens",
                "cache_write_tokens",
                "reasoning_tokens",
            )
        ],
    )
    op.create_index("ix_chat_turn_deadline", "chat_turn", ["state", "deadline_at"])
    op.create_index(
        "uq_chat_active_conversation",
        "chat_turn",
        ["conversation_id"],
        unique=True,
        postgresql_where=sa.text("state = 'generating'"),
    )
    op.execute("""
        CREATE TRIGGER chat_ai_budget AFTER INSERT OR UPDATE OF state ON chat_turn
        FOR EACH ROW EXECUTE FUNCTION mirror_ai_budget('chat');
        CREATE FUNCTION guard_chat_conversation() RETURNS trigger LANGUAGE plpgsql AS $$
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
        CREATE TRIGGER chat_conversation_guard BEFORE INSERT OR UPDATE OR DELETE ON chat_conversation
        FOR EACH ROW EXECUTE FUNCTION guard_chat_conversation();

        CREATE FUNCTION check_chat_version() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM chat_conversation c WHERE c.id = NEW.id
                AND c.version <> (SELECT count(*) FROM chat_turn t WHERE t.conversation_id = c.id)
            ) THEN
                RAISE EXCEPTION 'chat version requires an admitted turn' USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END; $$;
        CREATE CONSTRAINT TRIGGER chat_version_history AFTER INSERT OR UPDATE ON chat_conversation
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_chat_version();

        CREATE FUNCTION guard_chat_turn() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE
            receipts text[] := ARRAY['input_tokens','output_tokens','cached_tokens',
                'cache_write_tokens','reasoning_tokens','model','service_tier','provider_request_id'];
            mutable text[] := receipts || ARRAY['state','assistant_text','finished_at','error_code'];
            field_name text;
        BEGIN
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'chat history is retained' USING ERRCODE = '23514';
            ELSIF TG_OP = 'INSERT' THEN
                IF NEW.state <> 'generating' OR NOT EXISTS (
                    SELECT 1 FROM chat_conversation c JOIN personal_scope s ON s.id = c.scope_id
                    WHERE c.id = NEW.conversation_id AND c.scope_id = NEW.scope_id
                    AND c.version = NEW.number AND s.owner_principal_id = NEW.actor_id
                ) THEN
                    RAISE EXCEPTION 'invalid chat admission' USING ERRCODE = '23514';
                END IF;
                RETURN NEW;
            END IF;
            IF OLD.state = 'uncertain' AND (to_jsonb(NEW) - receipts) = (to_jsonb(OLD) - receipts) THEN
                FOREACH field_name IN ARRAY receipts LOOP
                    IF to_jsonb(OLD)->field_name <> 'null'::jsonb
                       AND to_jsonb(NEW)->field_name IS DISTINCT FROM to_jsonb(OLD)->field_name THEN
                        RAISE EXCEPTION 'invalid chat accounting change' USING ERRCODE = '23514';
                    END IF;
                END LOOP;
                RETURN NEW;
            END IF;
            IF OLD.state <> 'generating' OR NEW.state NOT IN ('succeeded','failed','uncertain')
               OR (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
                RAISE EXCEPTION 'invalid chat transition' USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END; $$;
        CREATE TRIGGER chat_turn_guard BEFORE INSERT OR UPDATE OR DELETE ON chat_turn
        FOR EACH ROW EXECUTE FUNCTION guard_chat_turn();
    """)


def downgrade():
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM chat_conversation) OR EXISTS (SELECT 1 FROM chat_turn) THEN
                RAISE EXCEPTION 'retained chat history prevents downgrade';
            END IF;
        END; $$;
        DROP TRIGGER chat_turn_guard ON chat_turn;
        DROP TRIGGER chat_conversation_guard ON chat_conversation;
        DROP TRIGGER chat_version_history ON chat_conversation;
        DROP TRIGGER chat_ai_budget ON chat_turn;
        DROP FUNCTION guard_chat_turn();
        DROP FUNCTION guard_chat_conversation();
        DROP FUNCTION check_chat_version();
    """)
    op.drop_table("chat_turn")
    op.drop_table("chat_conversation")
