"""HTTP routes for plans, transparent usage quotas, billing checkout/portal, and Stripe webhook."""

from __future__ import annotations

from uuid import UUID

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from aulalista_api.billing import BillingService, CheckoutRequest
from aulalista_api.material_routes import bounded_content, require_actor
from aulalista_api.materials import MaterialError

MAX_BILLING_BODY_BYTES = 16_384
MAX_WEBHOOK_BYTES = 256 * 1024


def install_billing_routes(app: FastAPI, engine) -> None:
    service = BillingService(engine)
    app.state.billing = service

    @app.get("/scopes/{scope_id}/billing/plans", tags=["billing"])
    async def list_billing_plans(scope_id: UUID, actor=Depends(require_actor)):
        doc = await run_in_threadpool(service.list_plans, actor, scope_id)
        return JSONResponse(doc, headers={"Cache-Control": "no-store"})

    @app.get("/scopes/{scope_id}/billing/summary", tags=["billing"])
    async def get_billing_summary(scope_id: UUID, actor=Depends(require_actor)):
        doc = await run_in_threadpool(service.get_summary, actor, scope_id)
        return JSONResponse(doc, headers={"Cache-Control": "no-store"})

    @app.post("/scopes/{scope_id}/billing/checkout", tags=["billing"])
    async def start_billing_checkout(
        scope_id: UUID, request: Request, actor=Depends(require_actor)
    ):
        raw = await bounded_content(
            request, media_type="application/json", max_bytes=MAX_BILLING_BODY_BYTES
        )
        try:
            payload = CheckoutRequest.model_validate_json(raw)
        except ValidationError:
            raise MaterialError(422, "invalid_request") from None
        doc = await run_in_threadpool(service.start_checkout, actor, scope_id, payload)
        return JSONResponse(doc, headers={"Cache-Control": "no-store"})

    @app.post("/scopes/{scope_id}/billing/portal", tags=["billing"])
    async def open_billing_portal(scope_id: UUID, actor=Depends(require_actor)):
        doc = await run_in_threadpool(service.open_portal, actor, scope_id)
        return JSONResponse(doc, headers={"Cache-Control": "no-store"})

    @app.post("/billing/stripe/webhook", tags=["billing"])
    async def stripe_webhook(request: Request):
        raw = await request.body()
        if len(raw) > MAX_WEBHOOK_BYTES:
            raise MaterialError(413, "payload_too_large")
        sig = request.headers.get("stripe-signature")
        doc = await run_in_threadpool(service.handle_stripe_webhook, raw, sig)
        return JSONResponse(doc, headers={"Cache-Control": "no-store"})
