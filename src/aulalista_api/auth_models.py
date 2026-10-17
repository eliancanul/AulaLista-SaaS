"""Persistencia de identidad, desafíos y sesiones; nunca tokens en claro."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import DateTime

from aulalista_api.database import Base


class Identity(Base):
    __tablename__ = "auth_identity"
    __table_args__ = (UniqueConstraint("issuer", "subject", name="uq_auth_identity"),)
    id: Mapped[UUID] = mapped_column(primary_key=True)
    issuer: Mapped[str] = mapped_column(String(100))
    subject: Mapped[str] = mapped_column(String(320))
    principal_id: Mapped[UUID] = mapped_column(ForeignKey("principal.id"))
    email: Mapped[str] = mapped_column(String(320))
    email_verified: Mapped[bool]


class PreSession(Base):
    __tablename__ = "auth_pre_session"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    consumed: Mapped[bool] = mapped_column(default=False)


class AuthSession(Base):
    __tablename__ = "auth_session"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    principal_id: Mapped[UUID] = mapped_column(ForeignKey("principal.id"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    idle_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked: Mapped[bool] = mapped_column(default=False)
    recovery_context_id: Mapped[UUID | None] = mapped_column(nullable=True)


class EmailChallenge(Base):
    __tablename__ = "auth_email_challenge"
    __table_args__ = (
        CheckConstraint("attempts BETWEEN 0 AND 5", name="ck_auth_attempts"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True)
    pre_hash: Mapped[str] = mapped_column(ForeignKey("auth_pre_session.token_hash"))
    email: Mapped[str] = mapped_column(String(320), index=True)
    code_mac: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(default=0)
    consumed: Mapped[bool] = mapped_column(default=False)


class AuthRate(Base):
    __tablename__ = "auth_rate"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    bucket: Mapped[int] = mapped_column(primary_key=True)
    count: Mapped[int]
