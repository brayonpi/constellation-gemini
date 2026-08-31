from __future__ import annotations

import asyncio
import base64
import json
import os
import time
import uuid
from functools import lru_cache
from pathlib import Path

from fastapi import BackgroundTasks, Body, FastAPI, Header, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .artifacts import ArtifactNotFound, ArtifactStore
from .cloud import enqueue_plan
from .config import get_settings
from .models import ClarificationRequest, CreateMissionRequest, IntentRequest, MutationRequest, TelemetryEvent
from .service import InvalidTransition, MissionNotFound, MissionService
from .store import ConcurrentUpdate, IdempotencyConflict

settings_at_startup = get_settings()
app = FastAPI(
    title="Constellation Mission Control API",
    version="0.2.0",
    description="Proof-carrying recovery planning for a deterministic orbital simulation.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings_at_startup.allowed_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Idempotency-Key", "Last-Event-ID", "X-Correlation-ID"],
    expose_headers=["X-Correlation-ID", "Content-Disposition"],
)


@lru_cache
def service() -> MissionService:
    return MissionService(get_settings())


def _problem(request: Request, status: int, title: str, detail: str, *, retryable: bool = False) -> JSONResponse:
    correlation_id = getattr(request.state, "correlation_id", str(uuid.uuid4()))
    return JSONResponse(
        status_code=status,
        media_type="application/problem+json",
        content={
            "type": f"https://constellation.hexstellar.com/problems/{title.lower().replace(' ', '-')}",
            "title": title,
            "status": status,
            "detail": detail,
            "correlation_id": correlation_id,
            "retryable": retryable,
        },
    )


@app.exception_handler(MissionNotFound)
async def mission_not_found(request: Request, exc: MissionNotFound) -> JSONResponse:
    return _problem(request, 404, "Mission not found", f"No mission exists for identifier {exc.args[0]}")


@app.exception_handler(InvalidTransition)
async def invalid_transition(request: Request, exc: InvalidTransition) -> JSONResponse:
    return _problem(request, 409, "Invalid mission transition", str(exc))


@app.exception_handler(IdempotencyConflict)
async def idempotency_conflict(request: Request, exc: IdempotencyConflict) -> JSONResponse:
    return _problem(request, 409, "Idempotency conflict", str(exc))


@app.exception_handler(ConcurrentUpdate)
async def concurrent_update(request: Request, exc: ConcurrentUpdate) -> JSONResponse:
    return _problem(request, 409, "Concurrent mission update", str(exc), retryable=True)


@app.exception_handler(ArtifactNotFound)
async def artifact_not_found(request: Request, exc: ArtifactNotFound) -> JSONResponse:
    return _problem(request, 404, "Artifact not found", f"No evidence artifact exists for {exc.args[0]}")


@app.exception_handler(RequestValidationError)
async def request_validation(request: Request, exc: RequestValidationError) -> JSONResponse:
    fields = [".".join(str(part) for part in error["loc"]) for error in exc.errors()]
    return _problem(request, 422, "Request validation failed", f"Invalid fields: {', '.join(fields)}")


@app.exception_handler(HTTPException)
async def http_problem(request: Request, exc: HTTPException) -> JSONResponse:
    title = "Service unavailable" if exc.status_code == 503 else "Request rejected"
    return _problem(request, exc.status_code, title, str(exc.detail), retryable=exc.status_code >= 500)


@app.middleware("http")
async def request_boundaries(request: Request, call_next):
    settings = get_settings()
    correlation_id = request.headers.get("X-Correlation-ID") or str(uuid.uuid4())
    request.state.correlation_id = correlation_id
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > settings.max_request_bytes:
                return _problem(request, 413, "Request too large", "The public sandbox request limit was exceeded")
        except ValueError:
            return _problem(request, 400, "Invalid content length", "Content-Length must be an integer")
    response = await call_next(request)
    response.headers["X-Correlation-ID"] = correlation_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; "
        "style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self' blob:"
    )
    return response


@app.get("/api/v1/health")
@app.get("/api/v1/health/live")
def health_live() -> dict:
    settings = get_settings()
    return {
        "status": "ok",
        "mode": settings.mode,
        "role": settings.role,
        "gemini_live": settings.live_gemini_available,
        "cortex_live": settings.live_cortex_available,
        "simulation": True,
    }


@app.get("/api/v1/health/ready")
def health_ready(response: Response) -> dict:
    settings = get_settings()
    failures: list[str] = []
    try:
        service()
    except RuntimeError as exc:
        failures.append(str(exc))
    if settings.mode == "cloud" and settings.role == "web" and not settings.worker_base_url:
        failures.append("private worker URL is not configured")
    if settings.mode == "cloud" and not settings.artifact_bucket:
        failures.append("artifact bucket is not configured")
    if failures:
        response.status_code = 503
    return {"status": "ready" if not failures else "degraded", "failures": failures}


@app.get("/api/v1/verifier-source")
def verifier_source():
    """Expose the exact independent checker shipped in this deployment."""
    content = Path(__file__).with_name("verifier.py").read_text(encoding="utf-8")
    return Response(
        content=content,
        media_type="text/x-python",
        headers={"Content-Disposition": 'inline; filename="constellation-verifier.py"'},
    )


def _idempotency(header_value: str | None, body_value: str) -> str:
    return header_value or body_value


@app.post("/api/v1/missions", status_code=201)
def create_mission(
    request: CreateMissionRequest,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    key = _idempotency(idempotency_key, request.idempotency_key)
    return service().create(request.model_copy(update={"idempotency_key": key}))


@app.post("/api/v1/missions/{mission_id}/intent")
async def set_intent(
    mission_id: str,
    request: IntentRequest,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    request = request.model_copy(update={"idempotency_key": _idempotency(idempotency_key, request.idempotency_key)})
    return await service().set_intent(mission_id, request)


@app.post("/api/v1/missions/{mission_id}/events")
def add_event(
    mission_id: str,
    event: TelemetryEvent,
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
):
    return service().add_event(mission_id, event, idempotency_key)


@app.post("/api/v1/missions/{mission_id}/clarifications")
async def clarify(
    mission_id: str,
    request: ClarificationRequest,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    request = request.model_copy(update={"idempotency_key": _idempotency(idempotency_key, request.idempotency_key)})
    return await service().clarify(mission_id, request)


async def _background_plan(
    mission_id: str,
    idempotency_key: str,
    *,
    local_simulation: bool = False,
) -> None:
    await service().plan(mission_id, idempotency_key, local_simulation=local_simulation)


@app.post("/api/v1/missions/{mission_id}/plan", status_code=202)
async def plan(
    mission_id: str,
    request: MutationRequest,
    background_tasks: BackgroundTasks,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    key = _idempotency(idempotency_key, request.idempotency_key)
    settings = get_settings()
    if settings.mode == "cloud" and settings.role == "web":
        if not settings.worker_base_url:
            raise HTTPException(status_code=503, detail="private worker URL is not configured")
        task_name = enqueue_plan(settings, mission_id, key, settings.worker_base_url)
        return service().mark_queued(mission_id, task_name, key)
    queued = service().mark_queued(mission_id, f"local-background:{uuid.uuid4()}", key)
    background_tasks.add_task(_background_plan, mission_id, key)
    return queued


@app.post("/api/v1/missions/{mission_id}/simulate", status_code=202)
async def simulate_after_cortex_failure(
    mission_id: str,
    request: MutationRequest,
    background_tasks: BackgroundTasks,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    """Run the disclosed deterministic simulator only after a visible live Cortex failure."""
    key = _idempotency(idempotency_key, request.idempotency_key)
    if service().get(mission_id).status != "cortex_unavailable":
        raise InvalidTransition("transparent simulation is available only after a live Cortex failure")
    settings = get_settings()
    if settings.mode == "cloud" and settings.role == "web":
        if not settings.worker_base_url:
            raise HTTPException(status_code=503, detail="private worker URL is not configured")
        task_name = enqueue_plan(
            settings,
            mission_id,
            key,
            settings.worker_base_url,
            local_simulation=True,
        )
        return service().mark_queued(
            mission_id,
            task_name,
            key,
            local_simulation=True,
        )
    queued = service().mark_queued(
        mission_id,
        f"local-simulation:{uuid.uuid4()}",
        key,
        local_simulation=True,
    )
    background_tasks.add_task(
        _background_plan,
        mission_id,
        key,
        local_simulation=True,
    )
    return queued


@app.post("/api/v1/missions/{mission_id}/retry", status_code=202)
async def retry(
    mission_id: str,
    request: MutationRequest,
    background_tasks: BackgroundTasks,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    key = _idempotency(idempotency_key, request.idempotency_key)
    settings = get_settings()
    if settings.mode == "cloud" and settings.role == "web":
        if not settings.worker_base_url:
            raise HTTPException(status_code=503, detail="private worker URL is not configured")
        task_name = enqueue_plan(settings, mission_id, key, settings.worker_base_url)
        return service().mark_queued(mission_id, task_name, key)
    queued = service().mark_queued(mission_id, f"local-retry:{uuid.uuid4()}", key)
    background_tasks.add_task(_background_plan, mission_id, key)
    return queued


@app.post("/api/v1/missions/{mission_id}/verify")
def verify(
    mission_id: str,
    request: MutationRequest,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    return service().verify(mission_id, _idempotency(idempotency_key, request.idempotency_key))


@app.post("/api/v1/missions/{mission_id}/apply-sandbox")
def apply_sandbox(
    mission_id: str,
    request: MutationRequest,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    return service().apply(mission_id, _idempotency(idempotency_key, request.idempotency_key))


@app.get("/api/v1/missions/{mission_id}")
def get_mission(mission_id: str):
    return service().get(mission_id)


TERMINAL_STATUSES = {
    "verified",
    "impossible",
    "verification_failed",
    "contract_rejected",
    "cortex_unavailable",
    "interpretation_failed",
    "applied",
}


@app.get("/api/v1/missions/{mission_id}/events")
async def stream_events(
    mission_id: str,
    request: Request,
    last_event_id: str | None = Header(None, alias="Last-Event-ID"),
):
    service().get(mission_id)
    try:
        starting_sequence = max(int(last_event_id or 0), 0)
    except ValueError:
        starting_sequence = 0

    async def generate():
        sequence = starting_sequence
        last_heartbeat = time.monotonic()
        terminal_seen_at: float | None = None
        while not await request.is_disconnected():
            events = service().events(mission_id, sequence)
            for event in events:
                sequence = event.sequence
                yield f"id: {event.sequence}\nevent: mission-event\ndata: {event.model_dump_json()}\n\n"
            mission = service().get(mission_id)
            if str(mission.status) in TERMINAL_STATUSES:
                terminal_seen_at = terminal_seen_at or time.monotonic()
                if not events and time.monotonic() - terminal_seen_at >= 1:
                    break
            if time.monotonic() - last_heartbeat >= 10:
                yield f": heartbeat {int(time.time())}\n\n"
                last_heartbeat = time.monotonic()
            await asyncio.sleep(0.4)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


@app.get("/api/v1/missions/{mission_id}/logs")
def event_log(mission_id: str):
    events = service().events(mission_id)
    content = "".join(event.model_dump_json() + "\n" for event in events)
    return Response(
        content=content,
        media_type="application/x-ndjson",
        headers={"Content-Disposition": f'attachment; filename="constellation-{mission_id}-events.ndjson"'},
    )


@app.get("/api/v1/missions/{mission_id}/timeline")
def timeline(mission_id: str):
    mission = service().get(mission_id)
    selected = set(mission.plan.selected_bundle_ids if mission.plan else [])
    return {
        "horizon_minutes": mission.snapshot.horizon_minutes,
        "nominal": [action.model_dump(mode="json") for action in mission.snapshot.existing_schedule],
        "recovered": [
            action.model_dump(mode="json")
            for bundle in mission.bundles
            if bundle.id in selected
            for action in bundle.actions
        ],
    }


@app.get("/api/v1/missions/{mission_id}/artifacts")
def artifact_manifest(mission_id: str):
    return {"artifacts": service().get(mission_id).artifacts}


@app.get("/api/v1/missions/{mission_id}/artifacts/{name}")
def artifact_download(mission_id: str, name: str):
    mission = service().get(mission_id)
    manifest = next((item for item in mission.artifacts if item.name == name), None)
    if not manifest:
        raise ArtifactNotFound(name)
    content = ArtifactStore(get_settings()).read(mission_id, name)
    return Response(
        content=content,
        media_type=manifest.content_type,
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@app.get("/api/v1/missions/{mission_id}/bundle")
def replay_bundle(mission_id: str):
    return artifact_download(mission_id, "mission-replay.zip")


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
            target = settings.worker_base_url or str(request.base_url)
            task_name = enqueue_plan(settings, mission.id, f"pubsub:{idempotency_key}", target)
            service().mark_queued(mission.id, task_name, f"pubsub:{idempotency_key}")
            return {"accepted": True, "mission_id": mission.id, "task": task_name}
        mission = await service().plan(mission.id, f"pubsub:{idempotency_key}")
    return {"accepted": True, "mission_id": mission.id, "status": mission.status}


@app.post("/internal/tasks/plan", include_in_schema=False)
async def task_plan(
    payload: dict = Body(...),
    internal_token: str | None = Header(None, alias="X-Constellation-Internal-Token"),
):
    _require_internal(internal_token)
    mission = await service().plan(
        str(payload["mission_id"]),
        str(payload["idempotency_key"]),
        local_simulation=payload.get("local_simulation") is True,
    )
    return {"mission_id": mission.id, "status": mission.status}


WEB_DIST = Path(os.getenv("CONSTELLATION_WEB_DIST", "apps/web/dist")).resolve()
if WEB_DIST.is_dir():
    app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")
