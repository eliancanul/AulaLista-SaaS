"""Configuración explícita; nunca lee archivos o usa una DB por omisión."""

import os
from dataclasses import dataclass, field

from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import ArgumentError


def parse_database_url(value: str | None) -> URL:
    message = "AULALISTA_DATABASE_URL must be an explicit PostgreSQL psycopg URL."
    if not value:
        raise ValueError(message)
    try:
        url = make_url(value)
        if (
            url.drivername != "postgresql+psycopg"
            or not url.host
            or "," in url.host
            or not url.database
            or not url.username
            or set(url.query) - {"sslmode"}
            or url.query.get("sslmode", "prefer")
            not in {"disable", "allow", "prefer", "require", "verify-ca", "verify-full"}
        ):
            raise ValueError(message)
        return url
    except (ArgumentError, ValueError, TypeError):
        raise ValueError(message) from None


@dataclass(frozen=True)
class Settings:
    docs_enabled: bool
    database_url: URL = field(repr=False)
    db_timeout_seconds: int


def load_settings() -> Settings:
    value = os.environ.get("AULALISTA_DOCS_ENABLED", "false").strip().lower()
    if value not in {"true", "false"}:
        raise ValueError("AULALISTA_DOCS_ENABLED must be true or false.")
    try:
        timeout = int(os.environ.get("AULALISTA_DB_TIMEOUT_SECONDS", "3"))
        if not 2 <= timeout <= 30:
            raise ValueError
    except ValueError:
        raise ValueError(
            "AULALISTA_DB_TIMEOUT_SECONDS must be an integer from 2 to 30."
        ) from None
    return Settings(
        docs_enabled=value == "true",
        database_url=parse_database_url(os.environ.get("AULALISTA_DATABASE_URL")),
        db_timeout_seconds=timeout,
    )
