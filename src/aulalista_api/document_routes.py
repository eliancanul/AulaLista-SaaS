"""HTTP routes for secure real documents, revocation/purge, document-to-annex, and cited web search."""

from __future__ import annotations

from uuid import UUID

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from aulalista_api.documents import (
    DocumentService,
    DocumentToAnnexRequest,
    DocumentUploadRequest,
    WebSearchProvider,
    WebSearchRequest,
)
from aulalista_api.material_routes import bounded_content, require_actor
from aulalista_api.materials import MaterialError

MAX_UPLOAD_JSON_BYTES = 14 * 1024 * 1024  # base64 overhead over 10 MB binary
MAX_SMALL_BODY_BYTES = 16_384


def install_document_routes(
    app: FastAPI,
    engine,
    *,
    web_search_provider: WebSearchProvider | None = None,
) -> None:
    service = DocumentService(engine, web_search_provider=web_search_provider)
    app.state.documents = service

    @app.get("/scopes/{scope_id}/documents", tags=["documents"])
    async def list_documents(scope_id: UUID, actor=Depends(require_actor)):
        doc = await run_in_threadpool(service.list_documents, actor, scope_id)
        return JSONResponse(doc, headers={"Cache-Control": "no-store"})

    @app.post("/scopes/{scope_id}/documents", status_code=201, tags=["documents"])
    async def upload_document(
        scope_id: UUID, request: Request, actor=Depends(require_actor)
    ):
        raw = await bounded_content(
            request,
            media_type="application/json",
            max_bytes=MAX_UPLOAD_JSON_BYTES,
        )
        try:
            payload = DocumentUploadRequest.model_validate_json(raw)
        except ValidationError:
            raise MaterialError(422, "invalid_request") from None
        doc = await run_in_threadpool(service.upload, actor, scope_id, payload)
        return JSONResponse(
            doc, status_code=201, headers={"Cache-Control": "no-store"}
        )

    @app.get("/scopes/{scope_id}/documents/{doc_id}", tags=["documents"])
    async def read_document(
        scope_id: UUID, doc_id: UUID, actor=Depends(require_actor)
    ):
        doc = await run_in_threadpool(service.read, actor, scope_id, doc_id)
        return JSONResponse(doc, headers={"Cache-Control": "no-store"})

    @app.post("/scopes/{scope_id}/documents/{doc_id}/revoke", tags=["documents"])
    async def revoke_document(
        scope_id: UUID, doc_id: UUID, actor=Depends(require_actor)
    ):
        doc = await run_in_threadpool(
            service.revoke_and_purge, actor, scope_id, doc_id
        )
        return JSONResponse(doc, headers={"Cache-Control": "no-store"})

    @app.post(
        "/scopes/{scope_id}/documents/{doc_id}/generate-annex",
        status_code=201,
        tags=["documents"],
    )
    async def generate_annex_from_document(
        scope_id: UUID,
        doc_id: UUID,
        request: Request,
        actor=Depends(require_actor),
    ):
        raw = await bounded_content(
            request,
            media_type="application/json",
            max_bytes=MAX_SMALL_BODY_BYTES,
        )
        try:
            payload = DocumentToAnnexRequest.model_validate_json(raw)
        except ValidationError:
            raise MaterialError(422, "invalid_request") from None
        created = await run_in_threadpool(
            service.generate_annex_from_document,
            actor,
            scope_id,
            doc_id,
            payload,
            app.state.annexes,
        )
        return JSONResponse(
            created, status_code=201, headers={"Cache-Control": "no-store"}
        )

    @app.post("/scopes/{scope_id}/web-search", tags=["documents"])
    async def web_search(
        scope_id: UUID, request: Request, actor=Depends(require_actor)
    ):
        raw = await bounded_content(
            request,
            media_type="application/json",
            max_bytes=MAX_SMALL_BODY_BYTES,
        )
        try:
            payload = WebSearchRequest.model_validate_json(raw)
        except ValidationError:
            raise MaterialError(422, "invalid_request") from None
        doc = await run_in_threadpool(service.web_search, actor, scope_id, payload)
        return JSONResponse(doc, headers={"Cache-Control": "no-store"})
