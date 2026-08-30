#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

cleanup() {
  jobs -p | xargs -r kill 2>/dev/null || true
}
trap cleanup EXIT INT TERM

PYTHONPATH=apps/api .venv/bin/uvicorn constellation.main:app --reload --port 8080 &
(cd apps/web && npm run dev) &
wait
