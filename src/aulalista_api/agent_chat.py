"""Durable multi-agent teacher chat service: Orchestrator -> Per-Subject Agents."""

from __future__ import annotations

import hashlib
import re
from datetime import UTC, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID, uuid4, uuid5

from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator
from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    select,
    text,
)
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Mapped, Session, mapped_column

from aulalista_api.annexes import Annex
from aulalista_api.database import Base
from aulalista_api.materials import MaterialError, authorize
from aulalista_api.openai_agent_chat import (
    AgentChatProvider,
    AgentChatProviderError,
    AgentPromptContext,
    SubjectDigest,
    build_compact_digest,
    classify_message_subject,
    detect_delegated_subject,
    load_agent_chat_provider_from_env,
)
from aulalista_api.school_spaces import (
    TeacherSchoolSpaces,
    default_school_spaces_payload,
)

CHANNEL_KEY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9:._-]{1,179}$")
MAX_ACTIVE_TURNS_IN_PROMPT = 18
MAX_TURNS_RETURNED = 60


class AgentChatChannel(Base):
    __tablename__ = "agent_chat_channel"
    __table_args__ = (
        UniqueConstraint("scope_id", "channel_key", name="uq_agent_chat_scope_channel"),
        Index("ix_agent_chat_channel_scope_school", "scope_id", "school_id"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    scope_id: Mapped[UUID] = mapped_column(ForeignKey("personal_scope.id"))
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("principal.id"))
    channel_key: Mapped[str] = mapped_column(String(180))
    agent_kind: Mapped[str] = mapped_column(String(24))
    school_id: Mapped[str] = mapped_column(String(80))
    school_name: Mapped[str] = mapped_column(String(80))
    grade: Mapped[str] = mapped_column(String(40))
    shift: Mapped[str] = mapped_column(String(40), default="Matutino")
    subject_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    subject_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    context_notes: Mapped[str] = mapped_column(Text, default="")
    through_turn: Mapped[int] = mapped_column(default=0)
    context_revision: Mapped[int] = mapped_column(default=0)
    summary_topic: Mapped[str] = mapped_column(String(160), default="")
    digest: Mapped[str] = mapped_column(String(400), default="")
    version: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class AgentChatTurn(Base):
    __tablename__ = "agent_chat_turn"
    __table_args__ = (
        UniqueConstraint(
            "scope_id", "operation_id", name="uq_agent_chat_turn_operation"
        ),
        UniqueConstraint("channel_id", "number", name="uq_agent_chat_turn_number"),
        Index("ix_agent_chat_turn_channel_number", "channel_id", "number"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    channel_id: Mapped[UUID] = mapped_column(
        ForeignKey("agent_chat_channel.id", ondelete="CASCADE")
    )
    scope_id: Mapped[UUID] = mapped_column(ForeignKey("personal_scope.id"))
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("principal.id"))
    operation_id: Mapped[UUID]
    number: Mapped[int]
    context_revision: Mapped[int] = mapped_column(default=0)
    user_text: Mapped[str] = mapped_column(Text)
    assistant_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    state: Mapped[str] = mapped_column(String(24))
    error_code: Mapped[str | None] = mapped_column(String(120), nullable=True)
    model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    input_tokens: Mapped[int | None] = mapped_column(nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(nullable=True)
    estimated_cost_usd: Mapped[Decimal | None] = mapped_column(
        Numeric(18, 9), nullable=True
    )
    delegated_subject_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


def _validate_text(value: str, *, allow_empty: bool = False) -> str:
    if allow_empty and value == "":
        return value
    if not value.strip() or "\x00" in value or len(value.encode("utf-8")) > 8192:
        raise ValueError("invalid_text")
    return value


class AgentTurnRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=4096)
    expected_version: StrictInt = Field(default=0, ge=0, le=2_147_483_646)
    agent_kind: Literal["orchestrator", "subject"]
    school_id: str = Field(min_length=1, max_length=80)
    school_name: str = Field(min_length=1, max_length=80)
    grade: str = Field(min_length=1, max_length=40)
    shift: str = Field(default="Matutino", min_length=1, max_length=40)
    subject_id: str | None = Field(default=None, max_length=80)
    subject_name: str | None = Field(default=None, max_length=80)

    @field_validator("text")
    @classmethod
    def check_text(cls, value: str) -> str:
        return _validate_text(value)


class AgentContextRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    notes: str = Field(default="", max_length=4096)
    reset: bool = False
    agent_kind: Literal["orchestrator", "subject"]
    school_id: str = Field(min_length=1, max_length=80)
    school_name: str = Field(min_length=1, max_length=80)
    grade: str = Field(min_length=1, max_length=40)
    shift: str = Field(default="Matutino", min_length=1, max_length=40)
    subject_id: str | None = Field(default=None, max_length=80)
    subject_name: str | None = Field(default=None, max_length=80)

    @field_validator("notes")
    @classmethod
    def check_notes(cls, value: str) -> str:
        return _validate_text(value, allow_empty=True)


def parse_channel_key(
    channel_key: str,
) -> tuple[Literal["orchestrator", "subject"], str, str | None]:
    if not CHANNEL_KEY_RE.fullmatch(channel_key):
        raise MaterialError(422, "invalid_channel_key")
    if channel_key.startswith("orchestrator:"):
        school_id = channel_key.split(":", 1)[1].strip()
        if not school_id:
            raise MaterialError(422, "invalid_channel_key")
        return "orchestrator", school_id, None
    if channel_key.startswith("subject:"):
        parts = channel_key.split(":", 2)
        if len(parts) != 3 or not parts[1].strip() or not parts[2].strip():
            raise MaterialError(422, "invalid_channel_key")
        return "subject", parts[1].strip(), parts[2].strip()
    raise MaterialError(422, "invalid_channel_key")


def _channel_summary(channel: AgentChatChannel) -> dict:
    return {
        "id": str(channel.id),
        "channel_key": channel.channel_key,
        "agent_kind": channel.agent_kind,
        "school_id": channel.school_id,
        "school_name": channel.school_name,
        "grade": channel.grade,
        "shift": channel.shift,
        "subject_id": channel.subject_id,
        "subject_name": channel.subject_name,
        "version": channel.version,
        "context_revision": channel.context_revision,
        "through_turn": channel.through_turn,
        "context_notes": channel.context_notes,
        "summary_topic": channel.summary_topic,
        "digest": channel.digest,
        "created_at": channel.created_at.astimezone(UTC).isoformat(),
        "updated_at": channel.updated_at.astimezone(UTC).isoformat(),
    }


def _turn_payload(turn: AgentChatTurn) -> dict:
    return {
        "operation_id": str(turn.operation_id),
        "number": turn.number,
        "context_revision": turn.context_revision,
        "user_text": turn.user_text,
        "assistant_text": turn.assistant_text,
        "state": turn.state,
        "error_code": turn.error_code,
        "model": turn.model,
        "delegated_subject_id": turn.delegated_subject_id,
        "usage": {
            "input_tokens": turn.input_tokens,
            "output_tokens": turn.output_tokens,
            "estimated_cost_usd": (
                f"{turn.estimated_cost_usd.quantize(Decimal('0.000001')):.6f}"
                if turn.estimated_cost_usd is not None
                else None
            ),
        },
        "created_at": turn.created_at.astimezone(UTC).isoformat(),
    }


def _scope_spaces_data(session: Session, scope_id: UUID) -> dict:
    row = session.get(TeacherSchoolSpaces, scope_id)
    if row is not None and isinstance(row.payload, dict):
        return row.payload
    return default_school_spaces_payload()


def _recent_annex_titles(
    session: Session,
    scope_id: UUID,
    subject_name: str | None = None,
    limit: int = 5,
) -> tuple[str, ...]:
    query = select(Annex.title).where(Annex.scope_id == scope_id)
    if subject_name:
        query = query.where(func.lower(Annex.subject) == subject_name.strip().lower())
    rows = session.scalars(query.order_by(Annex.updated_at.desc()).limit(limit)).all()
    return tuple(title for title in rows if title)


def _school_subject_digests(
    session: Session,
    scope_id: UUID,
    school_id: str,
) -> tuple[tuple[SubjectDigest, ...], list[tuple[str, str]], tuple[str, ...]]:
    spaces = _scope_spaces_data(session, scope_id)
    schools = spaces.get("schools", [])
    target_school = next((sc for sc in schools if sc.get("id") == school_id), None)
    other_schools = tuple(
        f"{sc.get('shortName', '')} ({sc.get('grade', '')})"
        for sc in schools
        if sc.get("id") != school_id and sc.get("shortName")
    )

    channels = session.scalars(
        select(AgentChatChannel).where(
            AgentChatChannel.scope_id == scope_id,
            AgentChatChannel.school_id == school_id,
            AgentChatChannel.agent_kind == "subject",
        )
    ).all()
    by_subject = {ch.subject_id: ch for ch in channels if ch.subject_id}

    digests: list[SubjectDigest] = []
    subject_pairs: list[tuple[str, str]] = []
    seen_ids: set[str] = set()

    if target_school and isinstance(target_school.get("subjects"), list):
        for sub in target_school["subjects"]:
            sub_id = str(sub.get("id", "")).strip()
            sub_name = str(sub.get("name", "")).strip()
            if not sub_id or not sub_name:
                continue
            seen_ids.add(sub_id)
            subject_pairs.append((sub_id, sub_name))
            ch = by_subject.get(sub_id)
            active_turns = max(0, (ch.version - ch.through_turn)) if ch else 0
            digests.append(
                SubjectDigest(
                    subject_id=sub_id,
                    subject_name=sub_name,
                    turn_count=active_turns,
                    summary_topic=ch.summary_topic if ch else "",
                    digest=ch.digest if ch else "",
                    recent_annexes=_recent_annex_titles(
                        session, scope_id, sub_name, limit=3
                    ),
                )
            )

    for ch in channels:
        if ch.subject_id and ch.subject_id not in seen_ids and ch.subject_name:
            subject_pairs.append((ch.subject_id, ch.subject_name))
            active_turns = max(0, ch.version - ch.through_turn)
            digests.append(
                SubjectDigest(
                    subject_id=ch.subject_id,
                    subject_name=ch.subject_name,
                    turn_count=active_turns,
                    summary_topic=ch.summary_topic,
                    digest=ch.digest,
                    recent_annexes=_recent_annex_titles(
                        session, scope_id, ch.subject_name, limit=3
                    ),
                )
            )

    return tuple(digests), subject_pairs, other_schools


def _orchestrator_brief_for_subject(
    session: Session,
    scope_id: UUID,
    school_id: str,
) -> str:
    orch_key = f"orchestrator:{school_id}"
    orch = session.scalar(
        select(AgentChatChannel).where(
            AgentChatChannel.scope_id == scope_id,
            AgentChatChannel.channel_key == orch_key,
        )
    )
    if orch is None:
        return ""
    parts: list[str] = []
    if orch.context_notes.strip():
        parts.append(orch.context_notes.strip()[:220])
    if orch.digest.strip():
        parts.append(orch.digest.strip()[:220])
    return " · ".join(parts)[:360]


class AgentChatService:
    def __init__(
        self,
        engine: Engine,
        provider: AgentChatProvider | None = None,
    ) -> None:
        self.engine = engine
        self._explicit_provider = provider

    def _provider(self) -> AgentChatProvider:
        if self._explicit_provider is not None:
            return self._explicit_provider
        return load_agent_chat_provider_from_env()

    def capability(self, actor: UUID, scope_id: UUID) -> dict:
        with Session(self.engine) as session:
            authorize(session, actor, scope_id)
        provider = self._provider()
        return {
            "available": provider.is_configured,
            "model": provider.model_name if provider.is_configured else None,
        }

    def list_channels(
        self,
        actor: UUID,
        scope_id: UUID,
        *,
        school_id: str | None = None,
    ) -> dict:
        with Session(self.engine) as session:
            authorize(session, actor, scope_id)
            query = select(AgentChatChannel).where(
                AgentChatChannel.scope_id == scope_id
            )
            if school_id:
                query = query.where(AgentChatChannel.school_id == school_id)
            rows = session.scalars(
                query.order_by(AgentChatChannel.updated_at.desc())
            ).all()
            return {"items": [_channel_summary(row) for row in rows]}

    def get_channel(
        self,
        actor: UUID,
        scope_id: UUID,
        channel_key: str,
    ) -> dict:
        agent_kind, school_id, subject_id = parse_channel_key(channel_key)
        with Session(self.engine) as session:
            authorize(session, actor, scope_id)
            channel = session.scalar(
                select(AgentChatChannel).where(
                    AgentChatChannel.scope_id == scope_id,
                    AgentChatChannel.channel_key == channel_key,
                )
            )
            subject_digests_data: list[dict] = []
            orchestrator_brief = ""
            if agent_kind == "orchestrator":
                digests, _, _ = _school_subject_digests(session, scope_id, school_id)
                subject_digests_data = [
                    {
                        "subject_id": d.subject_id,
                        "subject_name": d.subject_name,
                        "turn_count": d.turn_count,
                        "summary_topic": d.summary_topic,
                        "digest": d.digest,
                    }
                    for d in digests
                ]
            else:
                orchestrator_brief = _orchestrator_brief_for_subject(
                    session, scope_id, school_id
                )

            if channel is None:
                return {
                    "channel": {
                        "id": None,
                        "channel_key": channel_key,
                        "agent_kind": agent_kind,
                        "school_id": school_id,
                        "school_name": "",
                        "grade": "",
                        "shift": "Matutino",
                        "subject_id": subject_id,
                        "subject_name": None,
                        "version": 0,
                        "context_revision": 0,
                        "through_turn": 0,
                        "context_notes": "",
                        "summary_topic": "",
                        "digest": "",
                        "created_at": None,
                        "updated_at": None,
                    },
                    "turns": [],
                    "subject_digests": subject_digests_data,
                    "orchestrator_brief": orchestrator_brief,
                }

            turns = session.scalars(
                select(AgentChatTurn)
                .where(AgentChatTurn.channel_id == channel.id)
                .order_by(AgentChatTurn.number.asc())
                .limit(MAX_TURNS_RETURNED)
            ).all()
            return {
                "channel": _channel_summary(channel),
                "turns": [_turn_payload(t) for t in turns],
                "subject_digests": subject_digests_data,
                "orchestrator_brief": orchestrator_brief,
            }

    def update_context(
        self,
        actor: UUID,
        scope_id: UUID,
        channel_key: str,
        operation_id: UUID,
        request: AgentContextRequest,
    ) -> dict:
        agent_kind, school_id, subject_id = parse_channel_key(channel_key)
        if request.agent_kind != agent_kind or request.school_id != school_id:
            raise MaterialError(422, "channel_context_mismatch")
        if agent_kind == "subject" and request.subject_id != subject_id:
            raise MaterialError(422, "channel_context_mismatch")

        now = datetime.now(UTC)
        with Session(self.engine) as session, session.begin():
            principal = authorize(session, actor, scope_id)
            channel = self._get_or_create_channel(
                session,
                principal=principal,
                scope_id=scope_id,
                channel_key=channel_key,
                agent_kind=agent_kind,
                school_id=school_id,
                school_name=request.school_name.strip(),
                grade=request.grade.strip(),
                shift=request.shift.strip(),
                subject_id=subject_id,
                subject_name=request.subject_name.strip()
                if request.subject_name
                else None,
                now=now,
            )
            channel.context_revision += 1
            channel.through_turn = channel.version
            if request.reset:
                channel.context_notes = ""
                channel.summary_topic = ""
                channel.digest = ""
            else:
                channel.context_notes = request.notes.strip()
            channel.updated_at = now
            session.flush()
            return {
                "channel": _channel_summary(channel),
                "operation_id": str(operation_id),
            }

    def send_turn(
        self,
        actor: UUID,
        scope_id: UUID,
        channel_key: str,
        operation_id: UUID,
        request: AgentTurnRequest,
    ) -> dict:
        agent_kind, school_id, subject_id = parse_channel_key(channel_key)
        if request.agent_kind != agent_kind or request.school_id != school_id:
            raise MaterialError(422, "channel_context_mismatch")
        if agent_kind == "subject" and (
            request.subject_id != subject_id or not request.subject_name
        ):
            raise MaterialError(422, "channel_context_mismatch")

        provider = self._provider()
        lock_key = int.from_bytes(
            hashlib.sha256(b"agent-chat-v1" + scope_id.bytes).digest()[:8],
            "big",
            signed=True,
        )

        turn_id: UUID | None = None
        channel_id: UUID | None = None
        principal_id: UUID | None = None
        prompt_context: AgentPromptContext | None = None
        messages: list[dict[str, str]] = []
        subject_pairs: list[tuple[str, str]] = []
        routed_subject: tuple[str, str] | None = None

        with Session(self.engine) as session, session.begin():
            principal = authorize(session, actor, scope_id)
            principal_id = principal
            session.execute(
                text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_key}
            )
            existing = session.scalar(
                select(AgentChatTurn).where(
                    AgentChatTurn.scope_id == scope_id,
                    AgentChatTurn.operation_id == operation_id,
                )
            )
            if existing is not None:
                channel = session.get(AgentChatChannel, existing.channel_id)
                return {
                    "channel": _channel_summary(channel),
                    "turn": _turn_payload(existing),
                }

            if not provider.is_configured:
                raise MaterialError(503, "chat_unavailable")

            spent = session.scalar(
                select(
                    func.coalesce(func.sum(AgentChatTurn.estimated_cost_usd), 0)
                ).where(AgentChatTurn.scope_id == scope_id)
            )
            if Decimal(spent) >= provider.scope_budget_usd:
                raise MaterialError(429, "chat_budget_exhausted")

            now = datetime.now(UTC)
            channel = self._get_or_create_channel(
                session,
                principal=principal,
                scope_id=scope_id,
                channel_key=channel_key,
                agent_kind=agent_kind,
                school_id=school_id,
                school_name=request.school_name.strip(),
                grade=request.grade.strip(),
                shift=request.shift.strip(),
                subject_id=subject_id,
                subject_name=request.subject_name.strip()
                if request.subject_name
                else None,
                now=now,
            )
            if request.expected_version != channel.version:
                raise MaterialError(409, "conflict")

            from aulalista_api.curriculum import resolve_curricular_context_text

            if agent_kind == "orchestrator":
                digests, subject_pairs, other_schools = _school_subject_digests(
                    session, scope_id, school_id
                )
                routed_subject = classify_message_subject(
                    request.text, subject_pairs, school_id
                )
                if routed_subject is not None:
                    routed_sub_id, routed_sub_name = routed_subject
                    sub_key = f"subject:{school_id}:{routed_sub_id}"
                    sub_channel = session.scalar(
                        select(AgentChatChannel).where(
                            AgentChatChannel.scope_id == scope_id,
                            AgentChatChannel.channel_key == sub_key,
                        )
                    )
                    if sub_channel is not None:
                        prior_turns = session.scalars(
                            select(AgentChatTurn)
                            .where(
                                AgentChatTurn.channel_id == sub_channel.id,
                                AgentChatTurn.number > sub_channel.through_turn,
                                AgentChatTurn.state == "succeeded",
                            )
                            .order_by(AgentChatTurn.number.desc())
                            .limit(MAX_ACTIVE_TURNS_IN_PROMPT)
                        ).all()
                        prior_turns.reverse()
                        for prior in prior_turns:
                            if prior.assistant_text:
                                messages.append(
                                    {"role": "user", "content": prior.user_text}
                                )
                                messages.append(
                                    {
                                        "role": "assistant",
                                        "content": prior.assistant_text,
                                    }
                                )
                    messages.append({"role": "user", "content": request.text})

                    curricular_summary = resolve_curricular_context_text(
                        session, scope_id, school_id, routed_sub_id
                    )
                    sub_notes = sub_channel.context_notes if sub_channel else ""
                    combined_notes = "\n\n".join(
                        part
                        for part in (curricular_summary, sub_notes)
                        if part and part.strip()
                    )
                    prompt_context = AgentPromptContext(
                        agent_kind="subject",
                        school_name=channel.school_name,
                        grade=channel.grade,
                        shift=channel.shift,
                        subject_name=routed_sub_name,
                        context_notes=combined_notes,
                        orchestrator_brief=_orchestrator_brief_for_subject(
                            session, scope_id, school_id
                        ),
                        recent_subject_annexes=_recent_annex_titles(
                            session, scope_id, routed_sub_name, limit=5
                        ),
                    )
                else:
                    # General coordination mode: use only general turns on the main channel
                    # plus compact subject digests so individual subject chatter stays isolated.
                    prior_turns = session.scalars(
                        select(AgentChatTurn)
                        .where(
                            AgentChatTurn.channel_id == channel.id,
                            AgentChatTurn.number > channel.through_turn,
                            AgentChatTurn.state == "succeeded",
                            AgentChatTurn.delegated_subject_id.is_(None),
                        )
                        .order_by(AgentChatTurn.number.desc())
                        .limit(MAX_ACTIVE_TURNS_IN_PROMPT)
                    ).all()
                    prior_turns.reverse()
                    for prior in prior_turns:
                        if prior.assistant_text:
                            messages.append(
                                {"role": "user", "content": prior.user_text}
                            )
                            messages.append(
                                {
                                    "role": "assistant",
                                    "content": prior.assistant_text,
                                }
                            )
                    messages.append({"role": "user", "content": request.text})

                    curricular_summary = resolve_curricular_context_text(
                        session, scope_id, school_id, None
                    )
                    combined_notes = "\n\n".join(
                        part
                        for part in (curricular_summary, channel.context_notes)
                        if part and part.strip()
                    )
                    prompt_context = AgentPromptContext(
                        agent_kind="orchestrator",
                        school_name=channel.school_name,
                        grade=channel.grade,
                        shift=channel.shift,
                        context_notes=combined_notes,
                        subject_digests=digests,
                        other_schools=other_schools,
                    )
            else:
                # Direct subject channel call (kept for API compatibility & internal isolation).
                prior_turns = session.scalars(
                    select(AgentChatTurn)
                    .where(
                        AgentChatTurn.channel_id == channel.id,
                        AgentChatTurn.number > channel.through_turn,
                        AgentChatTurn.state == "succeeded",
                    )
                    .order_by(AgentChatTurn.number.desc())
                    .limit(MAX_ACTIVE_TURNS_IN_PROMPT)
                ).all()
                prior_turns.reverse()
                for prior in prior_turns:
                    if prior.assistant_text:
                        messages.append({"role": "user", "content": prior.user_text})
                        messages.append(
                            {"role": "assistant", "content": prior.assistant_text}
                        )
                messages.append({"role": "user", "content": request.text})

                curricular_summary = resolve_curricular_context_text(
                    session, scope_id, school_id, channel.subject_id
                )
                combined_notes = "\n\n".join(
                    part
                    for part in (curricular_summary, channel.context_notes)
                    if part and part.strip()
                )
                prompt_context = AgentPromptContext(
                    agent_kind="subject",
                    school_name=channel.school_name,
                    grade=channel.grade,
                    shift=channel.shift,
                    subject_name=channel.subject_name,
                    context_notes=combined_notes,
                    orchestrator_brief=_orchestrator_brief_for_subject(
                        session, scope_id, school_id
                    ),
                    recent_subject_annexes=_recent_annex_titles(
                        session, scope_id, channel.subject_name, limit=5
                    ),
                )

            channel.version += 1
            channel.updated_at = now
            turn = AgentChatTurn(
                channel_id=channel.id,
                scope_id=scope_id,
                actor_id=principal,
                operation_id=operation_id,
                number=channel.version,
                context_revision=channel.context_revision,
                user_text=request.text,
                assistant_text=None,
                state="generating",
                created_at=now,
            )
            session.add(turn)
            session.flush()
            turn_id = turn.id
            channel_id = channel.id

        # Execute external OpenAI request outside any DB transaction/lock.
        assert (
            prompt_context is not None
            and turn_id is not None
            and channel_id is not None
            and principal_id is not None
        )
        try:
            reply = provider.generate(context=prompt_context, messages=messages)
        except AgentChatProviderError as error:
            self._mark_failed(turn_id, error.code)
            raise MaterialError(error.status, error.code) from None
        except Exception:
            self._mark_failed(turn_id, "chat_transport_error")
            raise MaterialError(502, "chat_transport_error") from None

        finished = datetime.now(UTC)
        topic, digest = build_compact_digest(request.text, reply.text)
        delegated_subject_id = (
            routed_subject[0]
            if routed_subject is not None
            else (
                detect_delegated_subject(request.text, reply.text, subject_pairs)
                if agent_kind == "orchestrator"
                else None
            )
        )

        with Session(self.engine) as session, session.begin():
            authorize(session, actor, scope_id)
            turn = session.get(AgentChatTurn, turn_id, with_for_update=True)
            channel = session.get(AgentChatChannel, channel_id, with_for_update=True)
            assert turn is not None and channel is not None
            turn.state = "succeeded"
            turn.assistant_text = reply.text
            turn.model = reply.model
            turn.input_tokens = reply.input_tokens
            turn.output_tokens = reply.output_tokens
            turn.estimated_cost_usd = reply.estimated_cost_usd
            turn.delegated_subject_id = delegated_subject_id
            turn.finished_at = finished
            if routed_subject is not None:
                # Persist the turn inside the isolated internal subject channel so future
                # turns for this subject keep their own history and compact digest without
                # polluting other subjects or double-counting token cost.
                routed_sub_id, routed_sub_name = routed_subject
                sub_channel = self._get_or_create_channel(
                    session,
                    principal=principal_id,
                    scope_id=scope_id,
                    channel_key=f"subject:{school_id}:{routed_sub_id}",
                    agent_kind="subject",
                    school_id=school_id,
                    school_name=channel.school_name,
                    grade=channel.grade,
                    shift=channel.shift,
                    subject_id=routed_sub_id,
                    subject_name=routed_sub_name,
                    now=finished,
                )
                sub_channel.version += 1
                sub_channel.summary_topic = topic
                sub_channel.digest = digest
                sub_channel.updated_at = finished
                mirror_op_id = uuid5(operation_id, f"mirror:{routed_sub_id}")
                mirror_exists = session.scalar(
                    select(AgentChatTurn.id).where(
                        AgentChatTurn.scope_id == scope_id,
                        AgentChatTurn.operation_id == mirror_op_id,
                    )
                )
                if mirror_exists is None:
                    session.add(
                        AgentChatTurn(
                            channel_id=sub_channel.id,
                            scope_id=scope_id,
                            actor_id=principal_id,
                            operation_id=mirror_op_id,
                            number=sub_channel.version,
                            context_revision=sub_channel.context_revision,
                            user_text=request.text,
                            assistant_text=reply.text,
                            state="succeeded",
                            model=reply.model,
                            input_tokens=None,
                            output_tokens=None,
                            estimated_cost_usd=None,
                            delegated_subject_id=None,
                            created_at=finished,
                            finished_at=finished,
                        )
                    )
                channel.updated_at = finished
            else:
                channel.summary_topic = topic
                channel.digest = digest
                channel.updated_at = finished
            session.flush()
            return {
                "channel": _channel_summary(channel),
                "turn": _turn_payload(turn),
            }

    def _mark_failed(self, turn_id: UUID, error_code: str) -> None:
        with Session(self.engine) as session, session.begin():
            turn = session.get(AgentChatTurn, turn_id, with_for_update=True)
            if turn is not None and turn.state == "generating":
                turn.state = "failed"
                turn.error_code = error_code[:120]
                turn.finished_at = datetime.now(UTC)

    @staticmethod
    def _get_or_create_channel(
        session: Session,
        *,
        principal: UUID,
        scope_id: UUID,
        channel_key: str,
        agent_kind: str,
        school_id: str,
        school_name: str,
        grade: str,
        shift: str,
        subject_id: str | None,
        subject_name: str | None,
        now: datetime,
    ) -> AgentChatChannel:
        channel = session.scalar(
            select(AgentChatChannel)
            .where(
                AgentChatChannel.scope_id == scope_id,
                AgentChatChannel.channel_key == channel_key,
            )
            .with_for_update()
        )
        if channel is None:
            channel = AgentChatChannel(
                scope_id=scope_id,
                actor_id=principal,
                channel_key=channel_key,
                agent_kind=agent_kind,
                school_id=school_id,
                school_name=school_name,
                grade=grade,
                shift=shift,
                subject_id=subject_id,
                subject_name=subject_name,
                context_notes="",
                through_turn=0,
                context_revision=0,
                summary_topic="",
                digest="",
                version=0,
                created_at=now,
                updated_at=now,
            )
            session.add(channel)
            session.flush()
        else:
            channel.school_name = school_name
            channel.grade = grade
            channel.shift = shift
            if subject_name:
                channel.subject_name = subject_name
        return channel
