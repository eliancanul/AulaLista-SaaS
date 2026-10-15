import pytest
from fastapi.testclient import TestClient

from aulalista_api.app import create_app


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("AULALISTA_DOCS_ENABLED", raising=False)
    with TestClient(create_app()) as client:
        yield client


def test_liveness_contract(client):
    response = client.get("/health/live")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    assert response.json() == {"status": "ok"}


def test_liveness_does_not_accept_writes(client):
    response = client.post("/health/live", json={"status": "ready"})
    assert response.status_code == 405


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
def test_unavailable_endpoints_are_not_advertised(client, path):
    assert client.get(path).status_code == 404


def test_only_health_routes_are_available_by_default(client):
    assert [(route.path, route.methods) for route in client.app.routes] == [
        ("/health/live", {"GET"}),
        ("/health/ready", {"GET"}),
    ]


def test_docs_can_be_enabled_explicitly(monkeypatch):
    monkeypatch.setenv("AULALISTA_DOCS_ENABLED", "true")
    with TestClient(create_app()) as client:
        assert client.get("/docs").status_code == 200
        schema = client.get("/openapi.json")
        assert schema.status_code == 200
        assert set(schema.json()["paths"]) == {"/health/live", "/health/ready"}
        assert client.get("/redoc").status_code == 404


@pytest.mark.parametrize("path", ["/principals", "/scopes", "/sources", "/login"])
def test_no_identity_or_private_api_is_exposed(client, path):
    headers = {"X-User-ID": "synthetic-principal", "X-Tenant-ID": "synthetic-scope"}
    assert client.get(path, headers=headers).status_code == 404
    assert (
        client.post(
            path, headers=headers, json={"principal_id": "synthetic-principal"}
        ).status_code
        == 404
    )
