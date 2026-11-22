"""Secure teacher document storage, OCR extraction, coherent revocation/purge, and cited web search."""

from __future__ import annotations

import base64
import binascii
import json
import os
from datetime import UTC, datetime
from typing import Any, Literal, Protocol
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    delete,
    func,
    select,
)
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Mapped, Session, mapped_column

from aulalista_api.database import Base
from aulalista_api.didactic_generators import (
    AdaptationMode,
    DidacticToolGenerateRequest,
    ToolId,
)
from aulalista_api.document_security import (
    DocumentValidationError,
    sniff_and_validate_document,
)
from aulalista_api.document_worker import run_isolated_extraction
from aulalista_api.materials import MaterialError, authorize


class TeacherDocument(Base):
    __tablename__ = "teacher_document"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'ready', 'failed', 'revoked')",
            name="ck_teacher_document_status",
        ),
        Index("ix_teacher_document_scope_created", "scope_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    scope_id: Mapped[UUID] = mapped_column(
        ForeignKey("personal_scope.id", ondelete="CASCADE")
    )
    actor_id: Mapped[UUID] = mapped_column(
        ForeignKey("principal.id", ondelete="CASCADE")
    )
    filename: Mapped[str] = mapped_column(String(180))
    detected_mime: Mapped[str] = mapped_column(String(120))
    size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(24), default="pending")
    extracted_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    page_count: Mapped[int] = mapped_column(Integer, default=0)
    ocr_engine: Mapped[str] = mapped_column(String(64), default="")
    error_code: Mapped[str | None] = mapped_column(String(120), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class DocumentBlob(Base):
    __tablename__ = "document_blob"

    document_id: Mapped[UUID] = mapped_column(
        ForeignKey("teacher_document.id", ondelete="CASCADE"), primary_key=True
    )
    scope_id: Mapped[UUID] = mapped_column(
        ForeignKey("personal_scope.id", ondelete="CASCADE")
    )
    content: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class DocumentRevocationTombstone(Base):
    __tablename__ = "document_revocation_tombstone"
    __table_args__ = (
        Index("ix_document_revocation_tombstone_scope", "scope_id", "revoked_at"),
    )

    document_id: Mapped[UUID] = mapped_column(primary_key=True)
    scope_id: Mapped[UUID] = mapped_column(
        ForeignKey("personal_scope.id", ondelete="CASCADE")
    )
    sha256: Mapped[str] = mapped_column(String(64))
    reason: Mapped[str] = mapped_column(String(120), default="teacher_revoked")
    revoked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class DocumentUploadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filename: str = Field(min_length=1, max_length=200)
    content_base64: str = Field(min_length=4, max_length=15_000_000)


class DocumentToAnnexRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tool_id: ToolId = "comprension-lectora"
    subject: str = Field(min_length=1, max_length=120)
    grade: str = Field(min_length=1, max_length=80)
    topic: str | None = Field(default=None, max_length=240)
    adaptation_mode: AdaptationMode = "lectura_facil"


class WebSearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str = Field(min_length=2, max_length=240)
    max_results: int = Field(default=5, ge=1, le=8)
    language: Literal["es", "en"] = "es"


class WebSearchProvider(Protocol):
    @property
    def is_configured(self) -> bool: ...

    def search(
        self, query: str, *, max_results: int, language: str
    ) -> list[dict[str, str]]: ...


class UnconfiguredWebSearchProvider:
    @property
    def is_configured(self) -> bool:
        return False

    def search(
        self, query: str, *, max_results: int, language: str
    ) -> list[dict[str, str]]:
        raise MaterialError(503, "web_search_unavailable")


class WikipediaCitedSearchProvider:
    """Safe, verifiable educational citation search using public Wikimedia REST/API when opted in."""

    def __init__(self, *, timeout_seconds: float = 8.0) -> None:
        self._timeout = timeout_seconds

    @property
    def is_configured(self) -> bool:
        return True

    def search(
        self, query: str, *, max_results: int, language: str
    ) -> list[dict[str, str]]:
        lang = "en" if language == "en" else "es"
        params = urlencode(
            {
                "action": "query",
                "list": "search",
                "srsearch": query,
                "srlimit": max_results,
                "utf8": 1,
                "format": "json",
            }
        )
        endpoint = f"https://{lang}.wikipedia.org/w/api.php?{params}"
        req = Request(
            endpoint,
            headers={"User-Agent": "AulaLista-Acenta/1.0 (educational-citations)"},
        )
        try:
            with urlopen(req, timeout=self._timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except Exception:
            raise MaterialError(502, "web_search_failed") from None

        now_iso = datetime.now(UTC).isoformat()
        results: list[dict[str, str]] = []
        for item in payload.get("query", {}).get("search", [])[:max_results]:
            title = str(item.get("title", "")).strip()
            page_id = item.get("pageid")
            if not title or not page_id:
                continue
            url = f"https://{lang}.wikipedia.org/?curid={page_id}"
            raw_snippet = str(item.get("snippet", ""))
            # Strip simple HTML highlight tags returned by MediaWiki
            clean_snippet = (
                raw_snippet.replace('<span class="searchmatch">', "")
                .replace("</span>", "")
                .replace("&quot;", '"')
                .strip()
            )
            results.append(
                {
                    "title": title,
                    "url": url,
                    "domain": f"{lang}.wikipedia.org",
                    "snippet": clean_snippet[:360],
                    "accessed_at": now_iso,
                }
            )
        return results


def load_web_search_provider_from_env() -> WebSearchProvider:
    if os.environ.get("AULALISTA_WEB_SEARCH_ENABLED", "").strip().lower() == "true":
        return WikipediaCitedSearchProvider()
    return UnconfiguredWebSearchProvider()


def _validate_citation_urls(items: list[dict[str, str]]) -> list[dict[str, str]]:
    verified: list[dict[str, str]] = []
    for item in items:
        url = str(item.get("url", "")).strip()
        parsed = urlparse(url)
        if parsed.scheme != "https" or not parsed.netloc:
            continue
        verified.append(
            {
                "title": str(item.get("title", "")).strip()[:200],
                "url": url[:600],
                "domain": parsed.netloc.lower(),
                "snippet": str(item.get("snippet", "")).strip()[:400],
                "accessed_at": str(
                    item.get("accessed_at") or datetime.now(UTC).isoformat()
                ),
            }
        )
    return verified


def document_payload(
    row: TeacherDocument, *, include_text: bool = False
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": str(row.id),
        "scope_id": str(row.scope_id),
        "filename": row.filename,
        "detected_mime": row.detected_mime,
        "size_bytes": row.size_bytes,
        "sha256": row.sha256,
        "status": row.status,
        "page_count": row.page_count,
        "ocr_engine": row.ocr_engine,
        "error_code": row.error_code,
        "revoked_at": (
            row.revoked_at.astimezone(UTC).isoformat() if row.revoked_at else None
        ),
        "created_at": row.created_at.astimezone(UTC).isoformat(),
        "updated_at": row.updated_at.astimezone(UTC).isoformat(),
    }
    if include_text:
        out["extracted_text"] = row.extracted_text if row.status != "revoked" else None
    else:
        preview = (row.extracted_text or "").strip()
        out["text_preview"] = preview[:240] if row.status != "revoked" else ""
    return out


def reconcile_revoked_documents(session: Session) -> int:
    """Enforce revocation tombstones after any backup restore so purged docs never revive."""
    tombstones = session.scalars(select(DocumentRevocationTombstone)).all()
    reconciled = 0
    for tomb in tombstones:
        doc = session.get(TeacherDocument, tomb.document_id)
        if doc is not None and (
            doc.status != "revoked" or doc.extracted_text is not None
        ):
            doc.status = "revoked"
            doc.extracted_text = None
            doc.revoked_at = tomb.revoked_at
            doc.updated_at = datetime.now(UTC)
            reconciled += 1
        blob = session.get(DocumentBlob, tomb.document_id)
        if blob is not None:
            session.delete(blob)
            reconciled += 1
    return reconciled


class DocumentService:
    def __init__(
        self,
        engine: Engine,
        *,
        web_search_provider: WebSearchProvider | None = None,
    ) -> None:
        self.engine = engine
        self._explicit_search = web_search_provider

    def _search_provider(self) -> WebSearchProvider:
        if self._explicit_search is not None:
            return self._explicit_search
        return load_web_search_provider_from_env()

    def upload(
        self,
        actor: UUID,
        scope_id: UUID,
        payload: DocumentUploadRequest,
    ) -> dict[str, Any]:
        b64 = payload.content_base64.strip()
        if b64.startswith("data:") and "," in b64:
            b64 = b64.split(",", 1)[1]
        try:
            raw = base64.b64decode(b64, validate=True)
        except (binascii.Error, ValueError):
            raise MaterialError(422, "invalid_base64") from None

        try:
            validated = sniff_and_validate_document(
                filename=payload.filename, raw=raw
            )
        except DocumentValidationError as err:
            raise MaterialError(err.status, err.code) from None

        extraction = run_isolated_extraction(
            validated.raw_bytes, validated.detected_mime
        )
        now = datetime.now(UTC)
        with Session(self.engine) as session:
            authorize(session, actor, scope_id)
            doc = TeacherDocument(
                scope_id=scope_id,
                actor_id=actor,
                filename=validated.filename,
                detected_mime=validated.detected_mime,
                size_bytes=validated.size_bytes,
                sha256=validated.sha256,
                status="ready" if extraction.ok else "failed",
                extracted_text=extraction.text if extraction.ok else None,
                page_count=extraction.page_count,
                ocr_engine=extraction.ocr_engine,
                error_code=extraction.error_code,
                created_at=now,
                updated_at=now,
            )
            session.add(doc)
            session.flush()
            session.add(
                DocumentBlob(
                    document_id=doc.id,
                    scope_id=scope_id,
                    content=validated.raw_bytes,
                    created_at=now,
                )
            )
            session.commit()
            session.refresh(doc)
            return document_payload(doc, include_text=True)

    def list_documents(self, actor: UUID, scope_id: UUID) -> dict[str, Any]:
        with Session(self.engine) as session:
            authorize(session, actor, scope_id)
            rows = session.scalars(
                select(TeacherDocument)
                .where(TeacherDocument.scope_id == scope_id)
                .order_by(TeacherDocument.created_at.desc())
                .limit(60)
            ).all()
            return {"items": [document_payload(r, include_text=False) for r in rows]}

    def read(self, actor: UUID, scope_id: UUID, doc_id: UUID) -> dict[str, Any]:
        with Session(self.engine) as session:
            authorize(session, actor, scope_id)
            tombstone = session.scalar(
                select(DocumentRevocationTombstone).where(
                    DocumentRevocationTombstone.document_id == doc_id,
                    DocumentRevocationTombstone.scope_id == scope_id,
                )
            )
            if tombstone is not None:
                raise MaterialError(410, "document_revoked")
            row = session.scalar(
                select(TeacherDocument).where(
                    TeacherDocument.id == doc_id,
                    TeacherDocument.scope_id == scope_id,
                )
            )
            if row is None:
                raise MaterialError(404, "not_found")
            if row.status == "revoked":
                raise MaterialError(410, "document_revoked")
            return document_payload(row, include_text=True)

    def revoke_and_purge(
        self, actor: UUID, scope_id: UUID, doc_id: UUID
    ) -> dict[str, Any]:
        now = datetime.now(UTC)
        with Session(self.engine) as session:
            authorize(session, actor, scope_id)
            row = session.scalar(
                select(TeacherDocument)
                .where(
                    TeacherDocument.id == doc_id,
                    TeacherDocument.scope_id == scope_id,
                )
                .with_for_update()
            )
            if row is None:
                raise MaterialError(404, "not_found")
            # Hard-delete binary blob immediately
            session.execute(
                delete(DocumentBlob).where(
                    DocumentBlob.document_id == doc_id,
                    DocumentBlob.scope_id == scope_id,
                )
            )
            row.status = "revoked"
            row.extracted_text = None
            row.revoked_at = now
            row.updated_at = now
            existing_tomb = session.get(DocumentRevocationTombstone, doc_id)
            if existing_tomb is None:
                session.add(
                    DocumentRevocationTombstone(
                        document_id=doc_id,
                        scope_id=scope_id,
                        sha256=row.sha256,
                        reason="teacher_revoked",
                        revoked_at=now,
                    )
                )
            session.commit()
            session.refresh(row)
            return document_payload(row, include_text=False)

    def generate_annex_from_document(
        self,
        actor: UUID,
        scope_id: UUID,
        doc_id: UUID,
        payload: DocumentToAnnexRequest,
        annex_service,
    ) -> dict[str, Any]:
        doc = self.read(actor, scope_id, doc_id)
        extracted = (doc.get("extracted_text") or "").strip()
        if not extracted:
            raise MaterialError(422, "document_has_no_text")
        topic = (payload.topic or doc["filename"].rsplit(".", 1)[0]).strip()
        req = DidacticToolGenerateRequest(
            tool_id=payload.tool_id,
            subject=payload.subject,
            grade=payload.grade,
            topic=topic[:200],
            source_text=extracted[:5500],
            adaptation_mode=payload.adaptation_mode,
        )
        return annex_service.generate_tool(actor, scope_id, req)

    def web_search(
        self,
        actor: UUID,
        scope_id: UUID,
        payload: WebSearchRequest,
    ) -> dict[str, Any]:
        with Session(self.engine) as session:
            authorize(session, actor, scope_id)
        provider = self._search_provider()
        if not provider.is_configured:
            raise MaterialError(503, "web_search_unavailable")
        raw_results = provider.search(
            payload.query.strip(),
            max_results=payload.max_results,
            language=payload.language,
        )
        citations = _validate_citation_urls(raw_results)
        return {
            "query": payload.query.strip(),
            "citations": citations,
            "count": len(citations),
        }
