"""Transporte B3: payload acotado y autoridad cerrada heredada de T2."""

from typing import Annotated
from uuid import UUID

from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from aulalista_api.material_routes import Actor, Operation, bounded_content
from aulalista_api.materials import MaterialError
from aulalista_api.planning_edits import (
    MAX_EDIT_BYTES,
    CopyRequest,
    DraftRequest,
    EditRequest,
    PlanningEdits,
)


async def payload(request: Request, schema):
    body = await bounded_content(
        request, media_type="application/json", max_bytes=MAX_EDIT_BYTES
    )
    try:
        return schema.model_validate_json(body)
    except ValidationError:
        raise MaterialError(422, "invalid_request") from None


def response(document, status=200):
    return JSONResponse(
        document, status_code=status, headers={"Cache-Control": "no-store"}
    )


def install_planning_edit_routes(app: FastAPI, engine):
    edits = PlanningEdits(engine)

    @app.post("/scopes/{scope_id}/plannings/{planning_id}/revisions", status_code=201)
    async def edit(
        scope_id: UUID,
        planning_id: UUID,
        actor: Actor,
        operation: Operation,
        request: Request,
    ):
        body = await payload(request, EditRequest)
        saved = await run_in_threadpool(
            edits.write, actor, scope_id, planning_id, operation, body
        )
        return response(saved, 201)

    @app.post("/scopes/{scope_id}/plannings/{planning_id}/copies", status_code=201)
    async def copy(
        scope_id: UUID,
        planning_id: UUID,
        actor: Actor,
        operation: Operation,
        request: Request,
    ):
        body = await payload(request, CopyRequest)
        saved = await run_in_threadpool(
            edits.write, actor, scope_id, planning_id, operation, body, copy=True
        )
        return response(saved, 201)

    @app.get("/scopes/{scope_id}/plannings/{planning_id}/revisions/{number}")
    def revision(scope_id: UUID, planning_id: UUID, number: int, actor: Actor):
        return response(edits.read_revision(actor, scope_id, planning_id, number))

    @app.put(
        "/scopes/{scope_id}/plannings/{planning_id}/drafts/{draft_id}", status_code=201
    )
    async def preserve(
        scope_id: UUID,
        planning_id: UUID,
        draft_id: UUID,
        actor: Actor,
        operation: Operation,
        request: Request,
    ):
        body = await payload(request, DraftRequest)
        saved = await run_in_threadpool(
            edits.preserve_draft,
            actor,
            scope_id,
            planning_id,
            draft_id,
            operation,
            body,
        )
        return response(saved, 201)

    @app.get("/scopes/{scope_id}/planning-drafts/{draft_id}")
    def draft(scope_id: UUID, draft_id: UUID, actor: Actor):
        return response(edits.read_draft(actor, scope_id, draft_id=draft_id))

    @app.get("/scopes/{scope_id}/planning-draft-operations/{operation_id}")
    def operation(scope_id: UUID, operation_id: UUID, actor: Actor):
        return response(edits.read_draft(actor, scope_id, operation_id=operation_id))

    @app.get("/scopes/{scope_id}/plannings")
    def plannings(
        scope_id: UUID,
        actor: Actor,
        after: UUID | None = None,
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
    ):
        return response(edits.list_items(actor, scope_id, after=after, limit=limit))

    @app.get("/scopes/{scope_id}/planning-drafts")
    def drafts(
        scope_id: UUID,
        actor: Actor,
        after: UUID | None = None,
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
    ):
        return response(
            edits.list_items(actor, scope_id, drafts=True, after=after, limit=limit)
        )
