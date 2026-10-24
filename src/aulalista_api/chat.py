"""Private, durable chat. One admitted operation dispatches at most once."""

import hashlib
import time
from datetime import UTC, timedelta
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from aulalista_api.ai_budget import (
    GLOBAL_LOCK,
    BudgetReservation,
    budget_busy,
    reserved_total,
)
from aulalista_api.auth import AuthError
from aulalista_api.chat_models import ChatTurn, Conversation, TurnRequest
from aulalista_api.materials import MaterialError, authorize
from aulalista_api.openai_chat import OpenAIChat, estimated_cost, prepare
from aulalista_api.openai_planning import (
    MAX_OUTPUT_TOKENS,
    MODEL_CONTEXT_TOKENS,
    OpenAIPlanning,
    ProviderError,
    _encode,
)
from aulalista_api.planning_generation import (
    DEADLINE_SECONDS,
    GenerationProfile,
    canonical,
    now,
    safe_usage,
)

MAX_ATTEMPTS = 100
MAX_SUCCESSES = 20


def summary(conversation):
    return {
        "id": str(conversation.id),
        "title": conversation.title,
        "version": conversation.version,
        "created_at": conversation.created_at.astimezone(UTC).isoformat(),
        "updated_at": conversation.updated_at.astimezone(UTC).isoformat(),
    }


def document(session, conversation):
    turns = session.scalars(
        select(ChatTurn)
        .where(ChatTurn.conversation_id == conversation.id)
        .order_by(ChatTurn.number)
    ).all()
    return {
        "conversation": summary(conversation),
        "turns": [
            {
                "operation_id": str(turn.operation_id),
                "number": turn.number,
                "user_text": turn.user_text,
                "assistant_text": turn.assistant_text,
                "state": turn.state,
                "error_code": turn.error_code,
                "usage": {
                    "input_tokens": turn.input_tokens,
                    "output_tokens": turn.output_tokens,
                    "estimated_cost_usd": (
                        format(cost, "f")
                        if (
                            cost := estimated_cost(
                                turn.input_tokens, turn.output_tokens
                            )
                        )
                        is not None
                        else None
                    ),
                    "reserved_usd": str(turn.reserved_usd),
                },
            }
            for turn in turns
        ],
    }


def find_conversation(session, scope, conversation_id):
    conversation = session.scalar(
        select(Conversation)
        .where(Conversation.id == conversation_id, Conversation.scope_id == scope)
        .with_for_update()
    )
    if conversation is None:
        raise MaterialError(404, "not_found")
    return conversation


def expire_conversation(session, conversation):
    instant = now()
    for turn in session.scalars(
        select(ChatTurn)
        .where(
            ChatTurn.conversation_id == conversation.id,
            ChatTurn.state == "generating",
            ChatTurn.deadline_at <= instant,
        )
        .with_for_update()
    ):
        turn.state, turn.finished_at, turn.error_code = (
            "uncertain",
            instant,
            "operation_expired",
        )
    session.flush()


def turn_error(turn):
    return MaterialError(
        409, "chat_pending" if turn.state == "generating" else f"chat_{turn.state}"
    )


class Conversations:
    def __init__(self, engine, provider=None, profile=None):
        self.engine, self.provider, self.profile = engine, provider, profile

    def _enabled_for(self, principal, scope):
        return (
            isinstance(self.provider, OpenAIPlanning)
            and self.provider.input_token_limit == MODEL_CONTEXT_TOKENS
            and isinstance(self.profile, GenerationProfile)
            and self.profile.count_strategy == "window-v1"
            and self.profile.actor_id == principal
            and self.profile.scope_id == scope
        )

    def capability(self, actor, scope):
        with Session(self.engine) as session, session.begin():
            principal = authorize(session, actor, scope)
            return {"available": self._enabled_for(principal, scope)}

    def create(self, actor, scope, operation):
        with Session(self.engine) as session, session.begin():
            principal = authorize(session, actor, scope)
            lock = int.from_bytes(
                hashlib.sha256(
                    b"chat-create-v1" + scope.bytes + operation.bytes
                ).digest()[:8],
                "big",
                signed=True,
            )
            session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock})
            conversation = session.scalar(
                select(Conversation).where(
                    Conversation.scope_id == scope,
                    Conversation.operation_id == operation,
                )
            )
            if conversation is None:
                instant = now()
                conversation = Conversation(
                    scope_id=scope,
                    actor_id=principal,
                    operation_id=operation,
                    title="Nueva conversación",
                    version=0,
                    created_at=instant,
                    updated_at=instant,
                )
                session.add(conversation)
                session.flush()
            else:
                conversation = find_conversation(session, scope, conversation.id)
                expire_conversation(session, conversation)
            return document(session, conversation)

    def list(self, actor, scope, *, cursor=None, limit=50):
        with Session(self.engine) as session, session.begin():
            authorize(session, actor, scope)
            if type(limit) is not int or not 1 <= limit <= 50:
                raise MaterialError(422, "invalid_request")
            query = select(Conversation).where(Conversation.scope_id == scope)
            if cursor is not None:
                if (
                    not isinstance(cursor, UUID)
                    or session.scalar(
                        select(Conversation.id).where(
                            Conversation.id == cursor, Conversation.scope_id == scope
                        )
                    )
                    is None
                ):
                    raise MaterialError(404, "not_found")
                query = query.where(Conversation.id > cursor)
            rows = session.scalars(
                query.order_by(Conversation.id).limit(limit + 1)
            ).all()
            return {
                "items": [summary(row) for row in rows[:limit]],
                "next_cursor": str(rows[limit - 1].id) if len(rows) > limit else None,
            }

    def read(
        self,
        actor,
        scope,
        conversation_id=None,
        *,
        creation_operation=None,
        turn_operation=None,
    ):
        with Session(self.engine) as session, session.begin():
            authorize(session, actor, scope)
            if creation_operation is not None:
                conversation_id = session.scalar(
                    select(Conversation.id).where(
                        Conversation.scope_id == scope,
                        Conversation.operation_id == creation_operation,
                    )
                )
            conversation = find_conversation(session, scope, conversation_id)
            if (
                turn_operation is not None
                and session.scalar(
                    select(ChatTurn.id).where(
                        ChatTurn.conversation_id == conversation.id,
                        ChatTurn.operation_id == turn_operation,
                    )
                )
                is None
            ):
                raise MaterialError(404, "not_found")
            expire_conversation(session, conversation)
            return document(session, conversation)

    def write(self, actor, scope, conversation_id, operation, request):
        if not isinstance(request, TurnRequest):
            raise MaterialError(422, "invalid_request")
        fingerprint = hashlib.sha256(
            canonical({"conversation_id": str(conversation_id), **request.model_dump()})
        ).hexdigest()
        started = time.monotonic()
        outcome, turn_id = None, None
        with Session(self.engine) as session, session.begin():
            principal = authorize(session, actor, scope)
            session.execute(
                text("SELECT pg_advisory_xact_lock(:key)"), {"key": GLOBAL_LOCK}
            )
            conversation = find_conversation(session, scope, conversation_id)
            expire_conversation(session, conversation)
            previous = session.scalar(
                select(ChatTurn).where(
                    ChatTurn.scope_id == scope, ChatTurn.operation_id == operation
                )
            )
            if previous is not None:
                if previous.request_fingerprint != fingerprint:
                    outcome = MaterialError(409, "conflict")
                elif previous.state == "succeeded":
                    outcome = document(session, conversation)
                else:
                    outcome = turn_error(previous)
            else:
                if (
                    session.scalar(
                        select(BudgetReservation.id).where(
                            BudgetReservation.scope_id == scope,
                            BudgetReservation.operation_id == operation,
                        )
                    )
                    is not None
                    or request.expected_version != conversation.version
                ):
                    raise MaterialError(409, "conflict")
                if not self._enabled_for(principal, scope):
                    raise MaterialError(503, "chat_unavailable")
                history = session.scalars(
                    select(ChatTurn)
                    .where(
                        ChatTurn.conversation_id == conversation.id,
                        ChatTurn.state == "succeeded",
                    )
                    .order_by(ChatTurn.number)
                ).all()
                if (
                    conversation.version >= MAX_ATTEMPTS
                    or len(history) >= MAX_SUCCESSES
                ):
                    raise MaterialError(422, "chat_limit_reached")
                messages = []
                for turn in history:
                    messages.extend(
                        [
                            {"role": "user", "content": turn.user_text},
                            {"role": "assistant", "content": turn.assistant_text},
                        ]
                    )
                messages.append({"role": "user", "content": request.text})
                try:
                    payload = prepare(messages)
                except ProviderError:
                    raise MaterialError(413, "chat_context_too_large") from None
                if budget_busy(session):
                    outcome = MaterialError(409, "chat_busy")
                elif (
                    reserved_total(session) + self.profile.reservation_usd
                    > self.profile.budget_usd
                ):
                    outcome = MaterialError(429, "chat_budget_exhausted")
                else:
                    instant = now()
                    conversation.version += 1
                    conversation.updated_at = instant
                    if conversation.version == 1:
                        conversation.title = " ".join(request.text.split())[:80]
                    session.flush()
                    turn = ChatTurn(
                        conversation_id=conversation.id,
                        scope_id=scope,
                        actor_id=principal,
                        operation_id=operation,
                        request_fingerprint=fingerprint,
                        payload_sha256=hashlib.sha256(_encode(payload)).hexdigest(),
                        profile_fingerprint=self.profile.fingerprint,
                        configuration={
                            "version": "private-chat-v1",
                            "provider_payload": {
                                k: v for k, v in payload.items() if k != "input"
                            },
                            "count_strategy": "window-v1",
                            "count_requests": 0,
                            "generation_requests": 1,
                            "budget_usd": str(self.profile.budget_usd),
                            "additional_reserve_usd": str(
                                self.profile.additional_reserve_usd
                            ),
                            "reservation_usd": str(self.profile.reservation_usd),
                            "max_input_tokens": MODEL_CONTEXT_TOKENS,
                            "max_output_tokens": MAX_OUTPUT_TOKENS,
                            "deadline_seconds": DEADLINE_SECONDS,
                            "concurrency": 1,
                            "retries": 0,
                        },
                        number=conversation.version,
                        user_text=request.text,
                        state="generating",
                        reserved_usd=self.profile.reservation_usd,
                        created_at=instant,
                        deadline_at=instant + timedelta(seconds=DEADLINE_SECONDS),
                    )
                    session.add(turn)
                    session.flush()
                    turn_id = turn.id
        if isinstance(outcome, MaterialError):
            raise outcome
        if turn_id is None:
            return outcome
        observed = {}
        try:
            # The admission transaction has committed; no lock spans provider HTTP.
            with Session(self.engine) as session, session.begin():
                authorize(session, actor, scope)
                turn = session.get(ChatTurn, turn_id, with_for_update=True)
                self._require_active(turn, started)
            result = OpenAIChat(self.provider).generate(payload)
            observed = result.usage
            with Session(self.engine) as session, session.begin():
                authorize(session, actor, scope)
                conversation = find_conversation(session, scope, conversation_id)
                turn = session.get(ChatTurn, turn_id, with_for_update=True)
                self._require_active(turn, started)
                turn.state, turn.assistant_text, turn.finished_at = (
                    "succeeded",
                    result.text,
                    now(),
                )
                for key, value in safe_usage(observed).items():
                    setattr(turn, key, value)
                session.flush()
                saved = document(session, conversation)
                # DB reads may wait: revalidate the original session and deadline.
                authorize(session, actor, scope)
                if (
                    turn.deadline_at <= now()
                    or time.monotonic() - started >= DEADLINE_SECONDS
                ):
                    raise ProviderError("operation_expired")
            return saved
        except ProviderError as error:
            observed.update(safe_usage(error.usage))
            state = self._finish(
                turn_id,
                "uncertain" if error.uncertain else "failed",
                error.code,
                observed,
            )
            raise MaterialError(409, f"chat_{state}") from None
        except (AuthError, MaterialError):
            self._finish(
                turn_id, "uncertain", "authorization_or_deadline_changed", observed
            )
            raise
        except Exception:
            self._finish(turn_id, "uncertain", "operation_interrupted", observed)
            raise MaterialError(409, "chat_uncertain") from None

    @staticmethod
    def _require_active(turn, started):
        if (
            turn.state != "generating"
            or turn.deadline_at <= now()
            or time.monotonic() - started >= DEADLINE_SECONDS
        ):
            raise ProviderError("operation_expired")

    def _finish(self, turn_id, state, code, observed):
        with Session(self.engine) as session, session.begin():
            turn = session.get(ChatTurn, turn_id, with_for_update=True)
            if turn.state == "generating":
                turn.state, turn.finished_at, turn.error_code = state, now(), code
                for key, value in safe_usage(observed).items():
                    setattr(turn, key, value)
            elif turn.state == "uncertain":
                for key, value in safe_usage(observed).items():
                    if getattr(turn, key) is None and value is not None:
                        setattr(turn, key, value)
            return turn.state
