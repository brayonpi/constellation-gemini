FROM node:22-alpine AS web
WORKDIR /app/apps/web
COPY apps/web/package*.json ./
RUN npm ci
COPY apps/web/ ./
RUN npm run build

FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080 \
    CONSTELLATION_DATABASE_PATH=/tmp/constellation.sqlite3 \
    CONSTELLATION_FIXTURE_DIR=/app/data/fixtures \
    CONSTELLATION_WEB_DIST=/app/apps/web/dist
WORKDIR /app
COPY pyproject.toml README.md LICENSE ./
COPY apps/api ./apps/api
RUN python -m pip install --no-cache-dir '.[google]'
COPY data ./data
COPY --from=web /app/apps/web/dist ./apps/web/dist
USER 65532:65532
CMD ["sh", "-c", "uvicorn constellation.main:app --host 0.0.0.0 --port ${PORT}"]
