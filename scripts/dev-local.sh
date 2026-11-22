#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

CALLER_PORT="${PORT:-}"

if [ -f ".env.local" ]; then
  set -a
  # shellcheck disable=SC1091
  source ".env.local"
  set +a
fi

if [ -d "${HOME}/.local/bin" ]; then
  export PATH="${HOME}/.local/bin:${PATH}"
fi

export PORT="${CALLER_PORT:-${PORT:-8010}}"
export AULALISTA_LOCAL_INSECURE="true"
export AULALISTA_DATABASE_URL="${AULALISTA_DATABASE_URL:-postgresql+psycopg://aulalista_test@127.0.0.1:55432/aulalista_test}"
export AULALISTA_DOCS_ENABLED="${AULALISTA_DOCS_ENABLED:-true}"
export AULALISTA_PRINT_POLLER_SECONDS="${AULALISTA_PRINT_POLLER_SECONDS:-15}"
export OPENAI_MODEL="${OPENAI_MODEL:-gpt-6-luna}"
if [ -n "${OPENAI_API_KEY:-}" ]; then
  export AULALISTA_OPENAI_ANNEXES_ENABLED="${AULALISTA_OPENAI_ANNEXES_ENABLED:-true}"
fi

echo "==> Levantando PostgreSQL local (compose.test.yml)..."
docker compose -f compose.test.yml up -d --wait

echo "==> Aplicando migraciones Alembic..."
uv run --locked alembic upgrade head

echo "==> Compilando y empaquetando frontend web/..."
(cd web && npm run build)
uv run --locked python scripts/package_web.py

echo "==> Iniciando AulaLista en modo LOCAL SIN SEGURIDAD: http://127.0.0.1:${PORT}"
echo "    OpenAI configurado: $([ -n "${OPENAI_API_KEY:-}" ] && echo "SI (${OPENAI_MODEL})" || echo "NO (define OPENAI_API_KEY en .env.local)")"
echo "    SMTP configurado:   $([ -n "${SMTP_HOST:-}" ] && echo "SI (${SMTP_HOST}:${SMTP_PORT:-587})" || echo "NO (define SMTP_* en .env.local)")"

exec uv run --locked uvicorn scripts.local_dev_server:create_local_app --factory --host 127.0.0.1 --port "${PORT}"
