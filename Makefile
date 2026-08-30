.DEFAULT_GOAL := help

.PHONY: help install dev api web test lint verify-demo docker

help:
	@echo "install      Install Python and web dependencies"
	@echo "dev          Run API and web development servers"
	@echo "api          Run the FastAPI service"
	@echo "web          Run the Vite UI"
	@echo "test         Run Python and TypeScript checks"
	@echo "lint         Run Ruff and frontend lint"
	@echo "verify-demo  Verify the committed recovered mission"
	@echo "docker       Build the production container"

install:
	python3 -m pip install -e '.[dev,google]'
	cd apps/web && npm install

api:
	PYTHONPATH=apps/api uvicorn constellation.main:app --reload --port 8080

web:
	cd apps/web && npm run dev

dev:
	./scripts/dev.sh

test:
	python3 -m pytest
	cd apps/web && npm run typecheck && npm run test

lint:
	python3 -m ruff check apps tests
	cd apps/web && npm run lint

verify-demo:
	PYTHONPATH=apps/api python3 -m constellation.cli verify data/fixtures/recovered-plan.json

docker:
	docker build -t constellation:local .
