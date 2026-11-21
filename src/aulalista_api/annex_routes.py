"""HTTP routes for printable annexes: generate, CRUD, approve, and PDF preview/download."""

from __future__ import annotations

from uuid import UUID

from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse, Response
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from aulalista_api.annexes import (
    MAX_ANNEX_REQUEST_BYTES,
    AnnexCreateRequest,
    Annexes,
    AnnexGenerateRequest,
    AnnexUpdateRequest,
)
from aulalista_api.material_routes import Actor, bounded_content
from aulalista_api.materials import MaterialError
from aulalista_api.openai_annex import AnnexGenerator, load_annex_generator_from_env
from aulalista_api.pdf_annex import (
    MAX_COPIES,
    MIN_COPIES,
    PdfGenerationError,
    render_annex_pdf,
)


def install_annex_routes(
    app: FastAPI,
    engine,
    *,
    generator: AnnexGenerator | None = None,
) -> None:
    resolved_generator = (
        generator if generator is not None else load_annex_generator_from_env()
    )
    service = Annexes(engine, resolved_generator)
    app.state.annexes = service

    @app.get("/scopes/{scope_id}/annex-capability")
    def annex_capability(scope_id: UUID, actor: Actor):
        return JSONResponse(
            service.capability(actor, scope_id),
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/scopes/{scope_id}/annexes")
    def list_annexes(
        scope_id: UUID,
        actor: Actor,
        limit: int = Query(default=50, ge=1, le=100),
    ):
        items = service.list_for_scope(actor, scope_id, limit=limit)
        return JSONResponse(
            {"items": items},
            headers={"Cache-Control": "no-store"},
        )

    @app.post("/scopes/{scope_id}/annexes/generate", status_code=201)
    async def generate_annex(scope_id: UUID, actor: Actor, request: Request):
        content = await bounded_content(
            request,
            media_type="application/json",
            max_bytes=MAX_ANNEX_REQUEST_BYTES,
        )
        try:
            payload = AnnexGenerateRequest.model_validate_json(content)
        except ValidationError:
            raise MaterialError(422, "invalid_request") from None
        saved = await run_in_threadpool(service.generate, actor, scope_id, payload)
        return JSONResponse(
            saved, status_code=201, headers={"Cache-Control": "no-store"}
        )

    @app.post("/scopes/{scope_id}/annexes", status_code=201)
    async def create_annex(scope_id: UUID, actor: Actor, request: Request):
        content = await bounded_content(
            request,
            media_type="application/json",
            max_bytes=MAX_ANNEX_REQUEST_BYTES,
        )
        try:
            payload = AnnexCreateRequest.model_validate_json(content)
        except ValidationError:
            raise MaterialError(422, "invalid_request") from None
        saved = await run_in_threadpool(service.create_manual, actor, scope_id, payload)
        return JSONResponse(
            saved, status_code=201, headers={"Cache-Control": "no-store"}
        )

    @app.get("/scopes/{scope_id}/annexes/{annex_id}")
    def read_annex(scope_id: UUID, annex_id: UUID, actor: Actor):
        return JSONResponse(
            service.read(actor, scope_id, annex_id),
            headers={"Cache-Control": "no-store"},
        )

    @app.put("/scopes/{scope_id}/annexes/{annex_id}")
    async def update_annex(
        scope_id: UUID, annex_id: UUID, actor: Actor, request: Request
    ):
        content = await bounded_content(
            request,
            media_type="application/json",
            max_bytes=MAX_ANNEX_REQUEST_BYTES,
        )
        try:
            payload = AnnexUpdateRequest.model_validate_json(content)
        except ValidationError:
            raise MaterialError(422, "invalid_request") from None
        saved = await run_in_threadpool(
            service.update, actor, scope_id, annex_id, payload
        )
        return JSONResponse(saved, headers={"Cache-Control": "no-store"})

    @app.post("/scopes/{scope_id}/annexes/{annex_id}/approve")
    async def approve_annex(scope_id: UUID, annex_id: UUID, actor: Actor):
        saved = await run_in_threadpool(service.approve, actor, scope_id, annex_id)
        return JSONResponse(saved, headers={"Cache-Control": "no-store"})

    @app.delete("/scopes/{scope_id}/annexes/{annex_id}", status_code=204)
    async def delete_annex(scope_id: UUID, annex_id: UUID, actor: Actor):
        await run_in_threadpool(service.delete, actor, scope_id, annex_id)
        return Response(status_code=204, headers={"Cache-Control": "no-store"})

    @app.get("/scopes/{scope_id}/annexes/{annex_id}/pdf")
    async def download_annex_pdf(
        scope_id: UUID,
        annex_id: UUID,
        actor: Actor,
        copies: int = Query(default=1, ge=MIN_COPIES, le=MAX_COPIES),
    ):
        doc = await run_in_threadpool(service.read, actor, scope_id, annex_id)
        try:
            pdf_bytes = await run_in_threadpool(render_annex_pdf, doc, copies=copies)
        except PdfGenerationError as error:
            raise MaterialError(error.status, error.code) from None
        filename = f"anexo_{annex_id}_{copies}x.pdf"
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'inline; filename="{filename}"',
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
            },
        )
