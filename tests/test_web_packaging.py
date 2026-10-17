"""Build allowlist and production-only CSP are independent of runtime routing."""

import importlib.util
import json
from pathlib import Path

import pytest


@pytest.fixture
def packager(tmp_path, monkeypatch):
    spec = importlib.util.spec_from_file_location(
        "package_web", Path(__file__).resolve().parents[1] / "scripts/package_web.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    source = tmp_path / "dist"
    source.mkdir()
    target = tmp_path / "package"
    monkeypatch.setattr(module, "SOURCE", source)
    monkeypatch.setattr(module, "TARGET", target)
    (source / "index.html").write_text(
        "<html>connect-src 'self' ws://127.0.0.1:*;</html>"
    )
    (source / "assets").mkdir()
    (source / "assets/app-12345678.js").write_text("void 0;")
    return module


def test_only_production_allowlist_and_no_dev_websocket(packager):
    for path in (".env", "tests/harness.html", "assets/app.js.map", "acenta/ASSETS.md"):
        target = packager.SOURCE / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("synthetic forbidden")
    packager.package()
    files = json.loads((packager.TARGET / "manifest.json").read_text())
    assert set(files) == {"index.html", "assets/app-12345678.js"}
    assert "ws:" not in (packager.TARGET / "index.html").read_text()


def test_no_symlink_in_production_bundle(packager):
    (packager.SOURCE / "assets/link.js").symlink_to(packager.SOURCE / "index.html")
    with pytest.raises(ValueError, match="Symlinks"):
        packager.package()


def test_missing_frontend_is_an_explicit_build_failure(packager):
    (packager.SOURCE / "index.html").unlink()
    with pytest.raises(ValueError, match="production frontend"):
        packager.package()
