"""Esquema interno y conexiones síncronas de una operación."""

import asyncio
from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, UniqueConstraint, create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column
from sqlalchemy.pool import NullPool

from aulalista_api.config import Settings

SCHEMA_REVISION = "0014_school_spaces"


class Base(DeclarativeBase):
    pass


class Principal(Base):
    __tablename__ = "principal"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)


class PersonalScope(Base):
    __tablename__ = "personal_scope"
    __table_args__ = (
        UniqueConstraint("owner_principal_id", name="uq_personal_scope_owner"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    owner_principal_id: Mapped[UUID] = mapped_column(
        ForeignKey("principal.id", name="fk_personal_scope_owner")
    )


def make_engine(settings: Settings) -> Engine:
    # No pooling yet: every operation closes its connection and reconnects afresh.
    return create_engine(
        settings.database_url,
        poolclass=NullPool,
        isolation_level="READ COMMITTED",
        hide_parameters=True,
        connect_args={
            "connect_timeout": settings.db_timeout_seconds,
            "options": (
                f"-c statement_timeout={settings.db_timeout_seconds * 1000} "
                f"-c lock_timeout={settings.db_timeout_seconds * 1000} "
                "-c search_path=public"
            ),
        },
    )


def schema_is_ready(engine: Engine) -> bool:
    try:
        with Session(engine) as session:
            return session.execute(
                text("SELECT version_num FROM public.alembic_version")
            ).scalars().all() == [SCHEMA_REVISION]
    except SQLAlchemyError:
        return False


class Readiness:
    """Una sola sonda simultánea; el plazo HTTP incluye DNS/conexión/consulta."""

    def __init__(self, engine: Engine, timeout_seconds: float):
        self.engine = engine
        self.timeout_seconds = timeout_seconds
        self.pending: asyncio.Task[bool] | None = None

    async def check(self) -> bool:
        if self.pending is None or self.pending.done():
            self.pending = asyncio.create_task(
                asyncio.to_thread(schema_is_ready, self.engine)
            )
        try:
            # A timed-out caller never starts an unbounded stream of DB threads.
            async with asyncio.timeout(self.timeout_seconds):
                return await asyncio.shield(self.pending)
        except TimeoutError:
            return False
