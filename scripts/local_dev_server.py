"""Local-only insecure dev server (lives outside src/ and is never packaged in the wheel).

Auto-provisions a local teacher principal/scope and bypasses Google OAuth/CSRF
so you can test OpenAI annex generation, PDF copies, and Epson SMTP printing
locally on http://127.0.0.1:8010 before deploying to Render with Google OAuth.
"""

from __future__ import annotations

import os
from uuid import UUID

from fastapi.responses import JSONResponse, Response
from fastapi.routing import APIRoute
from sqlalchemy import select
from sqlalchemy.orm import Session

from aulalista_api.app import create_app
from aulalista_api.config import load_settings
from aulalista_api.database import PersonalScope, Principal, make_engine
from aulalista_api.material_routes import require_actor

LOCAL_PRINCIPAL_ID = UUID("00000000-0000-4000-8000-000000000001")


def _ensure_local_scope() -> tuple[UUID, UUID]:
    engine = make_engine(load_settings())
    try:
        with Session(engine) as session:
            principal = session.get(Principal, LOCAL_PRINCIPAL_ID)
            if principal is None:
                principal = Principal(id=LOCAL_PRINCIPAL_ID)
                session.add(principal)
                session.flush()
            scope = session.scalar(
                select(PersonalScope).where(
                    PersonalScope.owner_principal_id == LOCAL_PRINCIPAL_ID
                )
            )
            if scope is None:
                scope = PersonalScope(owner_principal_id=LOCAL_PRINCIPAL_ID)
                session.add(scope)
            session.commit()
            return LOCAL_PRINCIPAL_ID, scope.id
    finally:
        engine.dispose()


def create_local_app():
    if os.environ.get("AULALISTA_LOCAL_INSECURE", "").strip().lower() != "true":
        raise RuntimeError(
            "Refusing to start local insecure server without AULALISTA_LOCAL_INSECURE=true."
        )
    principal_id, scope_id = _ensure_local_scope()
    poller_seconds = int(os.environ.get("AULALISTA_PRINT_POLLER_SECONDS", "15"))
    app = create_app(print_poller_seconds=poller_seconds)
    app.dependency_overrides[require_actor] = lambda: principal_id

    # Replace /auth/session and /auth/logout with local auto-authenticated handlers.
    app.router.routes = [
        route
        for route in app.router.routes
        if not (
            isinstance(route, APIRoute)
            and route.path in {"/auth/session", "/auth/logout"}
        )
    ]

    @app.get("/auth/session", include_in_schema=False)
    def local_session():
        return JSONResponse(
            {
                "principal_id": str(principal_id),
                "scope_id": str(scope_id),
                "csrf_token": "local-dev-csrf",
                "recovery_context_id": None,
            },
            headers={"Cache-Control": "no-store"},
        )

    @app.post("/auth/logout", status_code=204, include_in_schema=False)
    def local_logout():
        return Response(status_code=204, headers={"Cache-Control": "no-store"})

    return app
