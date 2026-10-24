"""Bounded HTTP chat using the existing session and CSRF dependencies."""

from typing import Annotated
from uuid import UUID

from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from aulalista_api.chat import Conversations
from aulalista_api.chat_models import CreateConversation, TurnRequest
from aulalista_api.material_routes import Actor, Operation, bounded_content
from aulalista_api.materials import MaterialError


def response(value, status=200):
    return JSONResponse(
        value, status_code=status, headers={"Cache-Control": "no-store"}
    )


async def parse_body(request, model):
    content = await bounded_content(
        request, media_type="application/json", max_bytes=32768
    )
    try:
        return model.model_validate_json(content)
    except ValidationError:
        raise MaterialError(422, "invalid_request") from None


def install_chat_routes(app: FastAPI, engine, *, provider=None, profile=None):
    service = Conversations(engine, provider, profile)
    app.state.chat = service

    @app.get("/scopes/{scope_id}/chat-capability")
    def capability(scope_id: UUID, actor: Actor):
        return response(service.capability(actor, scope_id))

    @app.get("/scopes/{scope_id}/conversations")
    def listing(
        scope_id: UUID,
        actor: Actor,
        cursor: UUID | None = None,
        limit: Annotated[int, Query(ge=1, le=50)] = 50,
    ):
        return response(service.list(actor, scope_id, cursor=cursor, limit=limit))

    @app.post("/scopes/{scope_id}/conversations", status_code=201)
    async def create(
        scope_id: UUID, actor: Actor, operation: Operation, request: Request
    ):
        await parse_body(request, CreateConversation)
        return response(
            await run_in_threadpool(service.create, actor, scope_id, operation), 201
        )

    @app.get("/scopes/{scope_id}/conversation-operations/{operation_id}")
    def creation_operation(scope_id: UUID, operation_id: UUID, actor: Actor):
        return response(service.read(actor, scope_id, creation_operation=operation_id))

    @app.get("/scopes/{scope_id}/conversations/{conversation_id}")
    def read(scope_id: UUID, conversation_id: UUID, actor: Actor):
        return response(service.read(actor, scope_id, conversation_id))

    @app.get(
        "/scopes/{scope_id}/conversations/{conversation_id}/operations/{operation_id}"
    )
    def operation(
        scope_id: UUID, conversation_id: UUID, operation_id: UUID, actor: Actor
    ):
        return response(
            service.read(actor, scope_id, conversation_id, turn_operation=operation_id)
        )

    @app.post(
        "/scopes/{scope_id}/conversations/{conversation_id}/turns", status_code=201
    )
    async def write(
        scope_id: UUID,
        conversation_id: UUID,
        actor: Actor,
        operation: Operation,
        request: Request,
    ):
        body = await parse_body(request, TurnRequest)
        return response(
            await run_in_threadpool(
                service.write, actor, scope_id, conversation_id, operation, body
            ),
            201,
        )
