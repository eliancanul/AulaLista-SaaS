"""Tests for subscription plans, transparent monthly usage quotas, ledger, and Stripe-ready billing (#128)."""

from __future__ import annotations

import hashlib
import hmac
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, func, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from aulalista_api.app import create_app
from aulalista_api.auth_models import Identity
from aulalista_api.billing import _month_bounds_utc, grant_courtesy_plan
from aulalista_api.database import PersonalScope, Principal
from aulalista_api.mail_sender import FakeMailSender
from aulalista_api.material_routes import require_actor
from aulalista_api.print_jobs import PrintJob

FREE_PRINT_CAP = 5
PRINTER = "aula.l3250@print.epsonconnect.com"


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
        # 1. Plan catalog: printing is limited in free (5/month) and unlimited in Pro/Escuela
        plans_resp = client.get(f"/scopes/{scope_id}/billing/plans")
        assert plans_resp.status_code == 200
        plans_data = plans_resp.json()
        assert plans_data["active_plan_id"] == "free"
        assert plans_data["stripe_configured"] is False
        assert [p["id"] for p in plans_data["plans"]] == ["free", "docente", "escuela"]
        limits_by_plan = {p["id"]: p["limits"] for p in plans_data["plans"]}
        assert limits_by_plan["free"]["print_jobs"] == 5
        assert limits_by_plan["docente"]["print_jobs"] is None
        assert limits_by_plan["escuela"]["print_jobs"] is None

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
        assert summary["usage"]["print_jobs"]["limit"] == 5
        assert summary["usage"]["print_jobs"]["remaining"] == 5
        assert summary["usage"]["print_jobs"]["unlimited"] is False
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


def test_stripe_webhook_hmac_verification_and_idempotency(
    runtime_database, monkeypatch
):
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


def _print_app(actor, mail):
    app = create_app(mail_sender=mail, print_poller_seconds=0)
    app.dependency_overrides[require_actor] = lambda: actor
    return app


def _approved_annex(client, scope_id) -> str:
    created = client.post(
        f"/scopes/{scope_id}/annexes/tools/generate",
        json={
            "tool_id": "sopa-de-letras",
            "subject": "Español",
            "grade": "4° Primaria",
            "topic": "Verbos regulares",
        },
    )
    assert created.status_code == 201
    annex_id = created.json()["id"]
    assert (
        client.post(f"/scopes/{scope_id}/annexes/{annex_id}/approve").status_code == 200
    )
    return annex_id


def _print(client, scope_id, annex_id, **extra):
    return client.post(
        f"/scopes/{scope_id}/annexes/{annex_id}/print",
        json={"mode": "now", "copies": 1, "printer_email": PRINTER, **extra},
    )


def _print_meter(client, scope_id) -> dict:
    return client.get(f"/scopes/{scope_id}/billing/summary").json()["usage"][
        "print_jobs"
    ]


def _print_job_rows(engine, scope_id) -> int:
    with Session(engine) as db:
        return db.scalar(
            select(func.count(PrintJob.id)).where(PrintJob.scope_id == scope_id)
        )


def _seed_print_job(engine, principal_id, scope_id, created_at) -> None:
    with Session(engine) as db:
        db.add(
            PrintJob(
                scope_id=scope_id,
                actor_id=principal_id,
                job_kind="test_page",
                annex_title="Hoja de prueba Epson",
                printer_email=PRINTER,
                copies=1,
                scheduled_for=created_at,
                status="sent",
                idempotency_key=f"seed-{uuid4()}",
                created_at=created_at,
                sent_at=created_at,
            )
        )
        db.commit()


def _no_courtesy_grants(monkeypatch) -> None:
    monkeypatch.delenv("AULALISTA_PRO_GRANT_EMAILS", raising=False)
    monkeypatch.delenv("AULALISTA_PRO_GRANT_SCOPE_IDS", raising=False)


def test_free_plan_rejects_the_print_after_the_cap_without_consuming_quota(
    runtime_database, monkeypatch
):
    _no_courtesy_grants(monkeypatch)
    principal_id, scope_id = _seed_user(runtime_database)
    mail = FakeMailSender()

    with TestClient(_print_app(principal_id, mail)) as client:
        annex_id = _approved_annex(client, scope_id)

        # The last unit of the plan is still granted and delivered.
        allowed = [
            _print(client, scope_id, annex_id, idempotency_key=f"ok-{n}")
            for n in range(FREE_PRINT_CAP)
        ]
        assert [r.status_code for r in allowed] == [201] * FREE_PRINT_CAP
        assert [r.json()["status"] for r in allowed] == ["sent"] * FREE_PRINT_CAP
        at_cap = _print_meter(client, scope_id)
        assert (at_cap["used"], at_cap["limit"], at_cap["remaining"]) == (5, 5, 0)

        # Every way of creating one more job is refused with the same stable code.
        future = (datetime.now(UTC) + timedelta(days=1)).isoformat()
        refused = [
            _print(client, scope_id, annex_id),
            _print(client, scope_id, annex_id, mode="scheduled", scheduled_for=future),
            client.post(
                f"/scopes/{scope_id}/print-settings/test-page",
                json={"printer_email": PRINTER},
            ),
        ]
        assert [(r.status_code, r.json().get("detail")) for r in refused] == [
            (402, "print_limit_reached")
        ] * 3

        # A refusal sends nothing, stores nothing and leaves the meter where it was.
        assert len(mail.sent) == FREE_PRINT_CAP
        assert _print_job_rows(runtime_database, scope_id) == FREE_PRINT_CAP
        assert _print_meter(client, scope_id) == at_cap

        # Replaying a job that was already accepted is not a new print.
        replay = _print(client, scope_id, annex_id, idempotency_key="ok-0")
        assert replay.status_code == 201
        assert replay.json()["id"] == allowed[0].json()["id"]
        assert len(mail.sent) == FREE_PRINT_CAP

    # One teacher at the cap does not spend another teacher's quota.
    other_principal, other_scope = _seed_user(runtime_database)
    with TestClient(_print_app(other_principal, mail)) as client:
        other_annex = _approved_annex(client, other_scope)
        assert _print(client, other_scope, other_annex).status_code == 201


def test_two_concurrent_prints_cannot_both_take_the_last_free_unit(
    runtime_database, monkeypatch
):
    _no_courtesy_grants(monkeypatch)
    principal_id, scope_id = _seed_user(runtime_database)
    mail = FakeMailSender()
    with TestClient(_print_app(principal_id, mail)) as client:
        annex_id = _approved_annex(client, scope_id)
        for _ in range(FREE_PRINT_CAP - 1):
            assert _print(client, scope_id, annex_id).status_code == 201

    apps = [_print_app(principal_id, mail), _print_app(principal_id, mail)]
    barrier, pids = threading.Barrier(2), set()

    def synchronize(conn, cursor, statement, parameters, context, executemany):
        # Hold both requests at the quota lock so neither has counted yet.
        pid = conn.connection.driver_connection.info.backend_pid
        if statement.startswith("SELECT pg_advisory_xact_lock") and pid not in pids:
            pids.add(pid)
            barrier.wait(timeout=5)

    event.listen(Engine, "before_cursor_execute", synchronize)
    try:

        def contender(index):
            with TestClient(apps[index]) as client:
                return _print(
                    client, scope_id, annex_id, idempotency_key=f"race-{index}"
                )

        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(contender, [0, 1]))
    finally:
        event.remove(Engine, "before_cursor_execute", synchronize)

    assert len(pids) == 2
    assert sorted(r.status_code for r in responses) == [201, 402]
    assert len(mail.sent) == FREE_PRINT_CAP
    assert _print_job_rows(runtime_database, scope_id) == FREE_PRINT_CAP


def test_free_print_cap_counts_only_the_current_utc_month(
    runtime_database, monkeypatch
):
    _no_courtesy_grants(monkeypatch)
    principal_id, scope_id = _seed_user(runtime_database)
    month_start = datetime.now(UTC).replace(
        day=1, hour=0, minute=0, second=0, microsecond=0
    )
    # A full cap spent up to the last instant of last month, one job on the boundary.
    for _ in range(FREE_PRINT_CAP):
        _seed_print_job(
            runtime_database,
            principal_id,
            scope_id,
            month_start - timedelta(microseconds=1),
        )
    _seed_print_job(runtime_database, principal_id, scope_id, month_start)
    mail = FakeMailSender()

    with TestClient(_print_app(principal_id, mail)) as client:
        annex_id = _approved_annex(client, scope_id)
        assert _print_meter(client, scope_id)["used"] == 1
        codes = [
            _print(client, scope_id, annex_id).status_code
            for _ in range(FREE_PRINT_CAP)
        ]
        assert codes == [201] * (FREE_PRINT_CAP - 1) + [402]
        assert len(mail.sent) == FREE_PRINT_CAP - 1


@pytest.mark.parametrize(
    ("now", "start", "end"),
    [
        ("2026-12-31T23:59:59+00:00", "2026-12-01", "2027-01-01"),
        ("2027-01-01T00:00:00+00:00", "2027-01-01", "2027-02-01"),
        # 19:30 on 30 Nov in Chetumal is already December in UTC.
        ("2026-11-30T19:30:00-05:00", "2026-12-01", "2027-01-01"),
    ],
)
def test_usage_month_is_a_half_open_utc_calendar_month(now, start, end):
    assert _month_bounds_utc(datetime.fromisoformat(now)) == (
        datetime.fromisoformat(start).replace(tzinfo=UTC),
        datetime.fromisoformat(end).replace(tzinfo=UTC),
    )


@pytest.mark.parametrize("granted_by", ["allowlisted_email", "grant_pro_script"])
def test_courtesy_pro_account_prints_past_the_free_cap(
    runtime_database, monkeypatch, granted_by
):
    _no_courtesy_grants(monkeypatch)
    if granted_by == "allowlisted_email":
        monkeypatch.setenv("AULALISTA_PRO_GRANT_EMAILS", "mama@escuela.mx")
        principal_id, scope_id = _seed_user(runtime_database, email="Mama@escuela.mx")
    else:
        principal_id, scope_id = _seed_user(runtime_database)
        with Session(runtime_database) as db:
            grant_courtesy_plan(db, scope_id, plan_id="docente", reason="familia")
            db.commit()
    mail = FakeMailSender()

    # The account has never opened Billing: printing alone must apply the grant.
    with TestClient(_print_app(principal_id, mail)) as client:
        annex_id = _approved_annex(client, scope_id)
        codes = [
            _print(client, scope_id, annex_id).status_code
            for _ in range(FREE_PRINT_CAP + 2)
        ]
        assert codes == [201] * (FREE_PRINT_CAP + 2)
        assert len(mail.sent) == FREE_PRINT_CAP + 2
        meter = _print_meter(client, scope_id)
        assert (meter["used"], meter["unlimited"]) == (FREE_PRINT_CAP + 2, True)


def test_allowlisted_but_unverified_email_stays_on_the_free_cap(
    runtime_database, monkeypatch
):
    _no_courtesy_grants(monkeypatch)
    monkeypatch.setenv("AULALISTA_PRO_GRANT_EMAILS", "papa@escuela.mx")
    principal_id, scope_id = _seed_user(
        runtime_database, email="papa@escuela.mx", email_verified=False
    )
    mail = FakeMailSender()

    with TestClient(_print_app(principal_id, mail)) as client:
        annex_id = _approved_annex(client, scope_id)
        codes = [
            _print(client, scope_id, annex_id).status_code
            for _ in range(FREE_PRINT_CAP + 1)
        ]
        assert codes == [201] * FREE_PRINT_CAP + [402]


def test_paid_plan_lifts_the_print_cap_and_cancellation_restores_it(
    runtime_database, monkeypatch
):
    _no_courtesy_grants(monkeypatch)
    secret = "whsec_print_cap_123"
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", secret)
    principal_id, scope_id = _seed_user(runtime_database)
    mail = FakeMailSender()

    def stripe_event(event_id, event_type):
        body = json.dumps(
            {
                "id": event_id,
                "type": event_type,
                "data": {
                    "object": {
                        "id": "sub_print_cap",
                        "metadata": {"scope_id": str(scope_id), "plan_id": "docente"},
                    }
                },
            }
        ).encode("utf-8")
        return client.post(
            "/billing/stripe/webhook",
            content=body,
            headers={"Stripe-Signature": _stripe_sig(body, secret)},
        )

    with TestClient(_print_app(principal_id, mail)) as client:
        annex_id = _approved_annex(client, scope_id)
        for _ in range(FREE_PRINT_CAP):
            assert _print(client, scope_id, annex_id).status_code == 201
        assert _print(client, scope_id, annex_id).status_code == 402

        assert (
            stripe_event("evt_paid", "checkout.session.completed").json()["plan_id"]
            == "docente"
        )
        assert _print(client, scope_id, annex_id).status_code == 201
        assert _print(client, scope_id, annex_id).status_code == 201

        assert (
            stripe_event("evt_gone", "customer.subscription.deleted").json()["plan_id"]
            == "free"
        )
        assert _print(client, scope_id, annex_id).status_code == 402
        assert len(mail.sent) == FREE_PRINT_CAP + 2
