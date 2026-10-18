"""Transporte limitado; mantiene la dependencia de identidad cerrada de T2."""

from uuid import UUID

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from aulalista_api.guided_planning import (
    GeneratedPlanningRequest,
    GuidedPlanningRequest,
)
from aulalista_api.material_routes import Actor, Operation, bounded_content
from aulalista_api.materials import MaterialError
from aulalista_api.planning_generation import GeneratedPlannings
from aulalista_api.plannings import MAX_REQUEST_BYTES, PlanningRequest, Plannings


def install_planning_routes(
    app: FastAPI, engine, *, provider=None, profile=None
) -> None:
    plannings = Plannings(engine)
    generation = GeneratedPlannings(engine, provider=provider, profile=profile)
    app.state.planning_generation = generation

    @app.get("/scopes/{scope_id}/planning-generation")
    def generation_capability(scope_id: UUID, actor: Actor):
        return JSONResponse(
            generation.capability(actor, scope_id),
            headers={"Cache-Control": "no-store"},
        )

    @app.post("/scopes/{scope_id}/generated-plannings", status_code=201)
    async def create_generated_planning(
        scope_id: UUID, actor: Actor, operation: Operation, request: Request
    ):
        content = await bounded_content(
            request, media_type="application/json", max_bytes=MAX_REQUEST_BYTES
        )
        try:
            payload = GeneratedPlanningRequest.model_validate_json(content)
        except ValidationError:
            raise MaterialError(422, "invalid_request") from None
        saved = await run_in_threadpool(
            generation.write, actor, scope_id, operation, payload
        )
        return JSONResponse(
            saved, status_code=201, headers={"Cache-Control": "no-store"}
        )

    @app.post("/scopes/{scope_id}/plannings", status_code=201)
    async def create_planning(
        scope_id: UUID, actor: Actor, operation: Operation, request: Request
    ):
        content = await bounded_content(
            request, media_type="application/json", max_bytes=MAX_REQUEST_BYTES
        )
        try:
            payload = PlanningRequest.model_validate_json(content)
        except ValidationError:
            raise MaterialError(422, "invalid_request") from None
        saved = await run_in_threadpool(
            plannings.write, actor, scope_id, operation, payload
        )
        return JSONResponse(
            saved, status_code=201, headers={"Cache-Control": "no-store"}
        )

    @app.post("/scopes/{scope_id}/guided-plannings", status_code=201)
    async def create_guided_planning(
        scope_id: UUID, actor: Actor, operation: Operation, request: Request
    ):
        content = await bounded_content(
            request, media_type="application/json", max_bytes=MAX_REQUEST_BYTES
        )
        try:
            payload = GuidedPlanningRequest.model_validate_json(content)
        except ValidationError:
            raise MaterialError(422, "invalid_request") from None
        saved = await run_in_threadpool(
            plannings.write, actor, scope_id, operation, payload
        )
        return JSONResponse(
            saved, status_code=201, headers={"Cache-Control": "no-store"}
        )

    @app.get("/scopes/{scope_id}/plannings/{planning_id}")
    def read_planning(scope_id: UUID, planning_id: UUID, actor: Actor):
        return JSONResponse(
            plannings.read(actor, scope_id, planning_id=planning_id),
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/scopes/{scope_id}/planning-operations/{operation_id}")
    def read_operation(scope_id: UUID, operation_id: UUID, actor: Actor):
        try:
            saved = plannings.read(actor, scope_id, operation_id=operation_id)
        except MaterialError as error:
            if error.status != 404:
                raise
            saved = generation.operation(actor, scope_id, operation_id)
        return JSONResponse(
            saved,
            headers={"Cache-Control": "no-store"},
        )
