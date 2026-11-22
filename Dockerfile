# Multi-stage production Dockerfile (usable on AWS App Runner, AWS Lightsail, or Render Docker)
FROM node:24-slim AS web-builder
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.12-slim AS runtime
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

RUN pip install --no-cache-dir uv

COPY pyproject.toml uv.lock alembic.ini ./
COPY src/ ./src/
COPY migrations/ ./migrations/
COPY scripts/package_web.py ./scripts/package_web.py
COPY --from=web-builder /app/web/dist ./web/dist

RUN uv sync --frozen --no-dev && \
    uv run --no-sync python scripts/package_web.py

EXPOSE 8000

CMD ["sh", "-c", ".venv/bin/alembic upgrade head && exec .venv/bin/python -m uvicorn aulalista_api.app:create_app --factory --host 0.0.0.0 --port ${PORT:-8000} --no-access-log --no-proxy-headers"]
