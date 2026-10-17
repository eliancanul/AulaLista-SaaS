"""Serve only the reviewed, packaged frontend; never expose a checkout directory."""

import json
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

WEB_ROOT = Path(__file__).parent / "static"


def install_web(app: FastAPI) -> None:
    manifest = WEB_ROOT / "manifest.json"
    if not manifest.is_file():
        return  # API-only builds remain supported and fail closed for UI routes.
    files = json.loads(manifest.read_text())
    root = WEB_ROOT.resolve()

    def serve(path: str):
        entry = files.get(path)
        parts = Path(path).parts
        if not entry or any(p.startswith(".") for p in parts) or "\\" in path:
            raise HTTPException(404)
        candidate = root.joinpath(*parts)
        if candidate.is_symlink() or not candidate.resolve().is_relative_to(root):
            raise HTTPException(404)
        if not candidate.is_file():
            raise HTTPException(404)
        headers = {
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "public, max-age=31536000, immutable"
            if entry["immutable"]
            else "no-store",
        }
        if path == "index.html":
            headers["Cross-Origin-Opener-Policy"] = "same-origin-allow-popups"
            headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return FileResponse(candidate, media_type=entry["mime"], headers=headers)

    @app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
    @app.api_route("/index.html", methods=["GET", "HEAD"], include_in_schema=False)
    def index():
        return serve("index.html")

    @app.api_route(
        "/assets/{path:path}", methods=["GET", "HEAD"], include_in_schema=False
    )
    def assets(path: str):
        return serve("assets/" + path)

    @app.api_route(
        "/acenta/{path:path}", methods=["GET", "HEAD"], include_in_schema=False
    )
    def branding(path: str):
        return serve("acenta/" + path)
