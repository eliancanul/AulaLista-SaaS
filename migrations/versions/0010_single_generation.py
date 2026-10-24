"""Add one globally retained generation without a remote count; preserve history."""

import sqlalchemy as sa
from alembic import op

revision = "0010_single_generation"
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
        "(count_strategy = 'window-once-v1' AND count_requests = 0 AND counted_input_tokens IS NULL "
        "AND generation_requests = 1 AND state <> 'counting')",
    )
    op.drop_constraint("ck_generation_dispatch", "planning_generation_attempt")
    op.create_check_constraint(
        "ck_generation_dispatch",
        "planning_generation_attempt",
        "state NOT IN ('generating','succeeded') OR (count_strategy = 'window-once-v1' OR "
        "(generation_requests = 1 AND counted_input_tokens IS NOT NULL AND counted_input_tokens BETWEEN 1 AND 2048))",
    )
    op.create_index(
        "uq_generation_single_once",
        "planning_generation_attempt",
        ["count_strategy"],
        unique=True,
        postgresql_where=sa.text("count_strategy = 'window-once-v1'"),
    )


def downgrade():
    # Never erase a single-attempt receipt or pretend that it was remotely counted.
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM planning_generation_attempt WHERE count_strategy = 'window-once-v1') THEN
                RAISE EXCEPTION 'retained single generation prevents downgrade';
            END IF;
        END; $$
    """)
    op.drop_index("uq_generation_single_once", table_name="planning_generation_attempt")
    op.drop_constraint("ck_generation_dispatch", "planning_generation_attempt")
    op.create_check_constraint(
        "ck_generation_dispatch", "planning_generation_attempt", REMOTE_DISPATCH
    )
    op.drop_constraint("ck_generation_calls", "planning_generation_attempt")
    op.create_check_constraint(
        "ck_generation_calls", "planning_generation_attempt", REMOTE_CALLS
    )
    op.drop_column("planning_generation_attempt", "count_strategy")
