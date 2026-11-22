"""HTTP routes for SEP/NEM curricular catalog and teacher curricular profiles."""

from __future__ import annotations

from uuid import UUID

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from aulalista_api.curriculum import CurricularProfileUpsertRequest, CurriculumService
from aulalista_api.material_routes import bounded_content, require_actor
from aulalista_api.materials import MaterialError

MAX_CURRICULUM_BODY_BYTES = 32_768


def install_curriculum_routes(app: FastAPI, engine) -> None:
    service = CurriculumService(engine)
    app.state.curriculum = service

    @app.get("/scopes/{scope_id}/curriculum/catalog", tags=["curriculum"])
    async def get_curriculum_catalog(scope_id: UUID, actor=Depends(require_actor)):
        doc = await run_in_threadpool(service.catalog, actor, scope_id)
        return JSONResponse(doc, headers={"Cache-Control": "no-store"})

    @app.get("/scopes/{scope_id}/curriculum/profiles", tags=["curriculum"])
    async def list_curriculum_profiles(scope_id: UUID, actor=Depends(require_actor)):
        doc = await run_in_threadpool(service.list_profiles, actor, scope_id)
        return JSONResponse(doc, headers={"Cache-Control": "no-store"})

    @app.put(
        "/scopes/{scope_id}/curriculum/profiles/{school_id}/{subject_id}",
        tags=["curriculum"],
    )
    async def upsert_curriculum_profile(
        scope_id: UUID,
        school_id: str,
        subject_id: str,
        request: Request,
        actor=Depends(require_actor),
    ):
        raw = await bounded_content(
            request,
            media_type="application/json",
            max_bytes=MAX_CURRICULUM_BODY_BYTES,
        )
        try:
            body = CurricularProfileUpsertRequest.model_validate_json(raw)
        except ValidationError:
            raise MaterialError(422, "invalid_request") from None
        doc = await run_in_threadpool(
            service.upsert_profile, actor, scope_id, school_id, subject_id, body
        )
        return JSONResponse(doc, headers={"Cache-Control": "no-store"})
