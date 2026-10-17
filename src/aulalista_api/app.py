"""Factory ASGI: salud del proceso y disponibilidad de PostgreSQL."""

from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from aulalista_api.auth_routes import install_auth_routes
from aulalista_api.config import load_settings
from aulalista_api.database import Readiness, make_engine
from aulalista_api.material_routes import install_material_routes
from aulalista_api.planning_edit_routes import install_planning_edit_routes
from aulalista_api.planning_routes import install_planning_routes
from aulalista_api.web import install_web


def create_app() -> FastAPI:
    settings = load_settings()
    engine = make_engine(settings)
    readiness = Readiness(engine, settings.db_timeout_seconds)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        try:
            yield
        finally:
            engine.dispose()

    app = FastAPI(
        title="AulaLista API",
        lifespan=lifespan,
        docs_url="/docs" if settings.docs_enabled else None,
        openapi_url="/openapi.json" if settings.docs_enabled else None,
        redoc_url=None,
    )

    @app.get("/health/live", tags=["health"])
    async def liveness() -> dict[str, Literal["ok"]]:
        return {"status": "ok"}

    @app.get("/health/ready", tags=["health"])
    async def persistence_readiness():
        ready = await readiness.check()
        return JSONResponse(
            {"status": "ok" if ready else "unavailable"},
            status_code=200 if ready else 503,
        )

    install_auth_routes(app, engine)
    install_material_routes(app, engine)
    install_planning_routes(app, engine)
    install_planning_edit_routes(app, engine)
    install_web(app)
    return app
