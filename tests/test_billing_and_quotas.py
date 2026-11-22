"""Tests for subscription plans, transparent monthly usage quotas, ledger, and Stripe-ready billing (#128)."""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from aulalista_api.app import create_app
from aulalista_api.auth_models import Identity
from aulalista_api.billing import grant_courtesy_plan
from aulalista_api.database import PersonalScope, Principal
from aulalista_api.material_routes import require_actor


def _seed_user(engine, *, email: str | None = None, email_verified: bool = True):
    with Session(engine) as db:
        principal = Principal(id=uuid4())
        db.add(principal)
        db.flush()
        scope = PersonalScope(id=uuid4(), owner_principal_id=principal.id)
        db.add(scope)
        if email is not None:
            db.add(
                Identity(
                    id=uuid4(),
                    issuer="test",
                    subject=f"sub-{uuid4()}",
                    principal_id=principal.id,
                    email=email,
                    email_verified=email_verified,
                )
            )
        db.commit()
        return principal.id, scope.id


def _stripe_sig(body: bytes, secret: str, ts: int | None = None) -> str:
    timestamp = int(time.time()) if ts is None else ts
    signed = f"{timestamp}.".encode("ascii") + body
    digest = hmac.new(secret.encode("utf-8"), signed, hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={digest}"


def test_plans_catalog_realtime_usage_and_preview_switch(runtime_database, monkeypatch):
    monkeypatch.delenv("AULALISTA_STRIPE_ENABLED", raising=False)
    monkeypatch.delenv("STRIPE_SECRET_KEY", raising=False)
    monkeypatch.delenv("AULALISTA_PRO_GRANT_EMAILS", raising=False)
    monkeypatch.delenv("AULALISTA_PRO_GRANT_SCOPE_IDS", raising=False)
    principal_id, scope_id = _seed_user(runtime_database)
    other_principal_id, _ = _seed_user(runtime_database)

    app = create_app()
    current_actor = [principal_id]
    app.dependency_overrides[require_actor] = lambda: current_actor[0]

    with TestClient(app) as client:
        # 1. Plan catalog: printing is unlimited across all plans
        plans_resp = client.get(f"/scopes/{scope_id}/billing/plans")
        assert plans_resp.status_code == 200
        plans_data = plans_resp.json()
        assert plans_data["active_plan_id"] == "free"
        assert plans_data["stripe_configured"] is False
        assert [p["id"] for p in plans_data["plans"]] == ["free", "docente", "escuela"]
        assert all(p["limits"]["print_jobs"] is None for p in plans_data["plans"])

        # 2. Generate a didactic annex so usage counter increments transparently
        gen = client.post(
            f"/scopes/{scope_id}/annexes/tools/generate",
            json={
                "tool_id": "sopa-de-letras",
                "subject": "Español",
                "grade": "4° Primaria",
                "topic": "Verbos regulares",
            },
        )
        assert gen.status_code == 201

        summary_resp = client.get(f"/scopes/{scope_id}/billing/summary")
        assert summary_resp.status_code == 200
        summary = summary_resp.json()
        assert summary["subscription"]["plan_id"] == "free"
        assert summary["subscription"]["is_courtesy"] is False
        assert summary["usage"]["annexes"]["used"] == 1
        assert summary["usage"]["annexes"]["limit"] == 25
        assert summary["usage"]["annexes"]["remaining"] == 24
        assert summary["usage"]["annexes"]["unlimited"] is False
        assert summary["usage"]["print_jobs"]["limit"] is None
        assert summary["usage"]["print_jobs"]["remaining"] is None
        assert summary["usage"]["print_jobs"]["unlimited"] is True
        assert summary["usage"]["print_jobs"]["at_limit"] is False
        assert summary["usage"]["print_jobs"]["near_limit"] is False
        assert summary["quota_status"] == "healthy"

        # 3. Fail-closed checkout & portal when Stripe is not configured
        denied_checkout = client.post(
            f"/scopes/{scope_id}/billing/checkout",
            json={"plan_id": "docente", "preview_switch": False},
        )
        assert denied_checkout.status_code == 503
        assert denied_checkout.json()["detail"] == "stripe_not_configured"

        denied_portal = client.post(f"/scopes/{scope_id}/billing/portal")
        assert denied_portal.status_code == 503
        assert denied_portal.json()["detail"] == "stripe_not_configured"

        # 4. Safe beta preview switch upgrades limits and records ledger event
        upgraded = client.post(
            f"/scopes/{scope_id}/billing/checkout",
            json={"plan_id": "docente", "preview_switch": True},
        )
        assert upgraded.status_code == 200
        up_data = upgraded.json()
        assert up_data["mode"] == "beta_preview"
        assert up_data["summary"]["subscription"]["plan_id"] == "docente"
        assert up_data["summary"]["usage"]["annexes"]["limit"] == 200
        assert up_data["summary"]["usage"]["print_jobs"]["unlimited"] is True
        assert any(
            ev["event_type"] == "plan_changed" for ev in up_data["summary"]["ledger"]
        )

        # 5. Cross-scope isolation
        current_actor[0] = other_principal_id
        assert client.get(f"/scopes/{scope_id}/billing/plans").status_code == 404
        assert client.get(f"/scopes/{scope_id}/billing/summary").status_code == 404
        assert (
            client.post(
                f"/scopes/{scope_id}/billing/checkout",
                json={"plan_id": "escuela", "preview_switch": True},
            ).status_code
            == 404
        )


def test_courtesy_pro_allowlist_manual_grant_and_webhook_protection(
    runtime_database, monkeypatch
):
    monkeypatch.setenv("AULALISTA_PRO_GRANT_EMAILS", "mama@escuela.mx, papa@escuela.mx")
    monkeypatch.setenv("AULALISTA_PRO_GRANT_PLAN", "docente")
    secret = "whsec_courtesy_guard_123"
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", secret)

    parent_principal, parent_scope = _seed_user(
        runtime_database, email="MAMA@escuela.mx", email_verified=True
    )
    unverified_principal, unverified_scope = _seed_user(
        runtime_database, email="papa@escuela.mx", email_verified=False
    )
    manual_principal, manual_scope = _seed_user(runtime_database)

    app = create_app()
    current_actor = [parent_principal]
    app.dependency_overrides[require_actor] = lambda: current_actor[0]

    with TestClient(app) as client:
        # 1. Verified email on allowlist automatically receives Pro Docente at $0
        parent_summary = client.get(f"/scopes/{parent_scope}/billing/summary").json()
        assert parent_summary["subscription"]["plan_id"] == "docente"
        assert parent_summary["subscription"]["billing_provider"] == "courtesy_pro"
        assert parent_summary["subscription"]["is_courtesy"] is True
        assert parent_summary["subscription"]["price_mxn_monthly"] == 0
        assert parent_summary["subscription"]["current_period_end"] is None
        assert parent_summary["usage"]["ai_turns"]["limit"] == 600
        assert parent_summary["usage"]["annexes"]["limit"] == 200
        assert parent_summary["usage"]["print_jobs"]["unlimited"] is True
        assert any(
            ev["event_type"] == "courtesy_pro_granted"
            for ev in parent_summary["ledger"]
        )

        # 2. Unverified email does NOT receive automatic courtesy Pro
        current_actor[0] = unverified_principal
        unverified_summary = client.get(
            f"/scopes/{unverified_scope}/billing/summary"
        ).json()
        assert unverified_summary["subscription"]["plan_id"] == "free"
        assert unverified_summary["subscription"]["is_courtesy"] is False

        # 3. Manual courtesy grant helper works directly for any scope
        with Session(runtime_database) as db:
            grant_courtesy_plan(
                db, manual_scope, plan_id="docente", reason="Cuenta familiar"
            )
            db.commit()

        current_actor[0] = manual_principal
        manual_summary = client.get(f"/scopes/{manual_scope}/billing/summary").json()
        assert manual_summary["subscription"]["plan_id"] == "docente"
        assert manual_summary["subscription"]["is_courtesy"] is True
        assert manual_summary["subscription"]["price_mxn_monthly"] == 0

        # 4. Stripe cancellation webhook cannot downgrade a courtesy Pro account
        cancel_body = json.dumps(
            {
                "id": "evt_courtesy_cancel_guard",
                "type": "customer.subscription.deleted",
                "data": {
                    "object": {
                        "id": "sub_old_123",
                        "metadata": {"scope_id": str(parent_scope)},
                    }
                },
            }
        ).encode("utf-8")
        webhook_resp = client.post(
            "/billing/stripe/webhook",
            content=cancel_body,
            headers={"Stripe-Signature": _stripe_sig(cancel_body, secret)},
        )
        assert webhook_resp.status_code == 200
        assert webhook_resp.json()["plan_id"] == "docente"

        current_actor[0] = parent_principal
        still_pro = client.get(f"/scopes/{parent_scope}/billing/summary").json()
        assert still_pro["subscription"]["plan_id"] == "docente"
        assert still_pro["subscription"]["is_courtesy"] is True


def test_stripe_webhook_hmac_verification_and_idempotency(runtime_database, monkeypatch):
    monkeypatch.delenv("AULALISTA_PRO_GRANT_EMAILS", raising=False)
    monkeypatch.delenv("AULALISTA_PRO_GRANT_SCOPE_IDS", raising=False)
    principal_id, scope_id = _seed_user(runtime_database)
    app = create_app()
    app.dependency_overrides[require_actor] = lambda: principal_id

    event_payload = {
        "id": "evt_test_001",
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "id": "cs_test_123",
                "customer": "cus_test_abc",
                "subscription": "sub_test_xyz",
                "client_reference_id": str(scope_id),
                "metadata": {"scope_id": str(scope_id), "plan_id": "escuela"},
            }
        },
    }
    raw_body = json.dumps(event_payload).encode("utf-8")

    with TestClient(app) as client:
        # 1. Fail-closed when STRIPE_WEBHOOK_SECRET is unset
        monkeypatch.delenv("STRIPE_WEBHOOK_SECRET", raising=False)
        unconfigured = client.post("/billing/stripe/webhook", content=raw_body)
        assert unconfigured.status_code == 503
        assert unconfigured.json()["detail"] == "stripe_webhook_not_configured"

        # 2. Invalid signature rejected with 400
        secret = "whsec_test_secret_12345"
        monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", secret)
        bad_sig = client.post(
            "/billing/stripe/webhook",
            content=raw_body,
            headers={"Stripe-Signature": "t=12345,v1=deadbeef"},
        )
        assert bad_sig.status_code == 400
        assert bad_sig.json()["detail"] == "invalid_stripe_signature"

        # 3. Valid HMAC-SHA256 signature upgrades subscription to escuela
        sig = _stripe_sig(raw_body, secret)
        ok = client.post(
            "/billing/stripe/webhook",
            content=raw_body,
            headers={"Stripe-Signature": sig},
        )
        assert ok.status_code == 200
        assert ok.json()["received"] is True
        assert ok.json()["duplicate"] is False
        assert ok.json()["plan_id"] == "escuela"

        # 4. Duplicate event delivery is idempotent
        dup = client.post(
            "/billing/stripe/webhook",
            content=raw_body,
            headers={"Stripe-Signature": sig},
        )
        assert dup.status_code == 200
        assert dup.json()["duplicate"] is True

        # Verify summary reflects Stripe plan & limits
        summary = client.get(f"/scopes/{scope_id}/billing/summary").json()
        assert summary["subscription"]["plan_id"] == "escuela"
        assert summary["subscription"]["billing_provider"] == "stripe"
        assert summary["usage"]["ai_turns"]["limit"] == 3000

        # 5. Subscription deletion downgrades cleanly back to free
        cancel_body = json.dumps(
            {
                "id": "evt_test_002",
                "type": "customer.subscription.deleted",
                "data": {
                    "object": {
                        "id": "sub_test_xyz",
                        "metadata": {"scope_id": str(scope_id)},
                    }
                },
            }
        ).encode("utf-8")
        cancel_resp = client.post(
            "/billing/stripe/webhook",
            content=cancel_body,
            headers={"Stripe-Signature": _stripe_sig(cancel_body, secret)},
        )
        assert cancel_resp.status_code == 200
        assert cancel_resp.json()["plan_id"] == "free"
        assert cancel_resp.json()["status"] == "canceled"
