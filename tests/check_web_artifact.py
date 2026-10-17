"""Run with the installed wheel; require production UI and no harnesses."""

import json
import re
from pathlib import Path

from fastapi.testclient import TestClient

from aulalista_api import web
from aulalista_api.app import create_app


def main():
    assert "site-packages" in str(Path(web.__file__).resolve()), (
        "Not an installed wheel"
    )
    manifest = json.loads((web.WEB_ROOT / "manifest.json").read_text())
    assert "index.html" in manifest
    assert all(
        not any(word in p for word in ("tests/", ".map", ".env", "src/"))
        for p in manifest
    )
    with TestClient(create_app(), base_url="https://testserver") as client:
        response = client.get("/")
        assert response.status_code == 200
        html = response.text
        assert "ws://127.0.0.1" not in html
        assert "https://accounts.google.com/gsi/client" in html
        assert "frame-src https://accounts.google.com/gsi/" in html
        links = re.findall(r'(?:src|href)="(/[^\"]+)"', html)
        assert links
        for link in links:
            assert client.get(link).status_code == 200, "Missing production asset"
        for path, entry in manifest.items():
            result = client.get("/" + path)
            assert result.status_code == 200
            assert result.headers["x-content-type-options"] == "nosniff"
            assert result.headers["content-type"].startswith(entry["mime"])
        assert client.get("/tests/acenta.html").status_code == 404
        assert client.get("/auth/session").status_code == 401
        assert client.get("/health/live").status_code == 200
    print(f"Installed production wheel: {len(manifest)} frontend files verified")


if __name__ == "__main__":
    main()
