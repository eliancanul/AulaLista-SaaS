"""Private conversations and retained, single-dispatch turns."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator
from sqlalchemy import (
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Numeric,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from aulalista_api.database import Base


class CreateConversation(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TurnRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    text: str = Field(min_length=1, max_length=4096)
    expected_version: StrictInt = Field(ge=0, le=2_147_483_646)
    expected_context_revision: StrictInt = Field(default=0, ge=0, le=2_147_483_646)

    @field_validator("text")
    @classmethod
    def bounded_text(cls, value):
        try:
            if not value.strip() or "\x00" in value or len(value.encode()) > 8192:
                raise ValueError
        except UnicodeError:
            raise ValueError from None
        return value


class ContextRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    expected_version: StrictInt = Field(ge=0, le=2_147_483_647)
    expected_context_revision: StrictInt = Field(ge=0, le=2_147_483_646)
    notes: str = Field(max_length=4096)

    @field_validator("notes")
    @classmethod
    def bounded_notes(cls, value):
        if value == "":
            return value
        return TurnRequest.bounded_text(value)


class Conversation(Base):
    __tablename__ = "chat_conversation"
    __table_args__ = (
        UniqueConstraint("id", "scope_id", name="uq_chat_conversation_scope"),
        UniqueConstraint("scope_id", "operation_id", name="uq_chat_create_operation"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    scope_id: Mapped[UUID] = mapped_column(ForeignKey("personal_scope.id"))
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("principal.id"))
    operation_id: Mapped[UUID]
    title: Mapped[str]
    version: Mapped[int]
    context_revision: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ActiveConversation(Base):
    __tablename__ = "chat_active_conversation"
    __table_args__ = (
        ForeignKeyConstraint(
            ["conversation_id", "scope_id"],
            ["chat_conversation.id", "chat_conversation.scope_id"],
        ),
    )
    scope_id: Mapped[UUID] = mapped_column(primary_key=True)
    conversation_id: Mapped[UUID]


class OpenOperation(Base):
    __tablename__ = "chat_open_operation"
    __table_args__ = (
        ForeignKeyConstraint(
            ["conversation_id", "scope_id"],
            ["chat_conversation.id", "chat_conversation.scope_id"],
        ),
    )
    scope_id: Mapped[UUID] = mapped_column(primary_key=True)
    operation_id: Mapped[UUID] = mapped_column(primary_key=True)
    conversation_id: Mapped[UUID]


class ContextRevision(Base):
    __tablename__ = "chat_context_revision"
    __table_args__ = (
        ForeignKeyConstraint(
            ["conversation_id", "scope_id"],
            ["chat_conversation.id", "chat_conversation.scope_id"],
        ),
        UniqueConstraint("scope_id", "operation_id", name="uq_chat_context_operation"),
    )
    conversation_id: Mapped[UUID] = mapped_column(primary_key=True)
    revision: Mapped[int] = mapped_column(primary_key=True)
    scope_id: Mapped[UUID]
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("principal.id"))
    operation_id: Mapped[UUID | None]
    request_fingerprint: Mapped[str | None]
    through_turn: Mapped[int]
    notes: Mapped[str]
    origin: Mapped[str]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ChatTurn(Base):
    __tablename__ = "chat_turn"
    __table_args__ = (
        ForeignKeyConstraint(
            ["conversation_id", "scope_id"],
            ["chat_conversation.id", "chat_conversation.scope_id"],
            name="fk_chat_turn_conversation_scope",
        ),
        ForeignKeyConstraint(
            ["conversation_id", "context_revision"],
            ["chat_context_revision.conversation_id", "chat_context_revision.revision"],
            name="fk_chat_turn_context",
        ),
        UniqueConstraint("scope_id", "operation_id", name="uq_chat_turn_operation"),
        UniqueConstraint("conversation_id", "number", name="uq_chat_turn_number"),
        Index("ix_chat_turn_deadline", "state", "deadline_at"),
        Index(
            "uq_chat_active_conversation",
            "conversation_id",
            unique=True,
            postgresql_where=text("state = 'generating'"),
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    conversation_id: Mapped[UUID]
    scope_id: Mapped[UUID]
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("principal.id"))
    operation_id: Mapped[UUID]
    request_fingerprint: Mapped[str]
    payload_sha256: Mapped[str]
    profile_fingerprint: Mapped[str]
    configuration: Mapped[dict] = mapped_column(JSONB)
    number: Mapped[int]
    context_revision: Mapped[int] = mapped_column(default=0)
    user_text: Mapped[str]
    assistant_text: Mapped[str | None]
    state: Mapped[str]
    reserved_usd: Mapped[Decimal] = mapped_column(Numeric(18, 9))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    deadline_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    input_tokens: Mapped[int | None]
    output_tokens: Mapped[int | None]
    cached_tokens: Mapped[int | None]
    cache_write_tokens: Mapped[int | None]
    reasoning_tokens: Mapped[int | None]
    model: Mapped[str | None]
    service_tier: Mapped[str | None]
    provider_request_id: Mapped[str | None]
    error_code: Mapped[str | None]
