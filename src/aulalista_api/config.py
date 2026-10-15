"""Configuración explícita del proceso, sin lectura implícita de archivos."""

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    docs_enabled: bool


def load_settings() -> Settings:
    value = os.environ.get("AULALISTA_DOCS_ENABLED", "false").strip().lower()
    if value not in {"true", "false"}:
        raise ValueError("AULALISTA_DOCS_ENABLED must be true or false.")
    return Settings(docs_enabled=value == "true")
