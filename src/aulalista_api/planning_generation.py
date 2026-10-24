"""Durable, opt-in generation admission. No credentials or environment discovery.

Reservations are conservative cumulative maxima, never refunded. A lost response
or process cannot trigger another transmission for the same logical operation.
"""

import hashlib
import json
import re
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import ROUND_CEILING, Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Numeric,
    UniqueConstraint,
    func,
    select,
    text,
    update,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, Session, mapped_column

from aulalista_api.auth import AuthError
from aulalista_api.database import Base
from aulalista_api.guided_planning import GeneratedPlanningRequest
from aulalista_api.materials import MaterialError, SourceVersion, authorize
from aulalista_api.openai_planning import (
    MAX_INPUT_TOKENS,
    MAX_OUTPUT_TOKENS,
    MODEL,
    MODEL_CONTEXT_TOKENS,
    WINDOW_RESERVE_USD,
    ProviderError,
    cost_usd,
    maximum_cost_usd,
    prepare,
)
from aulalista_api.planning_result import OUTPUT_SCHEMA, validate_generated_output
from aulalista_api.plannings import (
    MAX_REQUEST_BYTES,
    Planning,
    PlanningRevision,
    document,
    revision_source,
)

DEADLINE_SECONDS = 75
ACTIVE = ("counting", "generating")
GLOBAL_LOCK = int.from_bytes(
    hashlib.sha256(b"aulalista-openai-generation-global-v1").digest()[:8],
    "big",
    signed=True,
)


def now():
    return datetime.now(UTC)


def canonical(value):
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode()


@dataclass(frozen=True)
class GenerationProfile:
    """Explicit bounded admission; configuration is not transmission permission."""

    name: str
    actor_id: UUID
    scope_id: UUID
    budget_usd: Decimal
    count_request_reserve_usd: Decimal
    allowed_request_sha256: frozenset[str] | None
    input_policy: str = "exact-input-v1"
    count_strategy: str = "remote-v1"
    additional_reserve_usd: Decimal = Decimal("0")

    def __post_init__(self):
        if not isinstance(self.actor_id, UUID) or not isinstance(self.scope_id, UUID):
            raise ValueError("invalid_generation_profile")
        if not isinstance(self.name, str) or not re.fullmatch(
            r"[\w.-]{1,100}", self.name, re.ASCII
        ):
            raise ValueError("invalid_generation_profile")
        if self.count_strategy not in {"remote-v1", "window-once-v1"}:
            raise ValueError("invalid_generation_profile")
        single = self.count_strategy == "window-once-v1"
        if not isinstance(self.count_request_reserve_usd, Decimal):
            raise ValueError("invalid_generation_profile")
        if single and (
            self.input_policy != "manual-variable-v1"
            or self.count_request_reserve_usd != 0
        ):
            raise ValueError("invalid_generation_profile")
        if (
            not isinstance(self.additional_reserve_usd, Decimal)
            or not self.additional_reserve_usd.is_finite()
            or not 0 <= self.additional_reserve_usd < Decimal("100000000")
            or (not single and self.additional_reserve_usd != 0)
        ):
            raise ValueError("invalid_generation_profile")
        for amount in (
            (self.budget_usd,)
            if single
            else (self.budget_usd, self.count_request_reserve_usd)
        ):
            if (
                not isinstance(amount, Decimal)
                or not amount.is_finite()
                or not 0 < amount < Decimal("100000000")
            ):
                raise ValueError("invalid_generation_profile")
        if single and self.budget_usd > Decimal("2"):
            raise ValueError("invalid_generation_profile")
        if self.input_policy == "exact-input-v1":
            if (
                not isinstance(self.allowed_request_sha256, frozenset)
                or not self.allowed_request_sha256
                or any(
                    not isinstance(value, str)
                    or not re.fullmatch(r"[0-9a-f]{64}", value)
                    for value in self.allowed_request_sha256
                )
            ):
                raise ValueError("invalid_generation_profile")
        elif (
            self.input_policy != "manual-variable-v1"
            or self.allowed_request_sha256 is not None
        ):
            raise ValueError("invalid_generation_profile")

    @property
    def reservation_usd(self):
        if self.count_strategy == "window-once-v1":
            return (WINDOW_RESERVE_USD + self.additional_reserve_usd).quantize(
                Decimal("0.000000001"), rounding=ROUND_CEILING
            )
        return (
            maximum_cost_usd(MAX_INPUT_TOKENS) + self.count_request_reserve_usd
        ).quantize(Decimal("0.000000001"), rounding=ROUND_CEILING)

    @property
    def fingerprint(self):
        return hashlib.sha256(
            canonical(
                {
                    "count_strategy": self.count_strategy,
                    "additional_reserve_usd": str(self.additional_reserve_usd),
                    "version": "openai-guided-v1",
                    "name": self.name,
                    "actor_id": str(self.actor_id),
                    "scope_id": str(self.scope_id),
                    "budget_usd": str(self.budget_usd),
                    "count_request_reserve_usd": str(self.count_request_reserve_usd),
                    "reservation_usd": str(self.reservation_usd),
                    "input_policy": self.input_policy,
                    "allowed_request_sha256": (
                        sorted(self.allowed_request_sha256)
                        if self.allowed_request_sha256 is not None
                        else None
                    ),
                    "model": MODEL,
                    "max_input_tokens": MAX_INPUT_TOKENS,
                    "max_output_tokens": MAX_OUTPUT_TOKENS,
                    "deadline_seconds": DEADLINE_SECONDS,
                    "max_concurrency": 1,
                    "retries": 0,
                    "output_schema": OUTPUT_SCHEMA,
                }
            )
        ).hexdigest()


class GenerationAttempt(Base):
    __tablename__ = "planning_generation_attempt"
    __table_args__ = (
        Index("ix_generation_state_deadline", "state", "deadline_at"),
        Index(
            "uq_generation_single_once",
            "count_strategy",
            unique=True,
            postgresql_where=text("count_strategy = 'window-once-v1'"),
        ),
        UniqueConstraint("scope_id", "operation_id", name="uq_generation_operation"),
        ForeignKeyConstraint(
            ["planning_revision_id", "scope_id"],
            ["planning_revision.id", "planning_revision.scope_id"],
            name="fk_generation_revision_scope",
        ),
        CheckConstraint(
            "request_fingerprint ~ '^[0-9a-f]{64}$'", name="ck_generation_request_hash"
        ),
        CheckConstraint(
            "payload_sha256 ~ '^[0-9a-f]{64}$'", name="ck_generation_payload_hash"
        ),
        CheckConstraint(
            "profile_fingerprint ~ '^[0-9a-f]{64}$'", name="ck_generation_profile_hash"
        ),
        CheckConstraint(
            "state IN ('counting','generating','succeeded','failed','uncertain')",
            name="ck_generation_state",
        ),
        CheckConstraint("reserved_usd > 0", name="ck_generation_reserve"),
        CheckConstraint(
            "(count_strategy = 'remote-v1' AND count_requests = 1 AND generation_requests BETWEEN 0 AND 1) OR "
            "(count_strategy = 'window-once-v1' AND count_requests = 0 AND counted_input_tokens IS NULL AND generation_requests = 1 AND state <> 'counting')",
            name="ck_generation_calls",
        ),
        CheckConstraint("deadline_at > created_at", name="ck_generation_deadline"),
        CheckConstraint(
            "octet_length(request::text) BETWEEN 1 AND 8192",
            name="ck_generation_request_size",
        ),
        CheckConstraint(
            "octet_length(configuration::text) BETWEEN 1 AND 16384",
            name="ck_generation_configuration_size",
        ),
        CheckConstraint(
            "(state = 'succeeded') = (planning_revision_id IS NOT NULL)",
            name="ck_generation_receipt",
        ),
        CheckConstraint(
            "(state IN ('counting','generating')) = (finished_at IS NULL)",
            name="ck_generation_terminal",
        ),
        CheckConstraint(
            "counted_input_tokens IS NULL OR counted_input_tokens >= 0",
            name="ck_generation_count_tokens",
        ),
        CheckConstraint(
            "input_tokens IS NULL OR input_tokens >= 0",
            name="ck_generation_input_tokens",
        ),
        CheckConstraint(
            "output_tokens IS NULL OR output_tokens >= 0",
            name="ck_generation_output_tokens",
        ),
        CheckConstraint(
            "cached_tokens IS NULL OR cached_tokens >= 0",
            name="ck_generation_cached_tokens",
        ),
        CheckConstraint(
            "reasoning_tokens IS NULL OR reasoning_tokens >= 0",
            name="ck_generation_reasoning_tokens",
        ),
        CheckConstraint(
            "cache_write_tokens IS NULL OR cache_write_tokens >= 0",
            name="ck_generation_cache_write_tokens",
        ),
        CheckConstraint(
            "state NOT IN ('generating','succeeded') OR "
            "(count_strategy = 'window-once-v1' OR (generation_requests = 1 AND counted_input_tokens IS NOT NULL "
            "AND counted_input_tokens BETWEEN 1 AND 2048))",
            name="ck_generation_dispatch",
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    scope_id: Mapped[UUID] = mapped_column(ForeignKey("personal_scope.id"))
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("principal.id"))
    operation_id: Mapped[UUID]
    request_fingerprint: Mapped[str]
    request: Mapped[dict] = mapped_column(JSONB)
    configuration: Mapped[dict] = mapped_column(JSONB)
    payload_sha256: Mapped[str]
    profile_fingerprint: Mapped[str]
    state: Mapped[str]
    reserved_usd: Mapped[Decimal] = mapped_column(Numeric(18, 9))
    count_strategy: Mapped[str] = mapped_column(server_default="remote-v1")
    count_requests: Mapped[int]
    generation_requests: Mapped[int]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    deadline_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    counted_input_tokens: Mapped[int | None]
    input_tokens: Mapped[int | None]
    output_tokens: Mapped[int | None]
    cached_tokens: Mapped[int | None]
    reasoning_tokens: Mapped[int | None]
    cache_write_tokens: Mapped[int | None]
    model: Mapped[str | None]
    service_tier: Mapped[str | None]
    provider_request_id: Mapped[str | None]
    error_code: Mapped[str | None]
    planning_revision_id: Mapped[UUID | None]


def reject_generation_operation(session, scope_id, operation_id):
    """Called under the existing planning operation lock by other write paths."""
    if (
        session.scalar(
            select(GenerationAttempt.id).where(
                GenerationAttempt.scope_id == scope_id,
                GenerationAttempt.operation_id == operation_id,
            )
        )
        is not None
    ):
        raise MaterialError(409, "conflict")


def operation_lock(session, scope_id, operation_id):
    key = int.from_bytes(
        hashlib.sha256(b"planning-v1\0" + scope_id.bytes + operation_id.bytes).digest()[
            :8
        ],
        "big",
        signed=True,
    )
    session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})


def expire_attempts(session):
    instant = now()
    session.execute(
        update(GenerationAttempt)
        .where(
            GenerationAttempt.state.in_(ACTIVE),
            GenerationAttempt.deadline_at <= instant,
        )
        .values(state="uncertain", finished_at=instant, error_code="operation_expired")
    )


def current_attempt(session, scope_id, operation_id):
    return session.scalar(
        select(GenerationAttempt).where(
            GenerationAttempt.scope_id == scope_id,
            GenerationAttempt.operation_id == operation_id,
        )
    )


def attempt_outcome(session, attempt):
    if attempt.state == "succeeded":
        revision = session.get(PlanningRevision, attempt.planning_revision_id)
        return document(revision, revision_source(session, revision))
    return MaterialError(
        409,
        "generation_pending"
        if attempt.state in ACTIVE
        else f"generation_{attempt.state}",
    )


class GeneratedPlannings:
    def __init__(self, engine, provider=None, profile=None):
        self.engine, self.provider, self.profile = engine, provider, profile

    def capability(self, actor, scope):
        with Session(self.engine) as session, session.begin():
            principal = authorize(session, actor, scope)
            return {"available": self._enabled_for(principal, scope)}

    def _enabled_for(self, principal, scope):
        return (
            self.provider is not None
            and isinstance(self.profile, GenerationProfile)
            and self.profile.actor_id == principal
            and self.profile.scope_id == scope
        )

    def operation(self, actor, scope, operation):
        with Session(self.engine) as session, session.begin():
            authorize(session, actor, scope)
            attempt = current_attempt(session, scope, operation)
            if attempt is None:
                # A legacy write may still hold the shared operation lock while
                # its receipt is uncommitted. Its absence must remain a prompt 404.
                outcome = MaterialError(404, "not_found")
            else:
                session.refresh(attempt, with_for_update=True)
                instant = now()
                if attempt.state in ACTIVE and attempt.deadline_at <= instant:
                    attempt.state = "uncertain"
                    attempt.finished_at = instant
                    attempt.error_code = "operation_expired"
                outcome = attempt_outcome(session, attempt)
        if isinstance(outcome, MaterialError):
            raise outcome
        return outcome

    def write(self, actor, scope, operation, request):
        if not isinstance(request, GeneratedPlanningRequest):
            raise MaterialError(422, "invalid_request")
        raw = request.canonical()
        if len(raw) > MAX_REQUEST_BYTES:
            raise MaterialError(413, "content_too_large")
        fingerprint = hashlib.sha256(raw).hexdigest()
        started = time.monotonic()
        with Session(self.engine) as session, session.begin():
            actor_id = authorize(session, actor, scope)
            operation_lock(session, scope, operation)
            session.execute(
                text("SELECT pg_advisory_xact_lock(:key)"), {"key": GLOBAL_LOCK}
            )
            expire_attempts(session)
            previous = current_attempt(session, scope, operation)
            if previous is not None:
                outcome = (
                    MaterialError(409, "conflict")
                    if previous.request_fingerprint != fingerprint
                    else attempt_outcome(session, previous)
                )
                attempt_id = None
            else:
                if (
                    session.scalar(
                        select(PlanningRevision.id).where(
                            PlanningRevision.scope_id == scope,
                            PlanningRevision.operation_id == operation,
                        )
                    )
                    is not None
                ):
                    raise MaterialError(409, "conflict")
                if not self._enabled_for(actor_id, scope):
                    raise MaterialError(503, "generation_unavailable")
                if (
                    self.profile.input_policy == "exact-input-v1"
                    and fingerprint not in self.profile.allowed_request_sha256
                ) or (
                    self.profile.input_policy == "manual-variable-v1"
                    and request.reference is not None
                ):
                    raise MaterialError(422, "generation_input_not_approved")
                source_version_id = None
                if request.reference is not None:
                    source_version_id = session.scalar(
                        select(SourceVersion.id).where(
                            SourceVersion.scope_id == scope,
                            SourceVersion.source_id == request.reference.source_id,
                            SourceVersion.number == request.reference.source_version,
                        )
                    )
                    if source_version_id is None:
                        raise MaterialError(404, "not_found")
                if (
                    session.scalar(
                        select(GenerationAttempt.id)
                        .where(GenerationAttempt.state.in_((*ACTIVE, "uncertain")))
                        .limit(1)
                    )
                    is not None
                ):
                    outcome = MaterialError(409, "generation_busy")
                    attempt_id = None
                else:
                    reserved = session.scalar(
                        select(
                            func.coalesce(func.sum(GenerationAttempt.reserved_usd), 0)
                        )
                    )
                    once_used = (
                        self.profile.count_strategy == "window-once-v1"
                        and session.scalar(
                            select(GenerationAttempt.id)
                            .where(GenerationAttempt.count_strategy == "window-once-v1")
                            .limit(1)
                        )
                        is not None
                    )
                    if (
                        once_used
                        or reserved + self.profile.reservation_usd
                        > self.profile.budget_usd
                    ):
                        outcome = MaterialError(429, "generation_budget_exhausted")
                        attempt_id = None
                    else:
                        manual = request.model_dump(
                            mode="json", exclude={"reference", "contract_version"}
                        )
                        payload = prepare(manual, OUTPUT_SCHEMA)
                        instant = now()
                        attempt = GenerationAttempt(
                            scope_id=scope,
                            actor_id=actor_id,
                            operation_id=operation,
                            request_fingerprint=fingerprint,
                            request=json.loads(raw),
                            configuration={
                                "version": "openai-guided-v1",
                                "input_policy": self.profile.input_policy,
                                "count_strategy": self.profile.count_strategy,
                                "additional_reserve_usd": str(
                                    self.profile.additional_reserve_usd
                                ),
                                "provider_payload": {
                                    k: v for k, v in payload.items() if k != "input"
                                },
                                "profile_name": self.profile.name,
                                "actor_id": str(self.profile.actor_id),
                                "scope_id": str(self.profile.scope_id),
                                "budget_usd": str(self.profile.budget_usd),
                                "count_request_reserve_usd": str(
                                    self.profile.count_request_reserve_usd
                                ),
                                "reservation_usd": str(self.profile.reservation_usd),
                                "max_input_tokens": MODEL_CONTEXT_TOKENS
                                if self.profile.count_strategy == "window-once-v1"
                                else MAX_INPUT_TOKENS,
                                "max_output_tokens": MAX_OUTPUT_TOKENS,
                                "deadline_seconds": DEADLINE_SECONDS,
                                "concurrency": 1,
                                "retries": 0,
                                "currency": "USD",
                                "input_usd_per_token": str(cost_usd(1, 0)),
                                "output_usd_per_token": str(cost_usd(0, 1)),
                                **(
                                    {
                                        "price_bound": {
                                            "input_usd_per_million": "0.20",
                                            "output_usd_per_million": "0.75",
                                            "context_window_tokens": MODEL_CONTEXT_TOKENS,
                                            "provider_reserve_usd": str(
                                                WINDOW_RESERVE_USD
                                            ),
                                        }
                                    }
                                    if self.profile.count_strategy == "window-once-v1"
                                    else {}
                                ),
                                "request_sha256": fingerprint,
                                **(
                                    {"approved_request_sha256": fingerprint}
                                    if self.profile.input_policy == "exact-input-v1"
                                    else {}
                                ),
                            },
                            payload_sha256=hashlib.sha256(
                                canonical(payload)
                            ).hexdigest(),
                            profile_fingerprint=self.profile.fingerprint,
                            state="generating"
                            if self.profile.count_strategy == "window-once-v1"
                            else "counting",
                            reserved_usd=self.profile.reservation_usd,
                            count_strategy=self.profile.count_strategy,
                            count_requests=0
                            if self.profile.count_strategy == "window-once-v1"
                            else 1,
                            generation_requests=1
                            if self.profile.count_strategy == "window-once-v1"
                            else 0,
                            created_at=instant,
                            deadline_at=instant + timedelta(seconds=DEADLINE_SECONDS),
                        )
                        session.add(attempt)
                        session.flush()
                        attempt_id, outcome = attempt.id, None
        if isinstance(outcome, MaterialError):
            raise outcome
        if attempt_id is None:
            return outcome
        observed = {}
        try:
            # Admission is committed and all authorization/operation locks released.
            if time.monotonic() - started >= DEADLINE_SECONDS:
                raise ProviderError("operation_expired")
            if self.profile.count_strategy == "remote-v1":
                counted = self.provider.count(payload)
                if type(counted) is int and 0 <= counted <= 2_147_483_647:
                    observed["counted_input_tokens"] = counted
                if type(counted) is not int or not 1 <= counted <= MAX_INPUT_TOKENS:
                    raise ProviderError("provider_input_limit", uncertain=False)
                with Session(self.engine) as session, session.begin():
                    authorize(session, actor, scope)
                    attempt = session.get(
                        GenerationAttempt, attempt_id, with_for_update=True
                    )
                    self._require_active(attempt, "counting", started)
                    attempt.counted_input_tokens = counted
                    attempt.state, attempt.generation_requests = "generating", 1
            else:
                with Session(self.engine) as session, session.begin():
                    authorize(session, actor, scope)
                    attempt = session.get(
                        GenerationAttempt, attempt_id, with_for_update=True
                    )
                    self._require_active(attempt, "generating", started)
            result = self.provider.generate(payload)
            observed.update(
                {
                    "model": result.model,
                    "provider_request_id": result.request_id,
                    "input_tokens": result.input_tokens,
                    "output_tokens": result.output_tokens,
                    "cached_tokens": result.cached_tokens,
                    "cache_write_tokens": result.cache_write_tokens,
                    "reasoning_tokens": result.reasoning_tokens,
                    "service_tier": "default",
                }
            )
            try:
                validated = validate_generated_output(
                    result.output, request.duration_minutes
                )
                # JSONB adds spaces after separators. This mirrors that byte size,
                # independent of key ordering, before attempting the constrained insert.
                if (
                    len(
                        json.dumps(
                            validated, ensure_ascii=False, allow_nan=False
                        ).encode()
                    )
                    > 8192
                ):
                    raise ValueError
            except (ValueError, TypeError, UnicodeError):
                raise ProviderError(
                    "provider_invalid_output", uncertain=False
                ) from None
            with Session(self.engine) as session, session.begin():
                authorized = authorize(session, actor, scope)
                attempt = session.get(
                    GenerationAttempt, attempt_id, with_for_update=True
                )
                self._require_active(attempt, "generating", started)
                planning = Planning(scope_id=scope, current_revision=1)
                session.add(planning)
                session.flush()
                revision = PlanningRevision(
                    planning_id=planning.id,
                    scope_id=scope,
                    number=1,
                    source_version_id=source_version_id,
                    actor_id=authorized,
                    operation_id=operation,
                    request_fingerprint=fingerprint,
                    request=json.loads(raw),
                    result=validated,
                )
                session.add(revision)
                session.flush()
                saved = document(revision, revision_source(session, revision))
                # Inserts/reads may themselves wait. Recheck the original session
                # and elapsed budget immediately before accepting this result.
                authorize(session, actor, scope)
                self._require_active(attempt, "generating", started)
                attempt.state, attempt.finished_at = "succeeded", now()
                attempt.planning_revision_id = revision.id
                for key, value in safe_usage(observed).items():
                    setattr(attempt, key, value)
            return saved
        except ProviderError as error:
            observed.update(safe_usage(getattr(error, "usage", None)))
            final_state = self._finish(
                attempt_id,
                "uncertain" if error.uncertain else "failed",
                error.code,
                observed,
            )
            raise MaterialError(409, f"generation_{final_state}") from None
        except (AuthError, MaterialError):
            self._finish(
                attempt_id, "uncertain", "authorization_or_deadline_changed", observed
            )
            raise
        except Exception:
            self._finish(attempt_id, "uncertain", "operation_interrupted", observed)
            raise MaterialError(409, "generation_uncertain") from None

    def _require_active(self, attempt, state, started):
        if (
            attempt.state != state
            or attempt.deadline_at <= now()
            or time.monotonic() - started >= DEADLINE_SECONDS
        ):
            raise ProviderError("operation_expired")

    def _finish(self, attempt_id, state, code, observed):
        # Never overwrite a committed success after a lost database response.
        with Session(self.engine) as session, session.begin():
            attempt = session.get(GenerationAttempt, attempt_id, with_for_update=True)
            if attempt.state in ACTIVE:
                attempt.state, attempt.finished_at, attempt.error_code = (
                    state,
                    now(),
                    code,
                )
                for key, value in safe_usage(observed).items():
                    setattr(attempt, key, value)
            elif attempt.state == "uncertain":
                # A GET may expire the operation while its response is in flight.
                # Add missing observations without changing the terminal decision.
                for key, value in safe_usage(observed).items():
                    if getattr(attempt, key) is None and value is not None:
                        setattr(attempt, key, value)
            final_state = attempt.state
        return final_state


def safe_usage(observed):
    if not isinstance(observed, dict):
        return {}
    values = {}
    for key in (
        "counted_input_tokens",
        "input_tokens",
        "output_tokens",
        "cached_tokens",
        "reasoning_tokens",
        "cache_write_tokens",
    ):
        value = observed.get(key)
        if value is None or (type(value) is int and 0 <= value <= 2_147_483_647):
            if key in observed:
                values[key] = value
    for key in ("model", "provider_request_id", "service_tier"):
        value = observed.get(key)
        if value is None or (
            isinstance(value, str) and re.fullmatch(r"[\w.-]{1,128}", value, re.ASCII)
        ):
            if key in observed:
                values[key] = value
    return values
