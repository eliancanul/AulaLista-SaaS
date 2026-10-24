"""Opt-in server factory. No credential or provider discovery in the normal app.

The switch enables software capability, not permission or verified funding.
OPENAI_API_KEY is a private server environment value, not a Codex Network secret.
"""

import os
from decimal import Decimal, InvalidOperation
from uuid import UUID

from aulalista_api.app import create_app as create_base_app
from aulalista_api.openai_planning import BASE_URL, MODEL, OpenAIPlanning, ProviderError
from aulalista_api.pilot import ManualPilotConfig

MAX_PILOT_BUDGET_USD = Decimal("2")


def create_app():
    enabled = os.environ.get("AULALISTA_PILOT_ENABLED", "false")
    if enabled == "false":
        return create_base_app()
    if enabled != "true":
        raise ValueError("invalid_pilot_runtime")
    try:
        config = ManualPilotConfig(
            name="private-manual-pilot-v1",
            actor_id=UUID(os.environ["AULALISTA_PILOT_ACTOR_ID"]),
            scope_id=UUID(os.environ["AULALISTA_PILOT_SCOPE_ID"]),
            budget_usd=Decimal(os.environ["AULALISTA_PILOT_BUDGET_USD"]),
            count_request_reserve_usd=Decimal(
                os.environ["AULALISTA_PILOT_COUNT_RESERVE_USD"]
            ),
            provider="openai",
            destination=BASE_URL,
            model=MODEL,
            input_policy="manual-variable-v1",
        )
        profile = config.validated_profile()
        if profile.budget_usd > MAX_PILOT_BUDGET_USD:
            raise ValueError
        provider = OpenAIPlanning(server_api_key=os.environ["OPENAI_API_KEY"])
    except (KeyError, ValueError, InvalidOperation, ProviderError):
        raise ValueError("invalid_pilot_runtime") from None
    return create_base_app(planning_provider=provider, pilot_config=config)
