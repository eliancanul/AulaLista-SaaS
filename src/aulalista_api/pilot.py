"""Non-secret, explicit composition for the one-actor manual pilot.

This validates software configuration, not permission, funding, current pricing
or protection of a credential. The existing provider must be injected separately
with an explicit credential source. Server credentials and platform Network
secrets have different delivery guarantees; neither is certified by this type.
"""

from dataclasses import dataclass
from decimal import Decimal
from uuid import UUID

from aulalista_api.openai_planning import (
    BASE_URL,
    MAX_INPUT_TOKENS,
    MODEL,
    MODEL_CONTEXT_TOKENS,
    OpenAIPlanning,
)
from aulalista_api.planning_generation import GenerationProfile


@dataclass(frozen=True)
class ManualPilotConfig:
    name: str
    actor_id: UUID
    scope_id: UUID
    budget_usd: Decimal
    count_request_reserve_usd: Decimal
    provider: str
    destination: str
    model: str
    input_policy: str
    count_strategy: str = "remote-v1"
    additional_reserve_usd: Decimal = Decimal("0")

    def generation_profile(self, provider: OpenAIPlanning) -> GenerationProfile:
        """Validate before the factory creates DB resources or invokes a provider."""
        if not isinstance(provider, OpenAIPlanning):
            raise ValueError("invalid_manual_pilot")
        expected_limit = (
            MODEL_CONTEXT_TOKENS
            if self.count_strategy == "window-v1"
            else MAX_INPUT_TOKENS
        )
        if provider.input_token_limit != expected_limit:
            raise ValueError("invalid_manual_pilot")
        return self.validated_profile()

    def validated_profile(self) -> GenerationProfile:
        """Validate public configuration before a startup factory reads a secret."""
        if (
            self.provider != "openai"
            or self.destination != BASE_URL
            or self.model != MODEL
            or self.input_policy != "manual-variable-v1"
        ):
            raise ValueError("invalid_manual_pilot")
        try:
            profile = GenerationProfile(
                name=self.name,
                actor_id=self.actor_id,
                scope_id=self.scope_id,
                budget_usd=self.budget_usd,
                count_request_reserve_usd=self.count_request_reserve_usd,
                allowed_request_sha256=None,
                input_policy=self.input_policy,
                count_strategy=self.count_strategy,
                additional_reserve_usd=self.additional_reserve_usd,
            )
        except ValueError:
            raise ValueError("invalid_manual_pilot") from None
        if (
            any(
                amount != amount.quantize(Decimal("0.000000001"))
                for amount in (
                    self.budget_usd,
                    self.count_request_reserve_usd,
                    self.additional_reserve_usd,
                )
            )
            or self.budget_usd < profile.reservation_usd
        ):
            raise ValueError("invalid_manual_pilot")
        return profile
