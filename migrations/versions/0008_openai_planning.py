"""Durable one-attempt admission; no runtime activation or credential access."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0008_openai_planning"
down_revision = "0007_guided_planning"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "planning_generation_attempt",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "scope_id", sa.Uuid(), sa.ForeignKey("personal_scope.id"), nullable=False
        ),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("principal.id"), nullable=False),
        sa.Column("operation_id", sa.Uuid(), nullable=False),
        sa.Column("request_fingerprint", sa.String(), nullable=False),
        sa.Column("request", JSONB(), nullable=False),
        sa.Column("configuration", JSONB(), nullable=False),
        sa.Column("payload_sha256", sa.String(), nullable=False),
        sa.Column("profile_fingerprint", sa.String(), nullable=False),
        sa.Column("state", sa.String(), nullable=False),
        sa.Column("reserved_usd", sa.Numeric(18, 9), nullable=False),
        sa.Column("count_requests", sa.Integer(), nullable=False),
        sa.Column("generation_requests", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deadline_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("counted_input_tokens", sa.Integer()),
        sa.Column("input_tokens", sa.Integer()),
        sa.Column("output_tokens", sa.Integer()),
        sa.Column("cached_tokens", sa.Integer()),
        sa.Column("cache_write_tokens", sa.Integer()),
        sa.Column("reasoning_tokens", sa.Integer()),
        sa.Column("model", sa.String()),
        sa.Column("service_tier", sa.String()),
        sa.Column("provider_request_id", sa.String()),
        sa.Column("error_code", sa.String()),
        sa.Column("planning_revision_id", sa.Uuid()),
        sa.UniqueConstraint("scope_id", "operation_id", name="uq_generation_operation"),
        sa.ForeignKeyConstraint(
            ["planning_revision_id", "scope_id"],
            ["planning_revision.id", "planning_revision.scope_id"],
            name="fk_generation_revision_scope",
        ),
        sa.CheckConstraint(
            "request_fingerprint ~ '^[0-9a-f]{64}$'", name="ck_generation_request_hash"
        ),
        sa.CheckConstraint(
            "payload_sha256 ~ '^[0-9a-f]{64}$'", name="ck_generation_payload_hash"
        ),
        sa.CheckConstraint(
            "profile_fingerprint ~ '^[0-9a-f]{64}$'", name="ck_generation_profile_hash"
        ),
        sa.CheckConstraint(
            "octet_length(request::text) BETWEEN 1 AND 8192",
            name="ck_generation_request_size",
        ),
        sa.CheckConstraint(
            "octet_length(configuration::text) BETWEEN 1 AND 16384",
            name="ck_generation_configuration_size",
        ),
        sa.CheckConstraint("reserved_usd > 0", name="ck_generation_reserve"),
        sa.CheckConstraint(
            "count_requests = 1 AND generation_requests BETWEEN 0 AND 1",
            name="ck_generation_calls",
        ),
        sa.CheckConstraint(
            "state IN ('counting', 'generating', 'succeeded', 'failed', 'uncertain')",
            name="ck_generation_state",
        ),
        sa.CheckConstraint(
            "(state IN ('counting', 'generating')) = (finished_at IS NULL)",
            name="ck_generation_terminal",
        ),
        sa.CheckConstraint(
            "(state = 'succeeded') = (planning_revision_id IS NOT NULL)",
            name="ck_generation_receipt",
        ),
        sa.CheckConstraint(
            "state NOT IN ('generating','succeeded') OR "
            "(generation_requests = 1 AND counted_input_tokens IS NOT NULL "
            "AND counted_input_tokens BETWEEN 1 AND 2048)",
            name="ck_generation_dispatch",
        ),
        sa.CheckConstraint(
            "counted_input_tokens IS NULL OR counted_input_tokens >= 0",
            name="ck_generation_count_tokens",
        ),
        sa.CheckConstraint(
            "input_tokens IS NULL OR input_tokens >= 0",
            name="ck_generation_input_tokens",
        ),
        sa.CheckConstraint(
            "output_tokens IS NULL OR output_tokens >= 0",
            name="ck_generation_output_tokens",
        ),
        sa.CheckConstraint(
            "cached_tokens IS NULL OR cached_tokens >= 0",
            name="ck_generation_cached_tokens",
        ),
        sa.CheckConstraint(
            "cache_write_tokens IS NULL OR cache_write_tokens >= 0",
            name="ck_generation_cache_write_tokens",
        ),
        sa.CheckConstraint(
            "reasoning_tokens IS NULL OR reasoning_tokens >= 0",
            name="ck_generation_reasoning_tokens",
        ),
        sa.CheckConstraint("deadline_at > created_at", name="ck_generation_deadline"),
    )
    op.create_index(
        "ix_generation_state_deadline",
        "planning_generation_attempt",
        ["state", "deadline_at"],
    )
    op.execute("""
        CREATE FUNCTION check_generation_transition() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE
            receipt_columns text[] := ARRAY['counted_input_tokens', 'model', 'service_tier',
                'provider_request_id', 'input_tokens', 'output_tokens', 'cached_tokens',
                'cache_write_tokens', 'reasoning_tokens'];
            field_name text;
        BEGIN
            -- Late receipts may fill unknown accounting, never change outcome,
            -- reservation, request, existing observations or the logical deadline.
            IF OLD.state = 'uncertain'
               AND (to_jsonb(NEW) - receipt_columns) = (to_jsonb(OLD) - receipt_columns) THEN
                FOREACH field_name IN ARRAY receipt_columns LOOP
                    IF to_jsonb(OLD)->field_name <> 'null'::jsonb
                       AND to_jsonb(NEW)->field_name IS DISTINCT FROM to_jsonb(OLD)->field_name THEN
                        RAISE EXCEPTION 'invalid generation accounting change' USING ERRCODE = '23514';
                    END IF;
                END LOOP;
                RETURN NEW;
            END IF;
            IF OLD.state IN ('succeeded', 'failed', 'uncertain')
               OR (OLD.state = 'counting' AND NEW.state NOT IN ('generating', 'failed', 'uncertain'))
               OR (OLD.state = 'generating' AND NEW.state NOT IN ('succeeded', 'failed', 'uncertain'))
               OR NEW.generation_requests < OLD.generation_requests THEN
                RAISE EXCEPTION 'invalid generation transition' USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END; $$;
        CREATE TRIGGER generation_transition BEFORE UPDATE ON planning_generation_attempt
        FOR EACH ROW EXECUTE FUNCTION check_generation_transition()
    """)


def downgrade():
    # Discarding admission evidence could allow a prior external request to repeat.
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM planning_generation_attempt) THEN
                RAISE EXCEPTION 'retained generation attempts prevent downgrade';
            END IF;
        END; $$
    """)
    op.execute("DROP TRIGGER generation_transition ON planning_generation_attempt")
    op.execute("DROP FUNCTION check_generation_transition()")
    op.drop_table("planning_generation_attempt")
