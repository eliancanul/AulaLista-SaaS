"""Bounded transport for manual sections and explicit exact-revision derivation."""

from typing import Annotated
from uuid import UUID

from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from aulalista_api.analytic_sections import (
    MAX_SECTION_BYTES,
    AnalyticSectionData,
    AnalyticSectionEdit,
    AnalyticSections,
    DerivePlanningRequest,
)
from aulalista_api.material_routes import Actor, Operation, bounded_content
from aulalista_api.materials import MaterialError
from aulalista_api.plannings import MAX_REQUEST_BYTES, Plannings


def response(value, status=200):
    return JSONResponse(
        value, status_code=status, headers={"Cache-Control": "no-store"}
    )


async def payload(request, model, limit=MAX_SECTION_BYTES):
    content = await bounded_content(
        request, media_type="application/json", max_bytes=limit
    )
    try:
        return model.model_validate_json(content)
    except ValidationError:
        raise MaterialError(422, "invalid_request") from None


def install_analytic_section_routes(app: FastAPI, engine):
    sections = AnalyticSections(engine)
    plannings = Plannings(engine)

    @app.post("/scopes/{scope_id}/analytic-sections", status_code=201)
    async def create_section(
        scope_id: UUID, actor: Actor, operation: Operation, request: Request
    ):
        data = await payload(request, AnalyticSectionData)
        return response(
            await run_in_threadpool(sections.write, actor, scope_id, operation, data),
            201,
        )

    @app.get("/scopes/{scope_id}/analytic-sections")
    def list_sections(
        scope_id: UUID,
        actor: Actor,
        after: UUID | None = None,
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
    ):
        return response(sections.list_items(actor, scope_id, after=after, limit=limit))

    @app.get("/scopes/{scope_id}/analytic-sections/{section_id}")
    def read_section(scope_id: UUID, section_id: UUID, actor: Actor):
        return response(sections.read(actor, scope_id, section_id=section_id))

    @app.get("/scopes/{scope_id}/analytic-sections/{section_id}/revisions/{number}")
    def read_revision(scope_id: UUID, section_id: UUID, number: int, actor: Actor):
        return response(
            sections.read(actor, scope_id, section_id=section_id, number=number)
        )

    @app.post(
        "/scopes/{scope_id}/analytic-sections/{section_id}/revisions", status_code=201
    )
    async def edit_section(
        scope_id: UUID,
        section_id: UUID,
        actor: Actor,
        operation: Operation,
        request: Request,
    ):
        edit = await payload(request, AnalyticSectionEdit)
        return response(
            await run_in_threadpool(
                sections.write,
                actor,
                scope_id,
                operation,
                edit.data,
                section_id=section_id,
                expected_revision=edit.expected_revision,
            ),
            201,
        )

    @app.get("/scopes/{scope_id}/analytic-section-operations/{operation_id}")
    def read_operation(scope_id: UUID, operation_id: UUID, actor: Actor):
        return response(sections.read(actor, scope_id, operation_id=operation_id))

    @app.post(
        "/scopes/{scope_id}/analytic-sections/{section_id}/revisions/{number}/plannings",
        status_code=201,
    )
    async def derive_planning(
        scope_id: UUID,
        section_id: UUID,
        number: int,
        actor: Actor,
        operation: Operation,
        request: Request,
    ):
        data = await payload(request, DerivePlanningRequest, MAX_REQUEST_BYTES)
        return response(
            await run_in_threadpool(
                plannings.derive,
                actor,
                scope_id,
                operation,
                section_id,
                number,
                data,
            ),
            201,
        )
