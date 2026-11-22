"""HTTP routes for multi-agent teacher chat (Orchestrator -> Subject Agents)."""

from __future__ import annotations

from uuid import UUID

from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from aulalista_api.agent_chat import (
    AgentChatService,
    AgentContextRequest,
    AgentTurnRequest,
)
from aulalista_api.material_routes import Actor, Operation, bounded_content
from aulalista_api.materials import MaterialError


def _json_response(value: dict, status: int = 200) -> JSONResponse:
    return JSONResponse(
        value, status_code=status, headers={"Cache-Control": "no-store"}
    )


async def _parse_json(request: Request, model):
    content = await bounded_content(
        request, media_type="application/json", max_bytes=32768
    )
    try:
        return model.model_validate_json(content)
    except ValidationError:
        raise MaterialError(422, "invalid_request") from None


def install_agent_chat_routes(app: FastAPI, engine, *, provider=None) -> None:
    service = AgentChatService(engine, provider=provider)
    app.state.agent_chat = service

    @app.get("/scopes/{scope_id}/agent-chat/capability")
    def agent_chat_capability(scope_id: UUID, actor: Actor):
        return _json_response(service.capability(actor, scope_id))

    @app.get("/scopes/{scope_id}/agent-chat/channels")
    def list_agent_channels(
        scope_id: UUID,
        actor: Actor,
        school_id: str | None = Query(default=None, max_length=80),
    ):
        return _json_response(
            service.list_channels(actor, scope_id, school_id=school_id)
        )

    @app.get("/scopes/{scope_id}/agent-chat/channels/{channel_key}")
    def read_agent_channel(scope_id: UUID, channel_key: str, actor: Actor):
        return _json_response(service.get_channel(actor, scope_id, channel_key))

    @app.post(
        "/scopes/{scope_id}/agent-chat/channels/{channel_key}/turns",
        status_code=201,
    )
    async def send_agent_turn(
        scope_id: UUID,
        channel_key: str,
        actor: Actor,
        operation: Operation,
        request: Request,
    ):
        body = await _parse_json(request, AgentTurnRequest)
        result = await run_in_threadpool(
            service.send_turn, actor, scope_id, channel_key, operation, body
        )
        return _json_response(result, status=201)

    @app.post(
        "/scopes/{scope_id}/agent-chat/channels/{channel_key}/context",
        status_code=200,
    )
    async def update_agent_context(
        scope_id: UUID,
        channel_key: str,
        actor: Actor,
        operation: Operation,
        request: Request,
    ):
        body = await _parse_json(request, AgentContextRequest)
        result = await run_in_threadpool(
            service.update_context, actor, scope_id, channel_key, operation, body
        )
        return _json_response(result, status=200)
