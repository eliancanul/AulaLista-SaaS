"""Static routing never falls back over APIs or arbitrary filesystem paths."""

import json

import pytest
from fastapi.testclient import TestClient

from aulalista_api import web
from aulalista_api.app import create_app


@pytest.fixture
def static_client(tmp_path, monkeypatch):
    root = tmp_path / "static"
    root.mkdir()
    (root / "index.html").write_text("<!doctype html><title>synthetic</title>")
    (root / "assets").mkdir()
    (root / "assets" / "app-12345678.js").write_text("void 0;")
    (root / ".env").write_text("synthetic forbidden content")
    files = {
        "index.html": {"mime": "text/html", "immutable": False},
        "assets/app-12345678.js": {"mime": "text/javascript", "immutable": True},
        "assets/escape.js": {"mime": "text/javascript", "immutable": False},
    }
    (root / "assets" / "escape.js").symlink_to(root / ".env")
    (root / "manifest.json").write_text(json.dumps(files))
    monkeypatch.setattr(web, "WEB_ROOT", root)
    with TestClient(create_app()) as client:
        yield client


def test_html_headers_and_head(static_client):
    for path in ("/", "/index.html"):
        response = static_client.get(path)
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/html")
        assert response.headers["cache-control"] == "no-store"
        assert response.headers["x-content-type-options"] == "nosniff"
        assert (
            response.headers["cross-origin-opener-policy"] == "same-origin-allow-popups"
        )
        assert static_client.head(path).content == b""
        assert static_client.post(path).status_code == 405


def test_hashed_asset_headers(static_client):
    response = static_client.get("/assets/app-12345678.js")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/javascript")
    assert "immutable" in response.headers["cache-control"]
    assert response.headers["x-content-type-options"] == "nosniff"


@pytest.mark.parametrize(
    "path",
    [
        "/.env",
        "/manifest.json",
        "/src/main.tsx",
        "/tests/acenta.html",
        "/assets/.env",
        "/assets/%2e%2e/.env",
        "/assets/%252e%252e/.env",
        "/assets/a%5c..%5c.env",
        "/assets/escape.js",
        "/assets/missing.js",
        "/auth/missing",
        "/health/missing",
        "/scopes/missing",
        "/v1/missing",
        "/unknown",
    ],
)
def test_no_arbitrary_file_or_spa_fallback(static_client, path):
    assert static_client.get(path).status_code == 404


def test_existing_api_routes_preserved(static_client):
    assert static_client.get("/health/live").json() == {"status": "ok"}
    assert static_client.get("/auth/session").status_code == 401


def test_missing_bundle_does_not_read_checkout(tmp_path, monkeypatch):
    monkeypatch.setattr(web, "WEB_ROOT", tmp_path)
    with TestClient(create_app()) as client:
        assert client.get("/").status_code == 404
        assert client.get("/health/live").status_code == 200
