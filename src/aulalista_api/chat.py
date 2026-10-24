"""Private durable chat; each reserved provider step dispatches at most once."""

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
from aulalista_api.chat_compaction import answer_payload, plan_context
from aulalista_api.chat_models import (
    ActiveConversation,
    ChatTurn,
    CompactionStep,
    ContextRequest,
    ContextRevision,
    Conversation,
    OpenOperation,
    TurnRequest,
)
from aulalista_api.materials import MaterialError, authorize
from aulalista_api.openai_chat import OpenAIChat, estimated_cost, prepare_summary
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

MAX_HISTORY_BYTES = 262144
MAX_VERSION = 2_147_483_647


def summary(conversation, active_id):
    return {
        "id": str(conversation.id),
        "title": conversation.title,
        "version": conversation.version,
        "context_revision": conversation.context_revision,
        "active": conversation.id == active_id,
        "created_at": conversation.created_at.astimezone(UTC).isoformat(),
        "updated_at": conversation.updated_at.astimezone(UTC).isoformat(),
    }


def active_id(session, scope):
    return session.scalar(
        select(ActiveConversation.conversation_id).where(
            ActiveConversation.scope_id == scope
        )
    )


def context_document(revision):
    return {
        "revision": revision.revision,
        "previous_revision": revision.revision - 1 if revision.revision else None,
        "through_turn": revision.through_turn,
        "notes": revision.notes,
        "origin": revision.origin,
        "summary": revision.summary,
        "operation_id": str(revision.operation_id) if revision.operation_id else None,
        "created_at": revision.created_at.astimezone(UTC).isoformat(),
    }


def turn_document(session, turn):
    observations = [
        {"input_tokens": turn.input_tokens, "output_tokens": turn.output_tokens}
    ]
    if turn.configuration.get("summary_steps"):
        observations += [
            step.usage
            for step in session.scalars(
                select(CompactionStep).where(CompactionStep.turn_id == turn.id)
            )
        ]
    costs = [
        estimated_cost(item.get("input_tokens"), item.get("output_tokens"))
        for item in observations
    ]
    cost = sum(costs) if all(value is not None for value in costs) else None
    totals = {
        key: sum(item[key] for item in observations)
        if all(item.get(key) is not None for item in observations)
        else None
        for key in ("input_tokens", "output_tokens")
    }
    return {
        "operation_id": str(turn.operation_id),
        "number": turn.number,
        "context_revision": turn.context_revision,
        "user_text": turn.user_text,
        "assistant_text": turn.assistant_text,
        "state": turn.state,
        "error_code": turn.error_code,
        "usage": {
            "input_tokens": totals["input_tokens"],
            "output_tokens": totals["output_tokens"],
            "estimated_cost_usd": format(cost, "f") if cost is not None else None,
            "reserved_usd": str(turn.reserved_usd),
        },
    }


def document(session, conversation, *, cursor=None, limit=20, turn=None):
    if type(limit) is not int or not 1 <= limit <= 50:
        raise MaterialError(422, "invalid_request")
    context = session.get(
        ContextRevision, (conversation.id, conversation.context_revision)
    )
    result = {
        "conversation": summary(
            conversation, active_id(session, conversation.scope_id)
        ),
        "context": context_document(context),
        "turns": [],
        "next_cursor": None,
    }
    if turn is not None:
        result["turns"] = [turn_document(session, turn)]
        return result
    query = select(ChatTurn).where(ChatTurn.conversation_id == conversation.id)
    if cursor is not None:
        if (
            type(cursor) is not int
            or cursor < 1
            or session.scalar(
                select(ChatTurn.id).where(
                    ChatTurn.conversation_id == conversation.id,
                    ChatTurn.number == cursor,
                )
            )
            is None
        ):
            raise MaterialError(404, "not_found")
        query = query.where(ChatTurn.number < cursor)
    # At most 51 rows are fetched; the complete JSON envelope has a separate cap.
    rows = session.scalars(
        query.order_by(ChatTurn.number.desc()).limit(limit + 1)
    ).all()
    for row in rows[:limit]:
        result["turns"].insert(0, turn_document(session, row))
        result["next_cursor"] = str(row.number)
        if len(canonical(result)) > MAX_HISTORY_BYTES:
            result["turns"].pop(0)
            break
    if len(result["turns"]) == len(rows):
        result["next_cursor"] = None
    elif result["turns"]:
        result["next_cursor"] = str(result["turns"][0]["number"])
    return result


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
                hashlib.sha256(b"chat-open-v2" + scope.bytes).digest()[:8],
                "big",
                signed=True,
            )
            session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock})
            receipt = session.get(OpenOperation, (scope, operation))
            selected = receipt.conversation_id if receipt else active_id(session, scope)
            if selected is None:
                instant = now()
                conversation = Conversation(
                    scope_id=scope,
                    actor_id=principal,
                    operation_id=operation,
                    title="Nueva conversación",
                    version=0,
                    context_revision=0,
                    created_at=instant,
                    updated_at=instant,
                )
                session.add(conversation)
                session.flush()
                session.add(
                    ContextRevision(
                        conversation_id=conversation.id,
                        revision=0,
                        scope_id=scope,
                        actor_id=principal,
                        through_turn=0,
                        notes="",
                        origin="initial",
                        created_at=instant,
                    )
                )
                session.add(
                    ActiveConversation(scope_id=scope, conversation_id=conversation.id)
                )
            else:
                conversation = find_conversation(session, scope, selected)
                expire_conversation(session, conversation)
            if receipt is None:
                session.add(
                    OpenOperation(
                        scope_id=scope,
                        operation_id=operation,
                        conversation_id=conversation.id,
                    )
                )
            session.flush()
            saved = document(session, conversation)
            authorize(session, actor, scope)
            return saved

    def active(self, actor, scope):
        with Session(self.engine) as session, session.begin():
            authorize(session, actor, scope)
            conversation = find_conversation(session, scope, active_id(session, scope))
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
            selected = active_id(session, scope)
            return {
                "items": [summary(row, selected) for row in rows[:limit]],
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
        cursor=None,
        limit=20,
    ):
        with Session(self.engine) as session, session.begin():
            authorize(session, actor, scope)
            if creation_operation is not None:
                receipt = session.get(OpenOperation, (scope, creation_operation))
                conversation_id = receipt.conversation_id if receipt else None
            conversation = find_conversation(session, scope, conversation_id)
            turn = None
            if turn_operation is not None:
                turn = session.scalar(
                    select(ChatTurn).where(
                        ChatTurn.conversation_id == conversation.id,
                        ChatTurn.operation_id == turn_operation,
                    )
                )
                if turn is None:
                    raise MaterialError(404, "not_found")
            expire_conversation(session, conversation)
            return document(
                session, conversation, cursor=cursor, limit=limit, turn=turn
            )

    def context_operation(self, actor, scope, conversation_id, operation):
        with Session(self.engine) as session, session.begin():
            authorize(session, actor, scope)
            conversation = find_conversation(session, scope, conversation_id)
            revision = session.scalar(
                select(ContextRevision).where(
                    ContextRevision.scope_id == scope,
                    ContextRevision.conversation_id == conversation_id,
                    ContextRevision.operation_id == operation,
                )
            )
            if revision is None:
                raise MaterialError(404, "not_found")
            return {
                "conversation": summary(conversation, active_id(session, scope)),
                "context": context_document(revision),
            }

    def context_revision(self, actor, scope, conversation_id, revision):
        with Session(self.engine) as session, session.begin():
            authorize(session, actor, scope)
            conversation = find_conversation(session, scope, conversation_id)
            context = session.get(ContextRevision, (conversation_id, revision))
            if context is None:
                raise MaterialError(404, "not_found")
            steps = []
            if context.summary:
                turn = session.scalar(
                    select(ChatTurn).where(
                        ChatTurn.conversation_id == conversation_id,
                        ChatTurn.operation_id == context.operation_id,
                    )
                )
                for step in session.scalars(
                    select(CompactionStep)
                    .where(CompactionStep.turn_id == turn.id)
                    .order_by(CompactionStep.number)
                ):
                    cost = estimated_cost(
                        step.usage.get("input_tokens"), step.usage.get("output_tokens")
                    )
                    steps.append(
                        {
                            "number": step.number,
                            "payload_sha256": step.payload_sha256,
                            "sources": step.sources,
                            "summary": step.summary,
                            "usage": {
                                "input_tokens": step.usage.get("input_tokens"),
                                "output_tokens": step.usage.get("output_tokens"),
                                "estimated_cost_usd": format(cost, "f")
                                if cost is not None
                                else None,
                                "reserved_usd": turn.configuration[
                                    "per_request_reservation_usd"
                                ],
                            },
                        }
                    )
            result = {
                "conversation": summary(conversation, active_id(session, scope)),
                "context": context_document(context),
                "steps": steps,
            }
            if len(canonical(result)) > MAX_HISTORY_BYTES:
                raise MaterialError(413, "chat_context_too_large")
            authorize(session, actor, scope)
            return result

    def update_context(self, actor, scope, conversation_id, operation, request):
        if not isinstance(request, ContextRequest):
            raise MaterialError(422, "invalid_request")
        fingerprint = hashlib.sha256(
            canonical({"conversation_id": str(conversation_id), **request.model_dump()})
        ).hexdigest()
        outcome = None
        with Session(self.engine) as session, session.begin():
            principal = authorize(session, actor, scope)
            conversation = find_conversation(session, scope, conversation_id)
            expire_conversation(session, conversation)
            revision = session.scalar(
                select(ContextRevision).where(
                    ContextRevision.scope_id == scope,
                    ContextRevision.operation_id == operation,
                )
            )
            if revision is not None:
                if revision.request_fingerprint != fingerprint:
                    raise MaterialError(409, "conflict")
            elif active_id(session, scope) != conversation.id:
                raise MaterialError(409, "chat_archived")
            elif (
                request.expected_version != conversation.version
                or request.expected_context_revision != conversation.context_revision
            ):
                raise MaterialError(409, "conflict")
            elif (
                session.scalar(
                    select(ChatTurn.id)
                    .where(
                        ChatTurn.conversation_id == conversation.id,
                        ChatTurn.state.in_(["generating", "uncertain"]),
                    )
                    .limit(1)
                )
                is not None
            ):
                outcome = MaterialError(409, "chat_busy")
            else:
                instant = now()
                conversation.context_revision += 1
                conversation.updated_at = instant
                session.flush()
                revision = ContextRevision(
                    conversation_id=conversation_id,
                    revision=conversation.context_revision,
                    scope_id=scope,
                    actor_id=principal,
                    operation_id=operation,
                    request_fingerprint=fingerprint,
                    through_turn=conversation.version,
                    notes=request.notes,
                    origin="manual" if request.notes else "reset",
                    created_at=instant,
                )
                session.add(revision)
                session.flush()
            if outcome is None:
                outcome = {
                    "conversation": summary(conversation, active_id(session, scope)),
                    "context": context_document(revision),
                }
            authorize(session, actor, scope)
        if isinstance(outcome, MaterialError):
            raise outcome
        return outcome

    def write(self, actor, scope, conversation_id, operation, request):
        if not isinstance(request, TurnRequest):
            raise MaterialError(422, "invalid_request")
        fingerprint = hashlib.sha256(
            canonical(
                {
                    "conversation_id": str(conversation_id),
                    **{
                        k: v
                        for k, v in request.model_dump().items()
                        if k != "expected_context_revision" or v != 0
                    },
                }
            )
        ).hexdigest()
        started = time.monotonic()
        outcome, turn_id = None, None
        with Session(self.engine, expire_on_commit=False) as session, session.begin():
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
                    outcome = document(session, conversation, turn=previous)
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
                    or request.expected_context_revision
                    != conversation.context_revision
                ):
                    raise MaterialError(409, "conflict")
                if active_id(session, scope) != conversation.id:
                    raise MaterialError(409, "chat_archived")
                if conversation.version >= MAX_VERSION:
                    raise MaterialError(422, "chat_limit_reached")
                if not self._enabled_for(principal, scope):
                    raise MaterialError(503, "chat_unavailable")
                payload, context, groups = plan_context(
                    session, conversation, request.text
                )
                reserve = self.profile.reservation_usd * (len(groups) + 1)
                if budget_busy(session):
                    outcome = MaterialError(409, "chat_busy")
                elif reserved_total(session) + reserve > self.profile.budget_usd:
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
                            "version": "private-chat-compaction-v1",
                            "provider_payload": {
                                k: v for k, v in payload.items() if k != "input"
                            },
                            "count_strategy": "window-v1",
                            "count_requests": 0,
                            "generation_requests": len(groups) + 1,
                            "summary_steps": len(groups),
                            "budget_usd": str(self.profile.budget_usd),
                            "additional_reserve_usd": str(
                                self.profile.additional_reserve_usd
                            ),
                            "reservation_usd": str(reserve),
                            "per_request_reservation_usd": str(
                                self.profile.reservation_usd
                            ),
                            "max_input_tokens": MODEL_CONTEXT_TOKENS,
                            "max_output_tokens": MAX_OUTPUT_TOKENS,
                            "deadline_seconds": DEADLINE_SECONDS,
                            "concurrency": 1,
                            "retries": 0,
                        },
                        number=conversation.version,
                        context_revision=conversation.context_revision,
                        user_text=request.text,
                        state="generating",
                        reserved_usd=reserve,
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
        observed, observed_step = {}, None
        try:
            # The admission transaction has committed; no lock spans provider HTTP.
            with Session(self.engine) as session, session.begin():
                authorize(session, actor, scope)
                turn = session.get(ChatTurn, turn_id, with_for_update=True)
                self._require_active(turn, started)
            compacted = context.summary["text"] if context.summary else ""
            for number, fragments in enumerate(groups, 1):
                with Session(self.engine) as session, session.begin():
                    authorize(session, actor, scope)
                    turn = session.get(ChatTurn, turn_id, with_for_update=True)
                    self._require_active(turn, started)
                payload = prepare_summary(
                    {"previous_summary": compacted, "fragments": fragments}
                )
                observed_step = number
                summarized = OpenAIChat(self.provider).summarize(payload)
                observed = summarized.usage
                with Session(self.engine) as session, session.begin():
                    authorize(session, actor, scope)
                    turn = session.get(ChatTurn, turn_id, with_for_update=True)
                    self._require_active(turn, started)
                    session.add(
                        CompactionStep(
                            turn_id=turn_id,
                            number=number,
                            payload_sha256=hashlib.sha256(_encode(payload)).hexdigest(),
                            sources=[
                                {k: v for k, v in fragment.items() if k != "text"}
                                for fragment in fragments
                            ],
                            summary=summarized.text,
                            usage=safe_usage(observed),
                        )
                    )
                    session.flush()
                    authorize(session, actor, scope)
                    self._require_active(turn, started)
                compacted, observed, observed_step = summarized.text, {}, None
            if groups:
                payload = answer_payload(context.notes, compacted, [], request.text)
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
                if groups:
                    conversation.context_revision += 1
                    conversation.updated_at = now()
                    session.flush()
                    session.add(
                        ContextRevision(
                            conversation_id=conversation.id,
                            revision=conversation.context_revision,
                            scope_id=scope,
                            actor_id=principal,
                            operation_id=operation,
                            request_fingerprint=fingerprint,
                            through_turn=turn.number - 1,
                            notes=context.notes,
                            origin="summary",
                            summary={
                                "text": compacted,
                                "from_turn": context.through_turn + 1,
                                "steps": len(groups),
                            },
                            created_at=now(),
                        )
                    )
                    session.flush()
                saved = document(session, conversation, turn=turn)
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
                observed_step,
            )
            raise MaterialError(409, f"chat_{state}") from None
        except (AuthError, MaterialError):
            self._finish(
                turn_id,
                "uncertain",
                "authorization_or_deadline_changed",
                observed,
                observed_step,
            )
            raise
        except Exception:
            self._finish(
                turn_id, "uncertain", "operation_interrupted", observed, observed_step
            )
            raise MaterialError(409, "chat_uncertain") from None

    @staticmethod
    def _require_active(turn, started):
        if (
            turn.state != "generating"
            or turn.deadline_at <= now()
            or time.monotonic() - started >= DEADLINE_SECONDS
        ):
            raise ProviderError("operation_expired")

    def _finish(self, turn_id, state, code, observed, observed_step=None):
        with Session(self.engine) as session, session.begin():
            turn = session.get(ChatTurn, turn_id, with_for_update=True)
            if (
                observed_step is not None
                and session.get(CompactionStep, (turn_id, observed_step)) is not None
            ):
                observed = {}
            if turn.state == "generating":
                turn.state, turn.finished_at, turn.error_code = state, now(), code
                for key, value in safe_usage(observed).items():
                    setattr(turn, key, value)
            elif turn.state == "uncertain":
                for key, value in safe_usage(observed).items():
                    if getattr(turn, key) is None and value is not None:
                        setattr(turn, key, value)
            return turn.state
