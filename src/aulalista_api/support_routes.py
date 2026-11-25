"""HTTP routes for support tickets, screenshot viewing, and debug backlog export."""

from __future__ import annotations

import time
from uuid import UUID

from fastapi import Depends, FastAPI, Query, Request
from fastapi.responses import JSONResponse, Response
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from aulalista_api.material_routes import bounded_content, require_actor
from aulalista_api.materials import MaterialError
from aulalista_api.support import (
    MAX_SUPPORT_REQUEST_BYTES,
    ServerDiagnosticsRecorder,
    SupportService,
    SupportTicketCreateRequest,
    SupportTicketUpdateRequest,
)


def install_support_routes(app: FastAPI, engine) -> None:
    diagnostics = ServerDiagnosticsRecorder()
    service = SupportService(engine, diagnostics=diagnostics)
    app.state.server_diagnostics = diagnostics
    app.state.support = service

    @app.middleware("http")
    async def record_server_diagnostics(request: Request, call_next):
        started = time.monotonic()
        try:
            response = await call_next(request)
        except Exception as exc:
            duration_ms = int((time.monotonic() - started) * 1000)
            diagnostics.record(
                method=request.method,
                path=request.url.path,
                status_code=500,
                duration_ms=duration_ms,
                error=type(exc).__name__,
            )
            raise
        if response.status_code >= 400:
            duration_ms = int((time.monotonic() - started) * 1000)
            diagnostics.record(
                method=request.method,
                path=request.url.path,
                status_code=response.status_code,
                duration_ms=duration_ms,
            )
        return response

    @app.post(
        "/scopes/{scope_id}/support/tickets",
        status_code=201,
        tags=["support"],
    )
    async def create_support_ticket(
        scope_id: UUID, request: Request, actor=Depends(require_actor)
    ):
        raw = await bounded_content(
            request,
            media_type="application/json",
            max_bytes=MAX_SUPPORT_REQUEST_BYTES,
        )
        try:
            body = SupportTicketCreateRequest.model_validate_json(raw)
        except ValidationError:
            raise MaterialError(422, "invalid_request") from None
        doc = await run_in_threadpool(service.create_ticket, actor, scope_id, body)
        return JSONResponse(doc, status_code=201, headers={"Cache-Control": "no-store"})

    @app.get("/scopes/{scope_id}/support/tickets", tags=["support"])
    async def list_support_tickets(
        scope_id: UUID,
        status: str | None = Query(default=None),
        severity: str | None = Query(default=None),
        limit: int = Query(default=50, ge=1, le=100),
        actor=Depends(require_actor),
    ):
        doc = await run_in_threadpool(
            service.list_tickets,
            actor,
            scope_id,
            status=status,
            severity=severity,
            limit=limit,
        )
        return JSONResponse(doc, headers={"Cache-Control": "no-store"})

    @app.get("/scopes/{scope_id}/support/tickets/{ticket_id}", tags=["support"])
    async def get_support_ticket(
        scope_id: UUID, ticket_id: UUID, actor=Depends(require_actor)
    ):
        doc = await run_in_threadpool(service.get_ticket, actor, scope_id, ticket_id)
        return JSONResponse(doc, headers={"Cache-Control": "no-store"})

    @app.get(
        "/scopes/{scope_id}/support/tickets/{ticket_id}/screenshot",
        tags=["support"],
    )
    async def get_support_screenshot(
        scope_id: UUID, ticket_id: UUID, actor=Depends(require_actor)
    ):
        png, mime, sha256 = await run_in_threadpool(
            service.get_screenshot, actor, scope_id, ticket_id
        )
        return Response(
            content=png,
            media_type=mime,
            headers={
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
                "ETag": f'"{sha256}"',
            },
        )

    @app.patch("/scopes/{scope_id}/support/tickets/{ticket_id}", tags=["support"])
    async def update_support_ticket(
        scope_id: UUID,
        ticket_id: UUID,
        request: Request,
        actor=Depends(require_actor),
    ):
        raw = await bounded_content(
            request, media_type="application/json", max_bytes=16_384
        )
        try:
            body = SupportTicketUpdateRequest.model_validate_json(raw)
        except ValidationError:
            raise MaterialError(422, "invalid_request") from None
        doc = await run_in_threadpool(
            service.update_ticket, actor, scope_id, ticket_id, body
        )
        return JSONResponse(doc, headers={"Cache-Control": "no-store"})

    @app.get("/scopes/{scope_id}/support/backlog.json", tags=["support"])
    async def export_support_backlog(scope_id: UUID, actor=Depends(require_actor)):
        doc = await run_in_threadpool(service.export_backlog, actor, scope_id)
        return JSONResponse(
            doc,
            headers={
                "Cache-Control": "no-store",
                "Content-Disposition": 'attachment; filename="acenta-debug-backlog.json"',
            },
        )
