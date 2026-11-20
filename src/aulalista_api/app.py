"""Factory ASGI: salud del proceso y disponibilidad de PostgreSQL."""

import asyncio
import os
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from aulalista_api.analytic_section_routes import install_analytic_section_routes
from aulalista_api.annex_routes import install_annex_routes
from aulalista_api.auth_routes import install_auth_routes
from aulalista_api.chat_routes import install_chat_routes
from aulalista_api.config import load_settings
from aulalista_api.database import Readiness, make_engine
from aulalista_api.material_routes import install_material_routes
from aulalista_api.pilot import ManualPilotConfig
from aulalista_api.planning_edit_routes import install_planning_edit_routes
from aulalista_api.planning_routes import install_planning_routes
from aulalista_api.print_routes import install_print_routes
from aulalista_api.web import install_web


def _poller_interval(override: int | None) -> int:
    if override is not None:
        return max(0, override)
    raw = os.environ.get("AULALISTA_PRINT_POLLER_SECONDS", "0").strip()
    try:
        value = int(raw)
    except ValueError:
        return 0
    return max(0, value)


def create_app(
    *,
    planning_provider=None,
    generation_profile=None,
    pilot_config=None,
    annex_generator=None,
    mail_sender=None,
    print_poller_seconds: int | None = None,
) -> FastAPI:
    if pilot_config is not None:
        if (
            not isinstance(pilot_config, ManualPilotConfig)
            or generation_profile is not None
        ):
            raise ValueError("invalid_manual_pilot")
        generation_profile = pilot_config.generation_profile(planning_provider)
    settings = load_settings()
    engine = make_engine(settings)
    readiness = Readiness(engine, settings.db_timeout_seconds)
    poller_seconds = _poller_interval(print_poller_seconds)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        poller_task: asyncio.Task[None] | None = None
        if poller_seconds > 0:

            async def _poll_loop() -> None:
                while True:
                    await asyncio.sleep(poller_seconds)
                    try:
                        await asyncio.to_thread(app.state.print_jobs.dispatch_due_jobs)
                    except Exception:
                        pass

            poller_task = asyncio.create_task(_poll_loop())
        try:
            yield
        finally:
            if poller_task is not None:
                poller_task.cancel()
                try:
                    await poller_task
                except asyncio.CancelledError:
                    pass
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
    install_planning_routes(
        app, engine, provider=planning_provider, profile=generation_profile
    )
    install_chat_routes(
        app, engine, provider=planning_provider, profile=generation_profile
    )
    install_planning_edit_routes(app, engine)
    install_analytic_section_routes(app, engine)
    install_annex_routes(app, engine, generator=annex_generator)
    install_print_routes(app, engine, mail_sender=mail_sender)
    install_web(app)
    return app
