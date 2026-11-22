"""HTTP routes for teacher account preferences and identity method linking."""

from __future__ import annotations

from uuid import UUID

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from aulalista_api.account import (
    AccountService,
    EmailLinkRequest,
    EmailLinkVerifyRequest,
    GoogleLinkRequest,
    PreferencesUpdateRequest,
)
from aulalista_api.material_routes import bounded_content, require_actor
from aulalista_api.materials import MaterialError

MAX_ACCOUNT_BODY_BYTES = 16_384


async def _parse(request: Request, model):
    raw = await bounded_content(
        request, media_type="application/json", max_bytes=MAX_ACCOUNT_BODY_BYTES
    )
    try:
        return model.model_validate_json(raw)
    except ValidationError:
        raise MaterialError(422, "invalid_request") from None


def install_account_routes(app: FastAPI, engine) -> None:
    service = AccountService(engine, getattr(app.state, "auth", None))
    app.state.account = service

    @app.get("/scopes/{scope_id}/account", tags=["account"])
    async def get_account(scope_id: UUID, actor=Depends(require_actor)):
        doc = await run_in_threadpool(service.get_account, actor, scope_id)
        return JSONResponse(doc, headers={"Cache-Control": "no-store"})

    @app.put("/scopes/{scope_id}/account/preferences", tags=["account"])
    async def update_preferences(
        scope_id: UUID, request: Request, actor=Depends(require_actor)
    ):
        body = await _parse(request, PreferencesUpdateRequest)
        doc = await run_in_threadpool(service.update_preferences, actor, scope_id, body)
        return JSONResponse(doc, headers={"Cache-Control": "no-store"})

    @app.post(
        "/scopes/{scope_id}/account/link/email/request",
        status_code=202,
        tags=["account"],
    )
    async def request_email_link(
        scope_id: UUID, request: Request, actor=Depends(require_actor)
    ):
        body = await _parse(request, EmailLinkRequest)
        doc = await run_in_threadpool(service.request_email_link, actor, scope_id, body)
        return JSONResponse(doc, status_code=202, headers={"Cache-Control": "no-store"})

    @app.post("/scopes/{scope_id}/account/link/email/verify", tags=["account"])
    async def verify_email_link(
        scope_id: UUID, request: Request, actor=Depends(require_actor)
    ):
        body = await _parse(request, EmailLinkVerifyRequest)
        doc = await run_in_threadpool(service.verify_email_link, actor, scope_id, body)
        return JSONResponse(doc, headers={"Cache-Control": "no-store"})

    @app.post("/scopes/{scope_id}/account/link/google", tags=["account"])
    async def link_google(
        scope_id: UUID, request: Request, actor=Depends(require_actor)
    ):
        body = await _parse(request, GoogleLinkRequest)
        doc = await run_in_threadpool(service.link_google, actor, scope_id, body)
        return JSONResponse(doc, headers={"Cache-Control": "no-store"})
