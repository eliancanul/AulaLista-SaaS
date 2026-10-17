"""Fuentes sintéticas: autoridad, historia y recibo en una transacción."""

import hashlib
import json
from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    UniqueConstraint,
    func,
    select,
    text,
    update,
)
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Mapped, Session, load_only, mapped_column

from aulalista_api.database import Base, PersonalScope

MAX_CONTENT_BYTES = 65_536


class MaterialError(Exception):
    def __init__(self, status: int, detail: str):
        self.status = status
        self.detail = detail
        super().__init__(detail)


class Source(Base):
    __tablename__ = "source"
    __table_args__ = (
        UniqueConstraint("id", "scope_id", name="uq_source_scope"),
        CheckConstraint("current_version > 0", name="ck_source_revision"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    scope_id: Mapped[UUID] = mapped_column(ForeignKey("personal_scope.id"))
    current_version: Mapped[int]


class SourceVersion(Base):
    __tablename__ = "source_version"
    __table_args__ = (
        ForeignKeyConstraint(
            ["source_id", "scope_id"],
            ["source.id", "source.scope_id"],
            name="fk_version_source_scope",
        ),
        UniqueConstraint("id", "scope_id", name="uq_source_version_scope"),
        UniqueConstraint("source_id", "number", name="uq_source_version_number"),
        UniqueConstraint("scope_id", "operation_id", name="uq_scope_operation"),
        CheckConstraint("number > 0", name="ck_version_number"),
        CheckConstraint(
            "octet_length(content) BETWEEN 1 AND 65536 AND size = octet_length(content)",
            name="ck_version_size",
        ),
        CheckConstraint(
            "content_sha256 = encode(sha256(content), 'hex')",
            name="ck_version_hash",
        ),
        CheckConstraint(
            "request_fingerprint ~ '^[0-9a-f]{64}$'", name="ck_version_fingerprint"
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    source_id: Mapped[UUID]
    scope_id: Mapped[UUID]
    number: Mapped[int]
    content: Mapped[bytes]
    size: Mapped[int]
    content_sha256: Mapped[str]
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("principal.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    operation_id: Mapped[UUID]
    request_fingerprint: Mapped[str]


def receipt(version: SourceVersion) -> dict:
    return {
        "source_id": str(version.source_id),
        "version_id": str(version.id),
        "scope_id": str(version.scope_id),
        "number": version.number,
        "sha256": version.content_sha256,
        "size": version.size,
        "actor_id": str(version.actor_id),
        "created_at": version.created_at.astimezone(UTC).isoformat(),
        "operation_id": str(version.operation_id),
    }


def authorize(session: Session, actor_id, scope_id: UUID) -> UUID:
    from aulalista_api.auth import revalidate_actor

    actor_id = revalidate_actor(session, actor_id)
    if (
        session.scalar(
            select(PersonalScope.id).where(
                PersonalScope.id == scope_id,
                PersonalScope.owner_principal_id == actor_id,
            )
        )
        is None
    ):
        raise MaterialError(404, "not_found")
    return actor_id


class Materials:
    def __init__(self, engine: Engine):
        self.engine = engine

    def list_sources(
        self,
        actor_id: UUID,
        scope_id: UUID,
        *,
        after: UUID | None = None,
        limit: int = 50,
    ) -> dict:
        with Session(self.engine) as session, session.begin():
            actor_id = authorize(session, actor_id, scope_id)
            if type(limit) is not int or not 1 <= limit <= 100:
                raise MaterialError(422, "invalid_request")
            if after is not None and (
                not isinstance(after, UUID)
                or session.scalar(
                    select(Source.id).where(
                        Source.scope_id == scope_id, Source.id == after
                    )
                )
                is None
            ):
                # An unrecognized boundary and another scope's ID are indistinguishable.
                raise MaterialError(422, "invalid_request")
            query = (
                select(SourceVersion)
                .join(
                    Source,
                    (SourceVersion.source_id == Source.id)
                    & (SourceVersion.scope_id == Source.scope_id)
                    & (SourceVersion.number == Source.current_version),
                )
                .where(Source.scope_id == scope_id)
                .options(
                    load_only(
                        SourceVersion.id,
                        SourceVersion.source_id,
                        SourceVersion.scope_id,
                        SourceVersion.number,
                        SourceVersion.content_sha256,
                        SourceVersion.size,
                        SourceVersion.actor_id,
                        SourceVersion.created_at,
                        SourceVersion.operation_id,
                        raiseload=True,
                    )
                )
            )
            if after is not None:
                query = query.where(Source.id > after)
            versions = session.scalars(query.order_by(Source.id).limit(limit + 1)).all()
            return {
                "items": [receipt(version) for version in versions[:limit]],
                "next_cursor": str(versions[limit - 1].source_id)
                if len(versions) > limit
                else None,
            }

    def write(
        self,
        actor_id: UUID,
        scope_id: UUID,
        operation_id: UUID,
        content: bytes,
        *,
        source_id: UUID | None = None,
        expected_version: int = 0,
    ) -> dict:
        if not content:
            raise MaterialError(422, "invalid_request")
        if len(content) > MAX_CONTENT_BYTES:
            raise MaterialError(413, "content_too_large")
        if (source_id is None and expected_version != 0) or (
            source_id is not None and expected_version < 1
        ):
            raise MaterialError(422, "invalid_request")
        request = json.dumps(
            [
                "create" if source_id is None else "append",
                str(source_id) if source_id else None,
                expected_version,
            ],
            separators=(",", ":"),
        ).encode()
        fingerprint = hashlib.sha256(
            b"aulalista-source-request-v1\0" + request + b"\0" + content
        ).hexdigest()
        lock = int.from_bytes(
            hashlib.sha256(scope_id.bytes + operation_id.bytes).digest()[:8],
            "big",
            signed=True,
        )
        with Session(self.engine) as session, session.begin():
            actor_id = authorize(session, actor_id, scope_id)
            # Same-key contenders wait for its commit; unrelated keys use the CAS below.
            session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock})
            previous = session.scalar(
                select(SourceVersion).where(
                    SourceVersion.scope_id == scope_id,
                    SourceVersion.operation_id == operation_id,
                )
            )
            if previous is not None:
                if previous.request_fingerprint != fingerprint:
                    raise MaterialError(409, "conflict")
                return receipt(previous)
            if source_id is None:
                source = Source(scope_id=scope_id, current_version=1)
                session.add(source)
                session.flush()
                source_id = source.id
            else:
                if (
                    session.scalar(
                        select(Source.id).where(
                            Source.id == source_id, Source.scope_id == scope_id
                        )
                    )
                    is None
                ):
                    raise MaterialError(404, "not_found")
                advanced = session.scalar(
                    update(Source)
                    .where(
                        Source.id == source_id,
                        Source.scope_id == scope_id,
                        Source.current_version == expected_version,
                    )
                    .values(current_version=expected_version + 1)
                    .returning(Source.current_version)
                )
                if advanced is None:
                    raise MaterialError(409, "conflict")
            version = SourceVersion(
                source_id=source_id,
                scope_id=scope_id,
                number=expected_version + 1,
                content=content,
                size=len(content),
                content_sha256=hashlib.sha256(content).hexdigest(),
                actor_id=actor_id,
                operation_id=operation_id,
                request_fingerprint=fingerprint,
            )
            session.add(version)
            session.flush()
            return receipt(version)

    def read(self, actor_id: UUID, scope_id: UUID, source_id: UUID, number: int):
        with Session(self.engine) as session, session.begin():
            actor_id = authorize(session, actor_id, scope_id)
            version = session.scalar(
                select(SourceVersion).where(
                    SourceVersion.scope_id == scope_id,
                    SourceVersion.source_id == source_id,
                    SourceVersion.number == number,
                )
            )
            if version is None:
                raise MaterialError(404, "not_found")
            return version.content, receipt(version)

    def operation(self, actor_id: UUID, scope_id: UUID, operation_id: UUID) -> dict:
        with Session(self.engine) as session, session.begin():
            actor_id = authorize(session, actor_id, scope_id)
            version = session.scalar(
                select(SourceVersion).where(
                    SourceVersion.scope_id == scope_id,
                    SourceVersion.operation_id == operation_id,
                )
            )
            if version is None:
                raise MaterialError(404, "not_found")
            return receipt(version)
