"""Independent adversarial checks: real auth and PostgreSQL, test-only transports.

PYTEST_DONT_REWRITE: never print token, cookie or OTP arguments on assertion failure.
"""

import base64
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from aulalista_api.app import create_app

ORIGIN = "https://testserver"


class CapturingSender:
    def __init__(self):
        self.messages = []
        self.lock = threading.Lock()

    def send_code(self, email, code):
        with self.lock:
            self.messages.append((email, code))


class SyntheticGoogle:
    """Only the external signature verifier is replaced, never actor/session."""

    def verify(self, credential, nonce):
        subject, email = credential.split("|", 1)
        return {
            "iss": "https://accounts.google.com",
            "sub": subject,
            "email": email,
            "email_verified": True,
            "nonce": nonce,
            "aud": "synthetic.apps.googleusercontent.com",
        }


@pytest.fixture
def auth_factory(runtime_database, monkeypatch):
    monkeypatch.setenv("AULALISTA_AUTH_ORIGIN", ORIGIN)
    monkeypatch.setenv(
        "AULALISTA_AUTH_HMAC_KEY",
        base64.urlsafe_b64encode(b"synthetic-test-key-only-32-bytes!!").decode(),
    )
    monkeypatch.setenv(
        "AULALISTA_GOOGLE_CLIENT_ID", "synthetic.apps.googleusercontent.com"
    )
    sender = CapturingSender()

    @contextmanager
    def factory():
        app = create_app()
        app.state.auth.sender = sender
        app.state.auth.google = SyntheticGoogle()
        assert not app.dependency_overrides
        with TestClient(app, base_url=ORIGIN) as client:
            yield client

    return factory, sender


def bootstrap(client):
    response = client.get("/auth/bootstrap")
    assert response.status_code == 200, f"Bootstrap HTTP status: {response.status_code}"
    assert response.headers["cache-control"] == "no-store"
    return {"Origin": ORIGIN, "X-CSRF-Token": response.json()["csrf_token"]}


def request_code(client, email="one@example.test"):
    headers = bootstrap(client)
    response = client.post(
        "/auth/email/request", json={"email": email}, headers=headers
    )
    assert response.status_code == 202
    return headers, response.json()["challenge_id"]


def verify(client, headers, challenge, code):
    return client.post(
        "/auth/email/verify",
        json={"challenge_id": challenge, "code": code},
        headers=headers,
    )


def login(client, sender, email="one@example.test"):
    headers, challenge = request_code(client, email)
    response = verify(client, headers, challenge, sender.messages[-1][1])
    assert response.status_code == 200
    return response.json()


def write(client, session, *, headers=None):
    return client.post(
        f"/scopes/{session['scope_id']}/sources",
        content=b"synthetic private source",
        headers={
            "Content-Type": "application/octet-stream",
            "Idempotency-Key": str(uuid4()),
            **(
                headers
                if headers is not None
                else {"Origin": ORIGIN, "X-CSRF-Token": session["csrf_token"]}
            ),
        },
    )


def test_otp_session_real_authority_logout_and_isolation(auth_factory):
    factory, sender = auth_factory
    with factory() as a, factory() as b:
        sa = login(a, sender)
        sb = login(b, sender, "two@example.test")
        assert sa["principal_id"] != sb["principal_id"]
        saved = write(a, sa)
        assert saved.status_code == 201
        path = (
            f"/scopes/{sa['scope_id']}/sources/{saved.json()['source_id']}/versions/1"
        )
        assert a.get(path).status_code == 200
        assert b.get(path).status_code == 404
        assert (
            write(
                b, sa, headers={"Origin": ORIGIN, "X-CSRF-Token": sb["csrf_token"]}
            ).status_code
            == 404
        )
        stolen = a.cookies.get("__Host-acenta-session")
        response = a.post(
            "/auth/logout", headers={"Origin": ORIGIN, "X-CSRF-Token": sa["csrf_token"]}
        )
        assert response.status_code == 204
        a.cookies.set("__Host-acenta-session", stolen)
        assert a.get("/auth/session").status_code == 401
        assert a.get(path).status_code == 401
        assert write(a, sa).status_code == 401
        assert b.get("/auth/session").status_code == 200


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Origin": "https://attacker.example"},
        {"Origin": ORIGIN, "X-CSRF-Token": "wrong"},
    ],
)
def test_csrf_denies_login_logout_and_material_write(auth_factory, headers):
    factory, sender = auth_factory
    with factory() as client:
        bootstrap(client)
        assert (
            client.post(
                "/auth/email/request",
                json={"email": "one@example.test"},
                headers=headers,
            ).status_code
            == 403
        )
        session = login(client, sender)
        assert write(client, session, headers=headers).status_code == 403
        assert client.post("/auth/logout", headers=headers).status_code == 403
        assert client.get("/auth/session").status_code == 200


def test_otp_bound_to_browser_and_single_use_concurrent(
    auth_factory, migrated_database
):
    factory, sender = auth_factory
    with factory() as issuer, factory() as stranger:
        headers, challenge = request_code(issuer)
        code = sender.messages[-1][1]
        assert verify(stranger, bootstrap(stranger), challenge, code).status_code == 400
        cookie = issuer.cookies.get("__Host-acenta-pre")
        barrier = threading.Barrier(2)

        def attempt(rival):
            barrier.wait(timeout=5)
            return verify(rival, headers, challenge, code).status_code

        with factory() as first, factory() as second:
            first.cookies.set("__Host-acenta-pre", cookie)
            second.cookies.set("__Host-acenta-pre", cookie)
            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(attempt, rival) for rival in (first, second)]
                statuses = [future.result(timeout=10) for future in futures]
        assert statuses.count(200) == 1
        assert all(status in {200, 400, 401} for status in statuses)
        with migrated_database.connect() as connection:
            assert (
                connection.execute(
                    text("SELECT count(*) FROM auth_identity")
                ).scalar_one()
                == 1
            )
            assert (
                connection.execute(
                    text("SELECT count(*) FROM auth_session")
                ).scalar_one()
                == 1
            )


def test_wrong_codes_exhaust_challenge_without_creating_identity(
    auth_factory, migrated_database
):
    factory, sender = auth_factory
    with factory() as client:
        headers, challenge = request_code(client)
        code = sender.messages[-1][1]
        wrong = "00000000" if code != "00000000" else "11111111"
        for _ in range(5):
            assert verify(client, headers, challenge, wrong).status_code == 400
        assert verify(client, headers, challenge, code).status_code == 400
        with migrated_database.connect() as connection:
            assert (
                connection.execute(
                    text("SELECT count(*) FROM auth_identity")
                ).scalar_one()
                == 0
            )


def test_expired_challenge_and_session_rejected(auth_factory, migrated_database):
    factory, sender = auth_factory
    with factory() as client:
        headers, challenge = request_code(client)
        with migrated_database.begin() as connection:
            connection.execute(
                text(
                    "UPDATE auth_email_challenge SET expires_at = now() - interval '1 second'"
                )
            )
        assert (
            verify(client, headers, challenge, sender.messages[-1][1]).status_code
            == 400
        )
    with factory() as client:
        session = login(client, sender, "fresh@example.test")
        with migrated_database.begin() as connection:
            connection.execute(
                text(
                    "UPDATE auth_session SET idle_expires_at = now() - interval '1 second'"
                )
            )
        assert client.get("/auth/session").status_code == 401
        assert write(client, session).status_code == 401


def test_email_limit_shared_across_app_instances_and_generic_response(auth_factory):
    factory, sender = auth_factory
    with factory() as a, factory() as b:
        ha = bootstrap(a)
        hb = bootstrap(b)
        first = a.post(
            "/auth/email/request", json={"email": "one@example.test"}, headers=ha
        )
        second = b.post(
            "/auth/email/request", json={"email": "one@example.test"}, headers=hb
        )
        assert first.status_code == second.status_code == 202
        assert set(first.json()) == set(second.json()) == {"challenge_id", "message"}
        assert first.json()["message"] == second.json()["message"]
        assert len(sender.messages) == 1
        assert (
            verify(
                b, hb, second.json()["challenge_id"], sender.messages[0][1]
            ).status_code
            == 400
        )


def test_google_subject_authority_never_autolinks_email(auth_factory):
    factory, sender = auth_factory

    def google(subject, email):
        with factory() as client:
            response = client.post(
                "/auth/google",
                json={"credential": f"{subject}|{email}"},
                headers=bootstrap(client),
            )
            assert response.status_code == 200
            return response.json()["principal_id"]

    first = google("subject-one", "shared@example.test")
    assert google("subject-one", "changed@example.test") == first
    assert google("subject-two", "shared@example.test") != first
    with factory() as client:
        assert login(client, sender, "shared@example.test")["principal_id"] != first


def test_cookies_secure_and_no_raw_credentials_persisted(
    auth_factory, migrated_database
):
    factory, sender = auth_factory
    with factory() as client:
        response = client.get("/auth/bootstrap")
        cookie = response.headers["set-cookie"].lower()
        for flag in ("secure", "httponly", "samesite=lax", "path=/"):
            assert flag in cookie
        assert "domain=" not in cookie
        login(client, sender)
        token = client.cookies.get("__Host-acenta-session")
        with migrated_database.connect() as connection:
            stored = connection.execute(
                text("SELECT token_hash FROM auth_session")
            ).scalar_one()
            mac = connection.execute(
                text("SELECT code_mac FROM auth_email_challenge")
            ).scalar_one()
        assert len(stored) == len(mac) == 64
        assert stored != token
        assert mac != sender.messages[-1][1]


def test_logout_wins_after_actor_resolution_before_write(
    auth_factory, monkeypatch, migrated_database
):
    from aulalista_api.materials import Materials

    factory, sender = auth_factory
    reached, release = threading.Event(), threading.Event()
    original = Materials.write

    def delayed(self, *args, **kwargs):
        reached.set()
        assert release.wait(timeout=10)
        return original(self, *args, **kwargs)

    with factory() as client, factory() as concurrent:
        session = login(client, sender)
        concurrent.cookies.set(
            "__Host-acenta-session", client.cookies.get("__Host-acenta-session")
        )
        monkeypatch.setattr(Materials, "write", delayed)
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(write, concurrent, session)
            try:
                assert reached.wait(timeout=5)
                assert (
                    client.post(
                        "/auth/logout",
                        headers={
                            "Origin": ORIGIN,
                            "X-CSRF-Token": session["csrf_token"],
                        },
                    ).status_code
                    == 204
                )
            finally:
                release.set()
            assert pending.result(timeout=10).status_code == 401
        with migrated_database.connect() as connection:
            assert (
                connection.execute(text("SELECT count(*) FROM source")).scalar_one()
                == 0
            )


def test_resend_invalidates_old_code(auth_factory, migrated_database):
    factory, sender = auth_factory
    with factory() as client:
        headers, old_challenge = request_code(client)
        old_code = sender.messages[-1][1]
        with migrated_database.begin() as connection:
            connection.execute(
                text(
                    "UPDATE auth_email_challenge SET expires_at = now() + interval '8 minutes'"
                )
            )
        response = client.post(
            "/auth/email/request", json={"email": "one@example.test"}, headers=headers
        )
        assert response.status_code == 202
        assert len(sender.messages) == 2
        assert verify(client, headers, old_challenge, old_code).status_code == 400
        new_challenge = response.json()["challenge_id"]
        assert (
            verify(client, headers, new_challenge, sender.messages[-1][1]).status_code
            == 200
        )


def test_pre_csrf_never_authorizes_authenticated_write(auth_factory):
    factory, sender = auth_factory
    with factory() as client:
        headers, challenge = request_code(client)
        response = verify(client, headers, challenge, sender.messages[-1][1])
        assert response.status_code == 200
        assert write(client, response.json(), headers=headers).status_code == 403


def test_login_rotates_and_revokes_existing_session(auth_factory):
    factory, sender = auth_factory
    with factory() as client, factory() as old_browser:
        first = login(client, sender)
        old_cookie = client.cookies.get("__Host-acenta-session")
        old_browser.cookies.set("__Host-acenta-session", old_cookie)
        second = login(client, sender, "second@example.test")
        assert first["principal_id"] != second["principal_id"]
        assert client.cookies.get("__Host-acenta-session") != old_cookie
        assert old_browser.get("/auth/session").status_code == 401
        assert write(old_browser, first).status_code == 401


def test_logout_waits_for_already_authorized_transaction(
    auth_factory, migrated_database, monkeypatch
):
    import time

    import aulalista_api.materials as materials

    factory, sender = auth_factory
    reached, release = threading.Event(), threading.Event()
    original = materials.authorize

    def hold_authorized(*args, **kwargs):
        result = original(*args, **kwargs)
        reached.set()
        assert release.wait(timeout=5)
        return result

    with factory() as writer, factory() as closer:
        session = login(writer, sender)
        closer.cookies.set(
            "__Host-acenta-session", writer.cookies.get("__Host-acenta-session")
        )
        monkeypatch.setattr(materials, "authorize", hold_authorized)
        with ThreadPoolExecutor(max_workers=2) as pool:
            saving = pool.submit(write, writer, session)
            closing = None
            try:
                assert reached.wait(timeout=2)
                closing = pool.submit(
                    closer.post,
                    "/auth/logout",
                    headers={"Origin": ORIGIN, "X-CSRF-Token": session["csrf_token"]},
                )
                deadline = time.monotonic() + 1.5
                while True:
                    with migrated_database.connect() as connection:
                        waiting = connection.execute(
                            text(
                                "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%auth_session%' "
                            )
                        ).scalar_one()
                    if waiting:
                        break
                    assert time.monotonic() < deadline
                    time.sleep(0.01)
                assert not closing.done()
            finally:
                release.set()
            assert saving.result(timeout=5).status_code == 201
            assert closing.result(timeout=5).status_code == 204
        assert writer.get("/auth/session").status_code == 401
        assert write(writer, session).status_code == 401


def test_verify_email_budget_is_shared_and_survives_resend(
    auth_factory, migrated_database
):
    factory, sender = auth_factory
    with factory() as first, factory() as second:
        headers, challenge = request_code(first)
        code = sender.messages[-1][1]
        wrong = "00000000" if code != "00000000" else "11111111"
        for _ in range(20):
            assert verify(first, headers, challenge, wrong).status_code == 400
        with migrated_database.begin() as connection:
            connection.execute(
                text(
                    "UPDATE auth_email_challenge SET expires_at = now() + interval '8 minutes'"
                )
            )
        new_headers, new_challenge = request_code(second)
        assert len(sender.messages) == 2
        assert (
            verify(
                second, new_headers, new_challenge, sender.messages[-1][1]
            ).status_code
            == 429
        )
        with migrated_database.connect() as connection:
            assert (
                connection.execute(
                    text("SELECT count(*) FROM auth_identity")
                ).scalar_one()
                == 0
            )


def test_request_ip_budget_cannot_be_bypassed_by_forwarded_for(auth_factory):
    factory, sender = auth_factory
    with factory() as client:
        headers = bootstrap(client)
        for index in range(21):
            response = client.post(
                "/auth/email/request",
                json={"email": f"synthetic-{index}@example.test"},
                headers={**headers, "X-Forwarded-For": f"192.0.2.{index}"},
            )
            assert response.status_code == (202 if index < 20 else 429)
        assert len(sender.messages) == 20


def test_google_pre_session_replay_denied(auth_factory):
    factory, _ = auth_factory
    with factory() as client, factory() as replay:
        headers = bootstrap(client)
        replay.cookies.set("__Host-acenta-pre", client.cookies.get("__Host-acenta-pre"))
        body = {"credential": "same-subject|one@example.test"}
        assert (
            client.post("/auth/google", json=body, headers=headers).status_code == 200
        )
        assert (
            replay.post("/auth/google", json=body, headers=headers).status_code == 401
        )


def test_google_concurrent_provisioning_creates_one_identity_and_scope(
    auth_factory, migrated_database
):
    factory, _ = auth_factory
    barrier = threading.Barrier(2)

    def login_google(client, headers):
        barrier.wait(timeout=5)
        response = client.post(
            "/auth/google",
            json={"credential": "same-subject|one@example.test"},
            headers=headers,
        )
        assert response.status_code == 200
        return response.json()

    # Only provisioning is raced. Setup failures remain direct and actionable.
    with factory() as first, factory() as second:
        first_headers, second_headers = bootstrap(first), bootstrap(second)
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [
                pool.submit(login_google, first, first_headers),
                pool.submit(login_google, second, second_headers),
            ]
            failures = [future.exception(timeout=10) for future in futures]
            failures = [error for error in failures if error is not None]
            if failures:
                raise ExceptionGroup("Concurrent Google login failed", failures)
            results = [future.result() for future in futures]
    assert results[0]["principal_id"] == results[1]["principal_id"]
    assert results[0]["scope_id"] == results[1]["scope_id"]
    with migrated_database.connect() as connection:
        assert (
            connection.execute(text("SELECT count(*) FROM auth_identity")).scalar_one()
            == 1
        )
        assert (
            connection.execute(
                text(
                    "SELECT count(*) FROM personal_scope WHERE owner_principal_id = :actor"
                ),
                {"actor": results[0]["principal_id"]},
            ).scalar_one()
            == 1
        )


def test_session_polling_does_not_extend_idle_deadline(auth_factory, migrated_database):
    factory, sender = auth_factory
    with factory() as client:
        session = login(client, sender)
        with migrated_database.begin() as connection:
            connection.execute(
                text(
                    "UPDATE auth_session SET idle_expires_at = now() + interval '1 minute'"
                )
            )
            before = connection.execute(
                text("SELECT idle_expires_at FROM auth_session")
            ).scalar_one()
        for _ in range(3):
            assert client.get("/auth/session").status_code == 200
        with migrated_database.connect() as connection:
            assert (
                connection.execute(
                    text("SELECT idle_expires_at FROM auth_session")
                ).scalar_one()
                == before
            )
        assert write(client, session).status_code == 201
        with migrated_database.connect() as connection:
            assert (
                connection.execute(
                    text("SELECT idle_expires_at FROM auth_session")
                ).scalar_one()
                > before
            )


def test_late_otp_request_keeps_full_ten_minute_window(auth_factory, monkeypatch):
    from datetime import UTC, datetime, timedelta

    import aulalista_api.auth as authentication

    factory, sender = auth_factory
    instant = datetime.now(UTC)
    monkeypatch.setattr(authentication, "now", lambda: instant)
    with factory() as client:
        headers = bootstrap(client)
        instant += timedelta(minutes=9)
        response = client.post(
            "/auth/email/request", json={"email": "late@example.test"}, headers=headers
        )
        assert response.status_code == 202
        refreshed = response.headers.get("set-cookie", "").lower()
        assert "__host-acenta-pre=" in refreshed
        assert "max-age=600" in refreshed
        instant += timedelta(minutes=2)
        assert (
            verify(
                client,
                headers,
                response.json()["challenge_id"],
                sender.messages[-1][1],
            ).status_code
            == 200
        )


def test_failed_session_commit_rolls_back_identity_and_otp_consumption(
    auth_factory, migrated_database
):
    factory, sender = auth_factory
    with factory() as client:
        headers, challenge = request_code(client)
        code = sender.messages[-1][1]
        with migrated_database.begin() as connection:
            connection.execute(
                text("""
                CREATE FUNCTION fail_synthetic_auth_commit() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'synthetic auth commit failure'; END $$;
                CREATE CONSTRAINT TRIGGER synthetic_auth_commit_failure
                AFTER INSERT ON auth_session DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION fail_synthetic_auth_commit();
            """)
            )
        response = verify(client, headers, challenge, code)
        assert response.status_code == 503
        assert response.json() == {"detail": "unavailable"}
        with migrated_database.begin() as connection:
            assert (
                connection.execute(
                    text("SELECT count(*) FROM auth_identity")
                ).scalar_one()
                == 0
            )
            assert (
                connection.execute(
                    text("SELECT count(*) FROM auth_session")
                ).scalar_one()
                == 0
            )
            assert (
                connection.execute(
                    text("SELECT consumed FROM auth_email_challenge")
                ).scalar_one()
                is False
            )
            connection.execute(
                text("DROP TRIGGER synthetic_auth_commit_failure ON auth_session")
            )
        assert verify(client, headers, challenge, code).status_code == 200
