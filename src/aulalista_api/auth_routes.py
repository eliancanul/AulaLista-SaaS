"""HTTP de autenticación same-origin, entradas acotadas y cookies host-only."""

from uuid import UUID

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from starlette.concurrency import run_in_threadpool

from aulalista_api.auth import Auth, AuthError
from aulalista_api.auth_config import load_auth_settings
from aulalista_api.auth_google import GoogleVerifier
from aulalista_api.mail_sender import load_auth_email_sender_from_env
from aulalista_api.material_routes import bounded_content

PRE_COOKIE = "__Host-acenta-pre"
SESSION_COOKIE = "__Host-acenta-session"


class GoogleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    credential: str = Field(min_length=1, max_length=8192)


class EmailRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(min_length=3, max_length=320)


class VerifyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    challenge_id: UUID
    code: str = Field(pattern=r"^[0-9]{8}$")


def cookie(response, name, value, max_age):
    response.set_cookie(
        name,
        value,
        max_age=max_age,
        secure=True,
        httponly=True,
        samesite="lax",
        path="/",
    )


def clear_cookie(response, name):
    response.delete_cookie(name, secure=True, httponly=True, samesite="lax", path="/")


def ip(request):
    return request.client.host if request.client else "unknown"


def checked_pre(request):
    token = request.cookies.get(PRE_COOKIE, "")
    request.app.state.auth.check_origin(
        request.headers.get("origin"),
        request.headers.get("x-csrf-token"),
        token,
        pre=True,
    )
    return token


async def payload(request, model):
    content = await bounded_content(
        request, media_type="application/json", max_bytes=10000
    )
    try:
        return model.model_validate_json(content)
    except ValidationError:
        raise AuthError(422, "invalid_request") from None


def logged_in(result):
    token, document = result
    response = JSONResponse(document, headers={"Cache-Control": "no-store"})
    cookie(response, SESSION_COOKIE, token, 86400)
    clear_cookie(response, PRE_COOKIE)
    return response


def public_budget(request: Request):
    request.app.state.auth.reserve_public_budget()


def install_auth_routes(app: FastAPI, engine):
    settings = load_auth_settings()
    verifier = (
        GoogleVerifier(settings.google_client_id)
        if settings and settings.google_client_id
        else None
    )
    email_sender = load_auth_email_sender_from_env()
    app.state.auth = Auth(engine, settings, google=verifier, sender=email_sender)

    @app.exception_handler(AuthError)
    async def auth_error(request, error):
        return JSONResponse(
            {"detail": error.detail},
            status_code=error.status,
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/auth/bootstrap", dependencies=[Depends(public_budget)])
    def bootstrap(request: Request):
        token, document = app.state.auth.bootstrap(
            request.cookies.get(PRE_COOKIE), ip(request)
        )
        response = JSONResponse(document, headers={"Cache-Control": "no-store"})
        cookie(response, PRE_COOKIE, token, 600)
        return response

    @app.post("/auth/google", dependencies=[Depends(public_budget)])
    async def google_login(request: Request):
        pre = checked_pre(request)
        data = await payload(request, GoogleRequest)
        return logged_in(
            await run_in_threadpool(
                app.state.auth.google_login,
                pre,
                data.credential,
                ip(request),
                request.cookies.get(SESSION_COOKIE),
            )
        )

    @app.post(
        "/auth/email/request", status_code=202, dependencies=[Depends(public_budget)]
    )
    async def request_email(request: Request):
        pre = checked_pre(request)
        data = await payload(request, EmailRequest)
        result = await run_in_threadpool(
            app.state.auth.request_email, pre, data.email, ip(request)
        )
        response = JSONResponse(
            result, status_code=202, headers={"Cache-Control": "no-store"}
        )
        cookie(response, PRE_COOKIE, pre, 600)
        return response

    @app.post("/auth/email/verify", dependencies=[Depends(public_budget)])
    async def verify_email(request: Request):
        pre = checked_pre(request)
        data = await payload(request, VerifyRequest)
        return logged_in(
            await run_in_threadpool(
                app.state.auth.verify_email,
                pre,
                data.challenge_id,
                data.code,
                ip(request),
                request.cookies.get(SESSION_COOKIE),
            )
        )

    @app.get("/auth/session")
    def session(request: Request):
        return JSONResponse(
            app.state.auth.session(request.cookies.get(SESSION_COOKIE, "")),
            headers={"Cache-Control": "no-store"},
        )

    @app.post("/auth/logout", status_code=204)
    def logout(request: Request):
        token = request.cookies.get(SESSION_COOKIE, "")
        app.state.auth.actor(token)
        app.state.auth.check_origin(
            request.headers.get("origin"), request.headers.get("x-csrf-token"), token
        )
        app.state.auth.logout(token)
        response = Response(status_code=204, headers={"Cache-Control": "no-store"})
        clear_cookie(response, SESSION_COOKIE)
        clear_cookie(response, PRE_COOKIE)
        return response
