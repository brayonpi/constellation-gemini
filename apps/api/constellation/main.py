from __future__ import annotations

import base64
import json
import os
from functools import lru_cache
from pathlib import Path

from fastapi import Body, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .cloud import enqueue_plan
from .config import get_settings
from .models import (
    ClarificationRequest,
    CreateMissionRequest,
    IntentRequest,
    MutationRequest,
    TelemetryEvent,
)
from .service import InvalidTransition, MissionNotFound, MissionService

app = FastAPI(
    title="Constellation Mission Control API",
    version="0.1.0",
    description="Proof-carrying recovery planning for a deterministic orbital simulation.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:8080"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Idempotency-Key"],
)


@lru_cache
def service() -> MissionService:
    return MissionService(get_settings())


@app.exception_handler(MissionNotFound)
async def mission_not_found(_, exc: MissionNotFound) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": f"mission not found: {exc.args[0]}"})


@app.exception_handler(InvalidTransition)
async def invalid_transition(_, exc: InvalidTransition) -> JSONResponse:
    return JSONResponse(status_code=409, content={"detail": str(exc)})


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(self), geolocation=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; connect-src 'self'; img-src 'self' data:; "
        "style-src 'self' 'unsafe-inline'; script-src 'self'"
    )
    return response


@app.get("/api/v1/health")
def health() -> dict:
    settings = get_settings()
    return {
        "status": "ok",
        "mode": settings.mode,
        "gemini_live": settings.live_gemini_available,
        "cortex_live": settings.live_cortex_available,
        "simulation": True,
    }


@app.post("/api/v1/missions", status_code=201)
def create_mission(request: CreateMissionRequest):
    return service().create(request)


@app.post("/api/v1/missions/{mission_id}/intent")
async def set_intent(mission_id: str, request: IntentRequest):
    return await service().set_intent(mission_id, request)


@app.post("/api/v1/missions/{mission_id}/events")
def add_event(
    mission_id: str,
    event: TelemetryEvent,
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
):
    return service().add_event(mission_id, event, idempotency_key)


@app.post("/api/v1/missions/{mission_id}/clarifications")
async def clarify(mission_id: str, request: ClarificationRequest):
    return await service().clarify(mission_id, request)


@app.post("/api/v1/missions/{mission_id}/plan")
async def plan(mission_id: str, request: MutationRequest):
    settings = get_settings()
    if settings.mode == "cloud" and settings.role == "web":
        if not settings.worker_base_url:
            raise HTTPException(status_code=503, detail="private worker URL is not configured")
        task_name = enqueue_plan(
            settings,
            mission_id,
            request.idempotency_key,
            settings.worker_base_url,
        )
        return service().mark_queued(mission_id, task_name)
    return await service().plan(mission_id, request.idempotency_key)


@app.post("/api/v1/missions/{mission_id}/retry")
async def retry(mission_id: str, request: MutationRequest):
    return await service().plan(mission_id, request.idempotency_key)


@app.post("/api/v1/missions/{mission_id}/verify")
def verify(mission_id: str, _: MutationRequest):
    return service().verify(mission_id)


@app.post("/api/v1/missions/{mission_id}/apply-sandbox")
def apply_sandbox(mission_id: str, _: MutationRequest):
    return service().apply(mission_id)


@app.get("/api/v1/missions/{mission_id}")
def get_mission(mission_id: str):
    return service().get(mission_id)


@app.get("/api/v1/missions/{mission_id}/events")
def stream_events(mission_id: str):
    mission = service().get(mission_id)

    async def generate():
        for event in mission.audit:
            yield f"id: {event.sequence}\nevent: {event.type}\ndata: {event.model_dump_json()}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.get("/api/v1/missions/{mission_id}/timeline")
def timeline(mission_id: str):
    mission = service().get(mission_id)
    selected = set(mission.plan.selected_bundle_ids if mission.plan else [])
    return {
        "nominal": [action.model_dump(mode="json") for action in mission.snapshot.existing_schedule],
        "recovered": [
            action.model_dump(mode="json")
            for bundle in mission.bundles
            if bundle.id in selected
            for action in bundle.actions
        ],
    }


@app.get("/api/v1/missions/{mission_id}/bundle")
def replay_bundle(mission_id: str):
    mission = service().get(mission_id)
    return {
        "format": "constellation-replay-v1",
        "mission": mission.model_dump(mode="json"),
        "verifier": "python -m constellation.cli verify <replay.json>",
    }


@app.get("/api/v1/missions/{mission_id}/patch")
def mission_patch(mission_id: str):
    mission = service().get(mission_id)
    if not mission.plan:
        raise HTTPException(status_code=409, detail="mission has no plan")
    return {
        "target": "sandbox",
        "review_required_for_external_system": True,
        "apply_status": mission.plan.apply_status,
        "replace_schedule_with_bundles": mission.plan.selected_bundle_ids,
        "plan_digest": mission.plan.verification_report.plan_digest if mission.plan.verification_report else None,
    }


def _require_internal(token: str | None) -> None:
    settings = get_settings()
    if settings.mode == "cloud" and settings.role != "worker":
        raise HTTPException(status_code=404, detail="not found")
    if settings.internal_token and token != settings.internal_token:
        raise HTTPException(status_code=403, detail="authenticated internal delivery required")


@app.post("/internal/pubsub", include_in_schema=False)
async def pubsub_ingress(
    request: Request,
    envelope: dict = Body(...),
    internal_token: str | None = Header(None, alias="X-Constellation-Internal-Token"),
):
    """Receive an authenticated Pub/Sub push and route it to a durable worker task."""
    _require_internal(internal_token)
    try:
        message = envelope["message"]
        payload = json.loads(base64.b64decode(message["data"], validate=True))
        mission_id = str(payload["mission_id"])
        event = TelemetryEvent.model_validate(payload["telemetry"])
        idempotency_key = str(message.get("messageId", event.event_id))
    except (KeyError, ValueError, TypeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail="invalid Pub/Sub envelope") from exc
    mission = service().add_event(mission_id, event, idempotency_key)
    settings = get_settings()
    if mission.status == "ready":
        if settings.mode == "cloud":
            task_name = enqueue_plan(
                settings,
                mission.id,
                f"pubsub:{idempotency_key}",
                str(request.base_url),
            )
            return {"accepted": True, "mission_id": mission.id, "task": task_name}
        mission = await service().plan(mission.id, f"pubsub:{idempotency_key}")
    return {"accepted": True, "mission_id": mission.id, "status": mission.status}


@app.post("/internal/tasks/plan", include_in_schema=False)
async def task_plan(
    payload: dict = Body(...),
    internal_token: str | None = Header(None, alias="X-Constellation-Internal-Token"),
):
    _require_internal(internal_token)
    mission = await service().plan(str(payload["mission_id"]), str(payload["idempotency_key"]))
    return {"mission_id": mission.id, "status": mission.status}


WEB_DIST = Path(os.getenv("CONSTELLATION_WEB_DIST", "apps/web/dist")).resolve()
if WEB_DIST.is_dir():
    app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")
