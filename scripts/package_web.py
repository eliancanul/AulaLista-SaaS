"""Copy only production output into package data; never publish tests or source maps."""

import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "web" / "dist"
TARGET = ROOT / "src" / "aulalista_api" / "static"
MIMES = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ttf": "font/ttf",
    ".txt": "text/plain",
    ".md": "text/plain",
}
LICENSES = {"acenta/fonts/Instrument-OFL.txt", "acenta/fonts/SourceSans-LICENSE.md"}


def package():
    if not (SOURCE / "index.html").is_file():
        raise ValueError("Build the production frontend first.")
    if TARGET.exists():
        shutil.rmtree(TARGET)
    files = {}
    for source in sorted(SOURCE.rglob("*")):
        if source.is_symlink():
            raise ValueError("Symlinks are forbidden in frontend output.")
        if not source.is_file():
            continue
        path = source.relative_to(SOURCE).as_posix()
        suffix = source.suffix
        hashed = bool(
            re.fullmatch(r"assets/[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8,}\.(js|css)", path)
        )
        public = path.startswith("acenta/") and suffix in {".svg", ".png", ".ttf"}
        if any(p.startswith(".") for p in source.relative_to(SOURCE).parts):
            continue
        if not (path == "index.html" or hashed or public or path in LICENSES):
            continue
        target = TARGET / path
        target.parent.mkdir(parents=True, exist_ok=True)
        if path == "index.html":
            target.write_text(source.read_text().replace(" ws://127.0.0.1:*", ""))
        else:
            shutil.copyfile(source, target)
        files[path] = {"mime": MIMES[suffix], "immutable": hashed}
    if not any(v["immutable"] for v in files.values()):
        raise ValueError("Missing hashed frontend bundle.")
    (TARGET / "manifest.json").write_text(json.dumps(files, sort_keys=True) + "\n")


if __name__ == "__main__":
    package()
