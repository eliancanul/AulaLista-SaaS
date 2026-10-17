"""Sesiones y OTP transaccionales. Las sustituciones de transporte viven en tests."""

import hashlib
import hmac
import re
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Protocol
from uuid import UUID, uuid4

from sqlalchemy import select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from aulalista_api.auth_models import (
    AuthRate,
    AuthSession,
    EmailChallenge,
    Identity,
    PreSession,
)
from aulalista_api.database import PersonalScope, Principal


class AuthError(Exception):
    def __init__(self, status, detail):
        self.status, self.detail = status, detail


class EmailSender(Protocol):
    def send_code(self, email: str, code: str) -> None: ...


class TokenVerifier(Protocol):
    def verify(self, credential: str, nonce: str) -> dict: ...


@dataclass(frozen=True)
class AuthenticatedActor:
    principal_id: UUID
    session_hash: str


def now():
    return datetime.now(UTC)


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def normalized_email(value):
    if not isinstance(value, str) or len(value) > 320:
        raise AuthError(422, "invalid_request")
    # Deliberately conservative mailbox syntax. Preserve local-part semantics.
    if not re.fullmatch(
        r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?\.[A-Za-z]{2,63}",
        value,
    ):
        raise AuthError(422, "invalid_request")
    local, domain = value.rsplit("@", 1)
    if local.startswith(".") or local.endswith(".") or ".." in value:
        raise AuthError(422, "invalid_request")
    return local + "@" + domain.lower()


def live_session(db, digest, *, lock=False):
    query = select(AuthSession).where(AuthSession.token_hash == digest)
    if lock:
        query = query.with_for_update()
    row = db.scalar(query)
    instant = now()
    if (
        row is None
        or row.revoked
        or row.expires_at <= instant
        or row.idle_expires_at <= instant
    ):
        raise AuthError(401, "unauthorized")
    return row


def revalidate_actor(db, actor):
    if isinstance(actor, AuthenticatedActor):
        row = live_session(db, actor.session_hash, lock=True)
        if row.principal_id != actor.principal_id:
            raise AuthError(401, "unauthorized")
        row.idle_expires_at = min(row.expires_at, now() + timedelta(hours=2))
        return actor.principal_id
    # UUIDs are supplied only by existing direct-service fixtures/HTTP overrides.
    return actor


PUBLIC_AUTH_LIMIT_PER_MINUTE = 120


class Auth:
    def __init__(self, engine, settings, google=None, sender=None):
        self.engine, self.settings, self.google, self.sender = (
            engine,
            settings,
            google,
            sender,
        )

    def available(self):
        if self.settings is None:
            raise AuthError(503, "unavailable")

    def mac(self, purpose, *parts):
        self.available()
        payload = "\0".join((purpose, *map(str, parts))).encode()
        return hmac.new(self.settings.hmac_key, payload, hashlib.sha256).hexdigest()

    def csrf(self, token, *, pre=False):
        return self.mac("pre-csrf" if pre else "session-csrf", token)

    def check_origin(self, origin, csrf, token, *, pre=False):
        self.available()
        if (
            origin != self.settings.origin
            or not isinstance(csrf, str)
            or not secrets.compare_digest(
                csrf.encode(), self.csrf(token, pre=pre).encode()
            )
        ):
            raise AuthError(403, "csrf_failed")

    def quota(self, db, kind, value, maximum, seconds=3600):
        bucket = int(now().timestamp()) // seconds
        key = self.mac("rate", kind, value)
        statement = insert(AuthRate).values(key=key, bucket=bucket, count=1)
        count = db.scalar(
            statement.on_conflict_do_update(
                index_elements=[AuthRate.key, AuthRate.bucket],
                set_={"count": AuthRate.count + 1},
            ).returning(AuthRate.count)
        )
        return count <= maximum

    def reserve_public_budget(self):
        """Shared demo ceiling, independent of peer headers and downstream failure."""
        self.available()
        with Session(self.engine) as db, db.begin():
            allowed = self.quota(
                db, "public-auth-global", "all", PUBLIC_AUTH_LIMIT_PER_MINUTE, 60
            )
        if not allowed:
            raise AuthError(429, "rate_limited")

    def lock_identity(self, db, issuer, subject):
        key = int.from_bytes(
            hashlib.sha256((issuer + "\0" + subject).encode()).digest()[:8],
            "big",
            signed=True,
        )
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})

    def pre(self, db, token):
        row = db.scalar(
            select(PreSession)
            .where(PreSession.token_hash == token_hash(token))
            .with_for_update()
        )
        if row is None or row.consumed or row.expires_at <= now():
            raise AuthError(401, "unauthorized")
        return row

    def bootstrap(self, token, ip):
        self.available()
        error = None
        with Session(self.engine) as db, db.begin():
            if not self.quota(db, "bootstrap", ip, 30, 60):
                error = AuthError(429, "rate_limited")
            else:
                row = db.get(PreSession, token_hash(token)) if token else None
                if row is None or row.consumed or row.expires_at <= now():
                    token = secrets.token_urlsafe(32)
                    db.add(
                        PreSession(
                            token_hash=token_hash(token),
                            expires_at=now() + timedelta(minutes=10),
                            consumed=False,
                        )
                    )
        if error:
            raise error
        return token, {
            "csrf_token": self.csrf(token, pre=True),
            "google_nonce": self.mac("google-nonce", token),
            "google_client_id": self.settings.google_client_id,
            "email_available": self.sender is not None,
        }

    def provision(self, db, issuer, subject, email, verified):
        self.lock_identity(db, issuer, subject)
        identity = db.scalar(
            select(Identity).where(
                Identity.issuer == issuer, Identity.subject == subject
            )
        )
        if identity is None:
            principal = Principal()
            db.add(principal)
            db.flush()
            db.add(PersonalScope(owner_principal_id=principal.id))
            identity = Identity(
                id=uuid4(),
                issuer=issuer,
                subject=subject,
                principal_id=principal.id,
                email=email,
                email_verified=verified,
            )
            db.add(identity)
        else:
            identity.email, identity.email_verified = email, verified
        db.flush()
        return identity.principal_id

    def finish(self, db, pre, principal_id, old_token):
        if old_token:
            old = db.scalar(
                select(AuthSession)
                .where(AuthSession.token_hash == token_hash(old_token))
                .with_for_update()
            )
            if old is not None:
                old.revoked = True
        pre.consumed = True
        token = secrets.token_urlsafe(32)
        instant = now()
        db.add(
            AuthSession(
                token_hash=token_hash(token),
                principal_id=principal_id,
                expires_at=instant + timedelta(hours=24),
                idle_expires_at=instant + timedelta(hours=2),
                revoked=False,
            )
        )
        return token, self.document(db, principal_id, token)

    def document(self, db, principal_id, token):
        scope_id = db.scalar(
            select(PersonalScope.id).where(
                PersonalScope.owner_principal_id == principal_id
            )
        )
        if scope_id is None:
            raise AuthError(401, "unauthorized")
        return {
            "principal_id": str(principal_id),
            "scope_id": str(scope_id),
            "csrf_token": self.csrf(token),
        }

    def google_login(self, pre_token, credential, ip, old_token):
        self.available()
        if self.google is None or not self.settings.google_client_id:
            raise AuthError(503, "unavailable")
        # Commit shared abuse counters even when token verification fails.
        with Session(self.engine) as db, db.begin():
            self.pre(db, pre_token)
            allowed = self.quota(db, "google", ip, 20, 60)
        if not allowed:
            raise AuthError(429, "rate_limited")
        try:
            claims = self.google.verify(credential, self.mac("google-nonce", pre_token))
        except ValueError:
            raise AuthError(401, "unauthorized") from None
        with Session(self.engine) as db, db.begin():
            pre = self.pre(db, pre_token)
            principal_id = self.provision(
                db,
                "https://accounts.google.com",
                claims["sub"],
                claims["email"],
                claims["email_verified"],
            )
            return self.finish(db, pre, principal_id, old_token)

    def request_email(self, pre_token, email, ip):
        self.available()
        if self.sender is None:
            raise AuthError(503, "unavailable")
        email = normalized_email(email)
        challenge_id = uuid4()
        code = f"{secrets.randbelow(100_000_000):08d}"
        send = False
        with Session(self.engine) as db, db.begin():
            pre = self.pre(db, pre_token)
            ip_allowed = self.quota(db, "send-ip", ip, 20)
            self.lock_identity(db, "email", email)
            email_allowed = self.quota(db, "send-email", email, 5)
            recent = db.scalar(
                select(EmailChallenge.id)
                .where(
                    EmailChallenge.email == email,
                    EmailChallenge.expires_at > now() + timedelta(minutes=9),
                )
                .limit(1)
            )
            if ip_allowed and email_allowed and recent is None:
                # A freshly issued code must retain its full promised lifetime.
                pre.expires_at = now() + timedelta(minutes=10)
                db.execute(
                    update(EmailChallenge)
                    .where(EmailChallenge.email == email)
                    .values(consumed=True)
                )
                db.add(
                    EmailChallenge(
                        id=challenge_id,
                        pre_hash=pre.token_hash,
                        email=email,
                        code_mac=self.mac("email-login", challenge_id, email, code),
                        expires_at=pre.expires_at,
                        attempts=0,
                        consumed=False,
                    )
                )
                send = True
        if not ip_allowed:
            raise AuthError(429, "rate_limited")
        if send:
            try:
                self.sender.send_code(email, code)
            except Exception:
                with Session(self.engine) as db, db.begin():
                    db.execute(
                        update(EmailChallenge)
                        .where(EmailChallenge.id == challenge_id)
                        .values(consumed=True)
                    )
                raise AuthError(503, "unavailable") from None
        return {
            "challenge_id": str(challenge_id),
            "message": "Si el correo puede recibir mensajes, recibirás un código.",
        }

    def verify_email(self, pre_token, challenge_id, code, ip, old_token):
        self.available()
        if self.sender is None:
            raise AuthError(503, "unavailable")
        error, result = None, None
        with Session(self.engine) as db, db.begin():
            pre = self.pre(db, pre_token)
            ip_allowed = self.quota(db, "verify-ip", ip, 100)
            # Lock email before challenge, matching resend order.
            candidate = db.get(EmailChallenge, challenge_id)
            email = candidate.email if candidate is not None else "invalid"
            self.lock_identity(db, "email", email)
            email_allowed = self.quota(db, "verify-email", email, 20)
            challenge = db.scalar(
                select(EmailChallenge)
                .where(EmailChallenge.id == challenge_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if not ip_allowed or not email_allowed:
                error = AuthError(429, "rate_limited")
            elif (
                challenge is None
                or challenge.pre_hash != pre.token_hash
                or challenge.consumed
                or challenge.expires_at <= now()
                or challenge.attempts >= 5
            ):
                error = AuthError(400, "invalid_code")
            else:
                challenge.attempts += 1
                if not secrets.compare_digest(
                    challenge.code_mac,
                    self.mac("email-login", challenge_id, email, code),
                ):
                    error = AuthError(400, "invalid_code")
                else:
                    challenge.consumed = True
                    principal_id = self.provision(db, "email", email, email, True)
                    result = self.finish(db, pre, principal_id, old_token)
        if error:
            raise error
        return result

    def actor(self, token):
        if self.settings is None or not token:
            raise AuthError(401, "unauthorized")
        with Session(self.engine) as db:
            row = live_session(db, token_hash(token))
            return AuthenticatedActor(row.principal_id, row.token_hash)

    def session(self, token):
        self.actor(token)
        with Session(self.engine) as db, db.begin():
            row = live_session(db, token_hash(token), lock=True)
            # Status polling is observational; only private work renews idle time.
            return self.document(db, row.principal_id, token)

    def logout(self, token):
        self.actor(token)
        with Session(self.engine) as db, db.begin():
            row = live_session(db, token_hash(token), lock=True)
            row.revoked = True
