"""Teacher account management: linked access methods and revocable consent."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    func,
    select,
    update,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Mapped, Session, mapped_column

from aulalista_api.auth import Auth, AuthError, normalized_email
from aulalista_api.auth_models import Identity
from aulalista_api.database import Base
from aulalista_api.materials import MaterialError, authorize


class PrincipalAccountPreferences(Base):
    __tablename__ = "principal_account_preferences"

    principal_id: Mapped[UUID] = mapped_column(
        ForeignKey("principal.id"), primary_key=True
    )
    promotional_consent: Mapped[bool] = mapped_column(Boolean, default=False)
    promotional_consent_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    consent_history: Mapped[list] = mapped_column(JSONB, default=list)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class AccountLinkChallenge(Base):
    __tablename__ = "account_link_challenge"
    __table_args__ = (
        Index("ix_account_link_principal", "principal_id", "created_at"),
        CheckConstraint("attempts BETWEEN 0 AND 5", name="ck_account_link_attempts"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    principal_id: Mapped[UUID] = mapped_column(ForeignKey("principal.id"))
    email: Mapped[str] = mapped_column(String(320))
    code_mac: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    consumed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class PreferencesUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    promotional_consent: bool
    source: str = Field(default="account_settings", min_length=1, max_length=64)


class EmailLinkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(min_length=3, max_length=320)


class EmailLinkVerifyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    challenge_id: UUID
    code: str = Field(pattern=r"^[0-9]{8}$")


class GoogleLinkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    credential: str = Field(min_length=1, max_length=8192)
    nonce: str = Field(min_length=1, max_length=256)


def _provider_label(issuer: str) -> str:
    if issuer == "https://accounts.google.com":
        return "google"
    if issuer == "email":
        return "email_otp"
    return issuer


def _link_mac(
    auth: Auth | None, principal_id: UUID, challenge_id: UUID, email: str, code: str
) -> str:
    if auth is not None and auth.settings is not None:
        return auth.mac("account-link", principal_id, challenge_id, email, code)
    # Fallback deterministic HMAC when running local insecure dev server without auth_settings.
    key = b"acenta-local-account-link-fallback"
    payload = "\0".join(
        ("account-link", str(principal_id), str(challenge_id), email, code)
    ).encode()
    return hmac.new(key, payload, hashlib.sha256).hexdigest()


class AccountService:
    def __init__(self, engine: Engine, auth: Auth | None = None) -> None:
        self.engine = engine
        self.auth = auth

    def get_account(self, actor, scope_id: UUID) -> dict:
        with Session(self.engine) as db:
            principal_id = authorize(db, actor, scope_id)
            identities = db.scalars(
                select(Identity)
                .where(Identity.principal_id == principal_id)
                .order_by(Identity.issuer.asc(), Identity.email.asc())
            ).all()
            prefs = db.get(PrincipalAccountPreferences, principal_id)
            return {
                "principal_id": str(principal_id),
                "scope_id": str(scope_id),
                "identities": [
                    {
                        "id": str(row.id),
                        "provider": _provider_label(row.issuer),
                        "email": row.email,
                        "email_verified": row.email_verified,
                    }
                    for row in identities
                ],
                "promotional_consent": bool(prefs.promotional_consent)
                if prefs
                else False,
                "promotional_consent_updated_at": (
                    prefs.promotional_consent_updated_at.astimezone(UTC).isoformat()
                    if prefs and prefs.promotional_consent_updated_at
                    else None
                ),
                "consent_history": list(prefs.consent_history or [])[-20:]
                if prefs
                else [],
                "capabilities": {
                    "email_otp_available": bool(
                        self.auth and self.auth.sender is not None
                    ),
                    "google_available": bool(
                        self.auth
                        and self.auth.google is not None
                        and self.auth.settings
                        and self.auth.settings.google_client_id
                    ),
                },
            }

    def update_preferences(
        self, actor, scope_id: UUID, req: PreferencesUpdateRequest
    ) -> dict:
        now = datetime.now(UTC)
        with Session(self.engine) as db:
            principal_id = authorize(db, actor, scope_id)
            prefs = db.get(PrincipalAccountPreferences, principal_id)
            entry = {
                "promotional_consent": req.promotional_consent,
                "at": now.isoformat(),
                "source": req.source.strip(),
            }
            if prefs is None:
                prefs = PrincipalAccountPreferences(
                    principal_id=principal_id,
                    promotional_consent=req.promotional_consent,
                    promotional_consent_updated_at=now,
                    consent_history=[entry],
                    updated_at=now,
                )
                db.add(prefs)
            else:
                history = list(prefs.consent_history or [])
                history.append(entry)
                prefs.promotional_consent = req.promotional_consent
                prefs.promotional_consent_updated_at = now
                prefs.consent_history = history[-50:]
                prefs.updated_at = now
            db.commit()
        return self.get_account(actor, scope_id)

    def request_email_link(self, actor, scope_id: UUID, req: EmailLinkRequest) -> dict:
        if self.auth is None or self.auth.sender is None:
            raise MaterialError(503, "email_sender_unavailable")
        try:
            email = normalized_email(req.email)
        except AuthError as exc:
            raise MaterialError(exc.status, exc.detail) from None

        challenge_id = uuid4()
        code = f"{secrets.randbelow(100_000_000):08d}"
        now = datetime.now(UTC)
        expires_at = now + timedelta(minutes=10)

        with Session(self.engine) as db:
            principal_id = authorize(db, actor, scope_id)
            existing = db.scalar(
                select(Identity).where(
                    Identity.issuer == "email", Identity.subject == email
                )
            )
            if existing is not None:
                if existing.principal_id == principal_id:
                    raise MaterialError(409, "identity_already_linked")
                raise MaterialError(409, "identity_conflict")

            db.execute(
                update(AccountLinkChallenge)
                .where(
                    AccountLinkChallenge.principal_id == principal_id,
                    AccountLinkChallenge.email == email,
                    AccountLinkChallenge.consumed.is_(False),
                )
                .values(consumed=True)
            )
            db.add(
                AccountLinkChallenge(
                    id=challenge_id,
                    principal_id=principal_id,
                    email=email,
                    code_mac=_link_mac(
                        self.auth, principal_id, challenge_id, email, code
                    ),
                    expires_at=expires_at,
                    attempts=0,
                    consumed=False,
                    created_at=now,
                )
            )
            db.commit()

        try:
            self.auth.sender.send_code(email, code)
        except Exception:
            with Session(self.engine) as db:
                db.execute(
                    update(AccountLinkChallenge)
                    .where(AccountLinkChallenge.id == challenge_id)
                    .values(consumed=True)
                )
                db.commit()
            raise MaterialError(503, "email_delivery_failed") from None

        return {
            "challenge_id": str(challenge_id),
            "email": email,
            "expires_at": expires_at.isoformat(),
            "message": "Enviamos un código de verificación de 8 dígitos para vincular tu correo.",
        }

    def verify_email_link(
        self, actor, scope_id: UUID, req: EmailLinkVerifyRequest
    ) -> dict:
        now = datetime.now(UTC)
        with Session(self.engine) as db:
            principal_id = authorize(db, actor, scope_id)
            challenge = db.scalar(
                select(AccountLinkChallenge)
                .where(
                    AccountLinkChallenge.id == req.challenge_id,
                    AccountLinkChallenge.principal_id == principal_id,
                )
                .with_for_update()
            )
            if (
                challenge is None
                or challenge.consumed
                or challenge.expires_at <= now
                or challenge.attempts >= 5
            ):
                raise MaterialError(400, "invalid_code")
            challenge.attempts += 1
            expected = _link_mac(
                self.auth, principal_id, challenge.id, challenge.email, req.code
            )
            if not secrets.compare_digest(challenge.code_mac, expected):
                db.commit()
                raise MaterialError(400, "invalid_code")

            existing = db.scalar(
                select(Identity).where(
                    Identity.issuer == "email", Identity.subject == challenge.email
                )
            )
            if existing is not None:
                challenge.consumed = True
                db.commit()
                if existing.principal_id == principal_id:
                    raise MaterialError(409, "identity_already_linked")
                raise MaterialError(409, "identity_conflict")

            challenge.consumed = True
            db.add(
                Identity(
                    id=uuid4(),
                    issuer="email",
                    subject=challenge.email,
                    principal_id=principal_id,
                    email=challenge.email,
                    email_verified=True,
                )
            )
            db.commit()
        return self.get_account(actor, scope_id)

    def link_google(self, actor, scope_id: UUID, req: GoogleLinkRequest) -> dict:
        if self.auth is None or self.auth.google is None:
            raise MaterialError(503, "google_verifier_unavailable")
        try:
            claims = self.auth.google.verify(req.credential, req.nonce)
        except ValueError:
            raise MaterialError(401, "invalid_google_credential") from None

        with Session(self.engine) as db:
            principal_id = authorize(db, actor, scope_id)
            existing = db.scalar(
                select(Identity).where(
                    Identity.issuer == "https://accounts.google.com",
                    Identity.subject == claims["sub"],
                )
            )
            if existing is not None:
                if existing.principal_id == principal_id:
                    raise MaterialError(409, "identity_already_linked")
                raise MaterialError(409, "identity_conflict")
            db.add(
                Identity(
                    id=uuid4(),
                    issuer="https://accounts.google.com",
                    subject=claims["sub"],
                    principal_id=principal_id,
                    email=claims["email"],
                    email_verified=bool(claims.get("email_verified", True)),
                )
            )
            db.commit()
        return self.get_account(actor, scope_id)
