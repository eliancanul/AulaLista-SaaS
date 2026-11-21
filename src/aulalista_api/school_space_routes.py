"""HTTP routes for persisting teacher schools and subjects per personal scope."""

from __future__ import annotations

from uuid import UUID

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from aulalista_api.material_routes import Actor, bounded_content
from aulalista_api.materials import MaterialError
from aulalista_api.school_spaces import SchoolSpacesService, SchoolSpacesUpdate

MAX_SCHOOL_SPACES_BYTES = 32768


def install_school_space_routes(app: FastAPI, engine) -> SchoolSpacesService:
    service = SchoolSpacesService(engine)
    app.state.school_spaces = service

    @app.get("/scopes/{scope_id}/school-spaces")
    def read_school_spaces(scope_id: UUID, actor: Actor):
        return JSONResponse(
            service.get(actor, scope_id),
            headers={"Cache-Control": "no-store"},
        )

    @app.put("/scopes/{scope_id}/school-spaces")
    async def update_school_spaces(scope_id: UUID, actor: Actor, request: Request):
        content = await bounded_content(
            request,
            media_type="application/json",
            max_bytes=MAX_SCHOOL_SPACES_BYTES,
        )
        try:
            payload = SchoolSpacesUpdate.model_validate_json(content)
        except ValidationError:
            raise MaterialError(422, "invalid_request") from None
        saved = await run_in_threadpool(service.update, actor, scope_id, payload)
        return JSONResponse(saved, headers={"Cache-Control": "no-store"})

    return service
