"""Autenticación opt-in; ninguna clave, identidad ni transporte de desarrollo."""

import base64
import os
from dataclasses import dataclass, field
from urllib.parse import urlsplit


@dataclass(frozen=True)
class AuthSettings:
    origin: str
    hmac_key: bytes = field(repr=False)
    google_client_id: str | None = None
    allowed_emails: frozenset[str] | None = None


def load_auth_settings() -> AuthSettings | None:
    origin = os.environ.get("AULALISTA_AUTH_ORIGIN")
    key = os.environ.get("AULALISTA_AUTH_HMAC_KEY")
    client = os.environ.get("AULALISTA_GOOGLE_CLIENT_ID")
    allowed_raw = os.environ.get("AULALISTA_ALLOWED_EMAILS", "").strip()
    if not any((origin, key, client)):
        return None
    try:
        if not origin or not key:
            raise ValueError
        parsed = urlsplit(origin)
        _ = parsed.port  # Reject malformed ports before enabling authentication.
        if any(character.isspace() for character in origin):
            raise ValueError
        if (
            parsed.path
            or parsed.query
            or parsed.fragment
            or parsed.username
            or parsed.password
            or not parsed.hostname
            or parsed.scheme not in {"https", "http"}
            or (
                parsed.scheme == "http"
                and parsed.hostname not in {"localhost", "127.0.0.1", "::1"}
            )
        ):
            raise ValueError
        decoded = base64.b64decode(key, altchars=b"-_", validate=True)
        if len(decoded) < 32:
            raise ValueError
        if client and (
            not client.endswith(".apps.googleusercontent.com") or len(client) > 255
        ):
            raise ValueError
        allowed_emails: frozenset[str] | None = None
        if allowed_raw:
            parsed_emails = {
                item.strip().lower() for item in allowed_raw.split(",") if item.strip()
            }
            if not parsed_emails:
                raise ValueError
            allowed_emails = frozenset(parsed_emails)
        return AuthSettings(origin, decoded, client, allowed_emails)
    except (ValueError, TypeError):
        raise ValueError(
            "Invalid or incomplete authentication configuration."
        ) from None
