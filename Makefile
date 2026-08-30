.DEFAULT_GOAL := help

.PHONY: help install dev api web test lint verify-demo verify-bundle audit docker

help:
	@echo "install      Install Python and web dependencies"
	@echo "dev          Run API and web development servers"
	@echo "api          Run the FastAPI service"
	@echo "web          Run the Vite UI"
	@echo "test         Run Python and TypeScript checks"
	@echo "lint         Run Ruff and frontend lint"
	@echo "verify-demo  Verify the committed recovered mission"
	@echo "verify-bundle Verify a downloaded replay ZIP (BUNDLE=path)"
	@echo "audit        Run release-quality tests, builds, and dependency audits"
	@echo "docker       Build the production container"

install:
	python3 -m venv .venv
	.venv/bin/python -m pip install --upgrade pip
	.venv/bin/python -m pip install -e '.[dev,google]'
	cd apps/web && npm ci

api:
	PYTHONPATH=apps/api .venv/bin/uvicorn constellation.main:app --reload --port 8080

web:
	cd apps/web && npm run dev

dev:
	./scripts/dev.sh

test:
	.venv/bin/python -m pytest --cov=constellation
	.venv/bin/python -m coverage report --fail-under=90
	cd apps/web && npm run typecheck && npm run test

lint:
	.venv/bin/python -m ruff check apps tests scripts
	cd apps/web && npm run lint

verify-demo:
	PYTHONPATH=apps/api .venv/bin/python -m constellation.cli verify data/fixtures/recovered-plan.json

verify-bundle:
	@test -n "$(BUNDLE)" || (echo "usage: make verify-bundle BUNDLE=mission-replay.zip" && exit 2)
	PYTHONPATH=apps/api .venv/bin/python -m constellation.verify_bundle "$(BUNDLE)"

audit: test lint
	cd apps/web && npm run build && npm audit --omit=dev
	.venv/bin/python -m pip_audit

docker:
	docker build -t constellation:local .
