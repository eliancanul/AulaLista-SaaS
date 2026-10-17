#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
(cd web && npm ci --include=dev --ignore-scripts && npm run build)
python scripts/package_web.py
uv sync --locked --no-editable --no-dev --reinstall-package aulalista-api
uv build --no-sources
