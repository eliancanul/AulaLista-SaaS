"""HTTP sólo aporta transporte: la autoridad se comprueba dentro de Materials."""

from typing import Annotated
from uuid import UUID

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError
from starlette.concurrency import run_in_threadpool
from starlette.requests import ClientDisconnect

from aulalista_api.materials import MAX_CONTENT_BYTES, MaterialError, Materials


def require_actor() -> UUID:
    # Only tests override this dependency; no runtime config/header grants identity.
    raise HTTPException(401, "unauthorized")


Actor = Annotated[UUID, Depends(require_actor)]
Operation = Annotated[UUID, Header(alias="Idempotency-Key")]


async def bounded_content(request: Request) -> bytes:
    if request.headers.get("content-type", "").lower() != "application/octet-stream":
        raise MaterialError(415, "unsupported_media_type")
    declared = request.headers.get("content-length")
    if declared is not None:
        if not declared.isascii() or not declared.isdecimal():
            raise MaterialError(422, "invalid_request")
        # Compare text first so an untrusted integer cannot consume unbounded work.
        significant = declared.lstrip("0") or "0"
        if len(significant) > 5 or int(significant) > MAX_CONTENT_BYTES:
            raise MaterialError(413, "content_too_large")
    content = bytearray()
    try:
        async for chunk in request.stream():
            if len(chunk) > MAX_CONTENT_BYTES - len(content):
                raise MaterialError(413, "content_too_large")
            content.extend(chunk)
    except ClientDisconnect:
        raise MaterialError(422, "invalid_request") from None
    if not content:
        raise MaterialError(422, "invalid_request")
    return bytes(content)


def install_material_routes(app: FastAPI, engine: Engine) -> None:
    materials = Materials(engine)

    @app.exception_handler(MaterialError)
    async def material_error(request, error):
        return JSONResponse({"detail": error.detail}, status_code=error.status)

    @app.exception_handler(SQLAlchemyError)
    async def persistence_error(request, error):
        return JSONResponse({"detail": "unavailable"}, status_code=503)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, error):
        return JSONResponse({"detail": "invalid_request"}, status_code=422)

    @app.post("/scopes/{scope_id}/sources", status_code=201)
    async def create_source(
        scope_id: UUID, actor: Actor, operation: Operation, request: Request
    ):
        content = await bounded_content(request)
        return await run_in_threadpool(
            materials.write, actor, scope_id, operation, content
        )

    @app.post("/scopes/{scope_id}/sources/{source_id}/versions", status_code=201)
    async def append_version(
        scope_id: UUID,
        source_id: UUID,
        actor: Actor,
        operation: Operation,
        request: Request,
        expected_version: Annotated[int, Query(ge=1, le=2_147_483_646)],
    ):
        content = await bounded_content(request)
        return await run_in_threadpool(
            materials.write,
            actor,
            scope_id,
            operation,
            content,
            source_id=source_id,
            expected_version=expected_version,
        )

    @app.get("/scopes/{scope_id}/sources/{source_id}/versions/{number}")
    def read_version(scope_id: UUID, source_id: UUID, number: int, actor: Actor):
        content, saved = materials.read(actor, scope_id, source_id, number)
        return Response(
            content,
            media_type="application/octet-stream",
            headers={
                "X-Source-Id": saved["source_id"],
                "X-Version": str(saved["number"]),
                "X-Content-SHA256": saved["sha256"],
                "X-Content-Size": str(saved["size"]),
                "X-Actor-Id": saved["actor_id"],
                "X-Created-At": saved["created_at"],
                "X-Operation-Id": saved["operation_id"],
                "Cache-Control": "no-store",
            },
        )

    @app.get("/scopes/{scope_id}/operations/{operation_id}")
    def read_operation(scope_id: UUID, operation_id: UUID, actor: Actor):
        return JSONResponse(
            materials.operation(actor, scope_id, operation_id),
            headers={"Cache-Control": "no-store"},
        )
