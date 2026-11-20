"""HTTP routes for Epson Email Print settings, print queue, test page, and cron dispatch."""

from __future__ import annotations

import hmac
import os
from uuid import UUID

from fastapi import FastAPI, Header, Query, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from aulalista_api.mail_sender import MailSender, load_mail_sender_from_env
from aulalista_api.material_routes import Actor, bounded_content
from aulalista_api.materials import MaterialError
from aulalista_api.print_jobs import (
    PrintAnnexRequest,
    PrintJobsService,
    TestPageRequest,
)
from aulalista_api.print_settings import PrintSettingsService, PrintSettingsUpdate

MAX_PRINT_REQUEST_BYTES = 8192


def install_print_routes(
    app: FastAPI,
    engine,
    *,
    mail_sender: MailSender | None = None,
) -> PrintJobsService:
    resolved_sender = (
        mail_sender if mail_sender is not None else load_mail_sender_from_env()
    )
    settings_service = PrintSettingsService(
        engine, smtp_configured_fn=lambda: resolved_sender.is_configured
    )
    jobs_service = PrintJobsService(engine, resolved_sender)
    app.state.print_settings = settings_service
    app.state.print_jobs = jobs_service

    @app.get("/scopes/{scope_id}/print-settings")
    def read_print_settings(scope_id: UUID, actor: Actor):
        return JSONResponse(
            settings_service.get(actor, scope_id),
            headers={"Cache-Control": "no-store"},
        )

    @app.put("/scopes/{scope_id}/print-settings")
    async def update_print_settings(scope_id: UUID, actor: Actor, request: Request):
        content = await bounded_content(
            request,
            media_type="application/json",
            max_bytes=MAX_PRINT_REQUEST_BYTES,
        )
        try:
            payload = PrintSettingsUpdate.model_validate_json(content)
        except ValidationError:
            raise MaterialError(422, "invalid_request") from None
        saved = await run_in_threadpool(
            settings_service.update, actor, scope_id, payload
        )
        return JSONResponse(saved, headers={"Cache-Control": "no-store"})

    @app.post("/scopes/{scope_id}/print-settings/test-page", status_code=201)
    async def send_test_page(scope_id: UUID, actor: Actor, request: Request):
        raw_body = await request.body()
        if raw_body.strip():
            content = await bounded_content(
                request,
                media_type="application/json",
                max_bytes=MAX_PRINT_REQUEST_BYTES,
            )
            try:
                payload = TestPageRequest.model_validate_json(content)
            except ValidationError:
                raise MaterialError(422, "invalid_request") from None
        else:
            payload = TestPageRequest()
        job = await run_in_threadpool(
            jobs_service.send_test_page, actor, scope_id, payload
        )
        return JSONResponse(job, status_code=201, headers={"Cache-Control": "no-store"})

    @app.post("/scopes/{scope_id}/annexes/{annex_id}/print", status_code=201)
    async def enqueue_annex_print(
        scope_id: UUID, annex_id: UUID, actor: Actor, request: Request
    ):
        content = await bounded_content(
            request,
            media_type="application/json",
            max_bytes=MAX_PRINT_REQUEST_BYTES,
        )
        try:
            payload = PrintAnnexRequest.model_validate_json(content)
        except ValidationError:
            raise MaterialError(422, "invalid_request") from None
        job = await run_in_threadpool(
            jobs_service.enqueue_annex_print, actor, scope_id, annex_id, payload
        )
        return JSONResponse(job, status_code=201, headers={"Cache-Control": "no-store"})

    @app.get("/scopes/{scope_id}/print-jobs")
    def list_print_jobs(
        scope_id: UUID,
        actor: Actor,
        limit: int = Query(default=50, ge=1, le=100),
    ):
        items = jobs_service.list_jobs(actor, scope_id, limit=limit)
        return JSONResponse(
            {"items": items},
            headers={"Cache-Control": "no-store"},
        )

    @app.post("/scopes/{scope_id}/print-jobs/{job_id}/cancel")
    async def cancel_print_job(scope_id: UUID, job_id: UUID, actor: Actor):
        job = await run_in_threadpool(jobs_service.cancel_job, actor, scope_id, job_id)
        return JSONResponse(job, headers={"Cache-Control": "no-store"})

    @app.post("/scopes/{scope_id}/print-jobs/{job_id}/retry")
    async def retry_print_job(scope_id: UUID, job_id: UUID, actor: Actor):
        job = await run_in_threadpool(jobs_service.retry_job, actor, scope_id, job_id)
        return JSONResponse(job, headers={"Cache-Control": "no-store"})

    @app.post("/internal/print-jobs/dispatch", include_in_schema=False)
    async def dispatch_due_print_jobs(
        x_print_cron_secret: str | None = Header(default=None),
        limit: int = Query(default=20, ge=1, le=100),
    ):
        expected = os.environ.get("AULALISTA_PRINT_CRON_SECRET", "").strip()
        if not expected:
            raise MaterialError(503, "cron_secret_not_configured")
        if not x_print_cron_secret or not hmac.compare_digest(
            x_print_cron_secret, expected
        ):
            raise MaterialError(401, "unauthorized")
        summary = await run_in_threadpool(jobs_service.dispatch_due_jobs, limit=limit)
        return JSONResponse(summary, headers={"Cache-Control": "no-store"})

    return jobs_service
