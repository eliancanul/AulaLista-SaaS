"""Factory ASGI. Este bootstrap sólo acredita vida del proceso."""

from typing import Literal

from fastapi import FastAPI

from aulalista_api.config import load_settings


def create_app() -> FastAPI:
    settings = load_settings()
    app = FastAPI(
        title="AulaLista API",
        docs_url="/docs" if settings.docs_enabled else None,
        openapi_url="/openapi.json" if settings.docs_enabled else None,
        redoc_url=None,
    )

    @app.get("/health/live", tags=["health"])
    async def liveness() -> dict[str, Literal["ok"]]:
        return {"status": "ok"}

    return app
