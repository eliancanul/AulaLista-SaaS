"""Shared immutable reservations; window-based planning without remote counting."""

import sqlalchemy as sa
from alembic import op

revision = "0010_window_budget"
down_revision = "0009_planning_branches"
branch_labels = None
depends_on = None

REMOTE_CALLS = "count_requests = 1 AND generation_requests BETWEEN 0 AND 1"
REMOTE_DISPATCH = (
    "state NOT IN ('generating','succeeded') OR "
    "(generation_requests = 1 AND counted_input_tokens IS NOT NULL "
    "AND counted_input_tokens BETWEEN 1 AND 2048)"
)


def upgrade():
    op.create_table(
        "ai_budget_reservation",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "scope_id", sa.Uuid(), sa.ForeignKey("personal_scope.id"), nullable=False
        ),
        sa.Column("operation_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("state", sa.String(), nullable=False),
        sa.Column("reserved_usd", sa.Numeric(18, 9), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("scope_id", "operation_id", name="uq_ai_budget_operation"),
        sa.CheckConstraint("reserved_usd > 0", name="ck_ai_budget_reserve"),
        sa.CheckConstraint("kind IN ('planning','chat')", name="ck_ai_budget_kind"),
        sa.CheckConstraint(
            "state IN ('counting','generating','succeeded','failed','uncertain')",
            name="ck_ai_budget_state",
        ),
    )
    op.execute("""
        INSERT INTO ai_budget_reservation (id, scope_id, operation_id, kind, state, reserved_usd, created_at)
        SELECT id, scope_id, operation_id, 'planning', state, reserved_usd, created_at FROM planning_generation_attempt;
        CREATE FUNCTION mirror_ai_budget() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP = 'INSERT' THEN
                INSERT INTO ai_budget_reservation (id, scope_id, operation_id, kind, state, reserved_usd, created_at)
                VALUES (NEW.id, NEW.scope_id, NEW.operation_id, TG_ARGV[0], NEW.state, NEW.reserved_usd, NEW.created_at);
            ELSIF NEW.state IS DISTINCT FROM OLD.state THEN
                UPDATE ai_budget_reservation SET state = NEW.state WHERE id = NEW.id;
            END IF;
            RETURN NEW;
        END; $$;
        CREATE TRIGGER planning_ai_budget AFTER INSERT OR UPDATE OF state ON planning_generation_attempt
        FOR EACH ROW EXECUTE FUNCTION mirror_ai_budget('planning');
        CREATE FUNCTION guard_ai_budget() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF (to_jsonb(NEW) - 'state') IS DISTINCT FROM (to_jsonb(OLD) - 'state')
               OR OLD.state IN ('succeeded','failed','uncertain')
               OR (OLD.state = 'counting' AND NEW.state NOT IN ('generating','failed','uncertain'))
               OR (OLD.state = 'generating' AND NEW.state NOT IN ('succeeded','failed','uncertain')) THEN
                RAISE EXCEPTION 'invalid AI budget transition' USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END; $$;
        CREATE TRIGGER ai_budget_guard BEFORE UPDATE ON ai_budget_reservation
        FOR EACH ROW EXECUTE FUNCTION guard_ai_budget();
    """)
    op.add_column(
        "planning_generation_attempt",
        sa.Column(
            "count_strategy", sa.String(), nullable=False, server_default="remote-v1"
        ),
    )
    op.drop_constraint("ck_generation_calls", "planning_generation_attempt")
    op.create_check_constraint(
        "ck_generation_calls",
        "planning_generation_attempt",
        "(count_strategy = 'remote-v1' AND count_requests = 1 AND generation_requests BETWEEN 0 AND 1) OR "
        "(count_strategy = 'window-v1' AND count_requests = 0 AND counted_input_tokens IS NULL "
        "AND generation_requests = 1 AND state <> 'counting')",
    )
    op.drop_constraint("ck_generation_dispatch", "planning_generation_attempt")
    op.create_check_constraint(
        "ck_generation_dispatch",
        "planning_generation_attempt",
        "state NOT IN ('generating','succeeded') OR (count_strategy = 'window-v1' OR "
        "(generation_requests = 1 AND counted_input_tokens IS NOT NULL AND counted_input_tokens BETWEEN 1 AND 2048))",
    )


def downgrade():
    # Never erase a single-attempt receipt or pretend that it was remotely counted.
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM planning_generation_attempt WHERE count_strategy = 'window-v1')
               OR EXISTS (SELECT 1 FROM ai_budget_reservation WHERE kind = 'chat') THEN
                RAISE EXCEPTION 'retained window generation prevents downgrade';
            END IF;
        END; $$
    """)
    op.drop_constraint("ck_generation_dispatch", "planning_generation_attempt")
    op.create_check_constraint(
        "ck_generation_dispatch", "planning_generation_attempt", REMOTE_DISPATCH
    )
    op.drop_constraint("ck_generation_calls", "planning_generation_attempt")
    op.create_check_constraint(
        "ck_generation_calls", "planning_generation_attempt", REMOTE_CALLS
    )
    op.drop_column("planning_generation_attempt", "count_strategy")

    op.execute("DROP TRIGGER planning_ai_budget ON planning_generation_attempt")
    op.execute("DROP FUNCTION mirror_ai_budget()")
    op.execute("DROP TRIGGER ai_budget_guard ON ai_budget_reservation")
    op.execute("DROP FUNCTION guard_ai_budget()")
    op.drop_table("ai_budget_reservation")
