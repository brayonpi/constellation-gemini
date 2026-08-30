from __future__ import annotations

import base64
import json
from pathlib import Path

from constellation import main
from constellation.compiler import DEFAULT_OPERATOR_TEXT
from constellation.config import Settings
from constellation.models import MissionStatus
from constellation.service import MissionService
from fastapi.testclient import TestClient


def client_for(tmp_path: Path, monkeypatch) -> tuple[TestClient, MissionService]:
    settings = Settings(
        CONSTELLATION_DATABASE_PATH=tmp_path / "api.sqlite3",
        CONSTELLATION_ARTIFACT_DIR=tmp_path / "artifacts",
        CONSTELLATION_MAX_REQUEST_BYTES=4096,
    )
    mission_service = MissionService(settings)
    monkeypatch.setattr(main, "get_settings", lambda: settings)
    monkeypatch.setattr(main, "service", lambda: mission_service)
    return TestClient(main.app), mission_service


def create(client: TestClient, key: str = "api-create-0001") -> dict:
    response = client.post(
        "/api/v1/missions",
        headers={"Idempotency-Key": key, "X-Correlation-ID": "test-correlation"},
        json={"name": "API mission", "fixture": "demo-12", "idempotency_key": "body-key"},
    )
    assert response.status_code == 201
    return response.json()


def test_health_create_headers_and_problem_details(tmp_path, monkeypatch) -> None:
    client, _ = client_for(tmp_path, monkeypatch)
    health = client.get("/api/v1/health/live")
    assert health.status_code == 200
    assert health.json()["simulation"] is True
    assert health.headers["x-content-type-options"] == "nosniff"
    assert "default-src 'self'" in health.headers["content-security-policy"]
    assert client.get("/api/v1/health/ready").json()["status"] == "ready"

    created = create(client)
    assert created["snapshot"]["id"] == "demo-12"
    assert created["version"] == 1

    missing = client.get("/api/v1/missions/not-here")
    assert missing.status_code == 404
    assert missing.headers["content-type"].startswith("application/problem+json")
    assert missing.json()["correlation_id"]
    assert missing.json()["retryable"] is False


def test_request_boundaries_and_validation_are_machine_readable(tmp_path, monkeypatch) -> None:
    client, _ = client_for(tmp_path, monkeypatch)
    oversized = client.post(
        "/api/v1/missions",
        headers={"Content-Length": "5000"},
        content=b"{}",
    )
    assert oversized.status_code == 413
    invalid_length = client.post(
        "/api/v1/missions",
        headers={"Content-Length": "not-an-integer"},
        content=b"{}",
    )
    assert invalid_length.status_code == 400
    invalid = client.post("/api/v1/missions", json={"unexpected": True})
    assert invalid.status_code == 422
    assert invalid.json()["title"] == "Request validation failed"


def test_api_idempotency_conflict(tmp_path, monkeypatch) -> None:
    client, _ = client_for(tmp_path, monkeypatch)
    create(client, "same-create-key")
    conflict = client.post(
        "/api/v1/missions",
        headers={"Idempotency-Key": "same-create-key"},
        json={"name": "Different payload", "fixture": "demo-12", "idempotency_key": "ignored-body-key"},
    )
    assert conflict.status_code == 409
    assert conflict.json()["title"] == "Idempotency conflict"


def test_complete_http_workflow_exposes_timeline_logs_artifacts_and_apply(tmp_path, monkeypatch) -> None:
    client, _ = client_for(tmp_path, monkeypatch)
    mission = create(client, "workflow-create")
    mission_id = mission["id"]

    interpreted = client.post(
        f"/api/v1/missions/{mission_id}/intent",
        headers={"Idempotency-Key": "workflow-intent"},
        json={"text": DEFAULT_OPERATOR_TEXT, "idempotency_key": "ignored-body-key"},
    )
    assert interpreted.status_code == 200
    assert interpreted.json()["status"] == "awaiting_clarification"

    telemetry = {
        "event_id": "api-compound-event",
        "event_type": "compound_orbital_compute_failure",
        "affected_resources": ["GS-PACIFIC-02", "COMPUTE-SAT-07", "COMPUTE-SAT-08"],
        "start_minute": 5,
        "expected_duration_minutes": 42,
        "confidence": 1,
        "source": "api-test",
    }
    event = client.post(
        f"/api/v1/missions/{mission_id}/events",
        headers={"Idempotency-Key": "workflow-event"},
        json=telemetry,
    )
    assert event.status_code == 200

    clarified = client.post(
        f"/api/v1/missions/{mission_id}/clarifications",
        headers={"Idempotency-Key": "workflow-clarify"},
        json={"answer": "urgent_deadline", "idempotency_key": "ignored-body-key"},
    )
    assert clarified.json()["status"] == "ready"

    planned = client.post(
        f"/api/v1/missions/{mission_id}/plan",
        headers={"Idempotency-Key": "workflow-plan"},
        json={"idempotency_key": "ignored-body-key"},
    )
    assert planned.status_code == 202
    final = client.get(f"/api/v1/missions/{mission_id}").json()
    assert final["status"] == "verified"
    assert final["artifacts"]

    timeline = client.get(f"/api/v1/missions/{mission_id}/timeline").json()
    assert timeline["horizon_minutes"] == 180
    assert timeline["nominal"] and timeline["recovered"]
    logs = client.get(f"/api/v1/missions/{mission_id}/logs")
    assert logs.status_code == 200
    assert logs.headers["content-disposition"].endswith('events.ndjson"')
    assert "verification.passed" in logs.text

    manifests = client.get(f"/api/v1/missions/{mission_id}/artifacts").json()["artifacts"]
    names = {artifact["name"] for artifact in manifests}
    assert {"mission-replay.zip", "AI-REVIEW-PROMPT.md", "checksums.json"} <= names
    bundle = client.get(f"/api/v1/missions/{mission_id}/bundle")
    assert bundle.status_code == 200
    assert bundle.headers["content-type"] == "application/zip"
    prompt = client.get(f"/api/v1/missions/{mission_id}/artifacts/AI-REVIEW-PROMPT.md")
    assert "skeptical software and systems engineer" in prompt.text
    missing_artifact = client.get(f"/api/v1/missions/{mission_id}/artifacts/nope.txt")
    assert missing_artifact.status_code == 404

    verified_again = client.post(
        f"/api/v1/missions/{mission_id}/verify",
        headers={"Idempotency-Key": "workflow-verify"},
        json={"idempotency_key": "ignored-body-key"},
    )
    assert verified_again.json()["status"] == "verified"
    applied = client.post(
        f"/api/v1/missions/{mission_id}/apply-sandbox",
        headers={"Idempotency-Key": "workflow-apply"},
        json={"idempotency_key": "ignored-body-key"},
    )
    assert applied.json()["status"] == "applied"
    patch = client.get(f"/api/v1/missions/{mission_id}/patch").json()
    assert patch["target"] == "sandbox"
    assert patch["review_required_for_external_system"] is True
    assert patch["plan_digest"] == applied.json()["applied_plan_digest"]


def test_sse_resume_and_patch_without_plan(tmp_path, monkeypatch) -> None:
    client, mission_service = client_for(tmp_path, monkeypatch)
    mission = create(client, "sse-create")
    mission_id = mission["id"]
    patch = client.get(f"/api/v1/missions/{mission_id}/patch")
    assert patch.status_code == 409
    terminal = mission_service.get(mission_id)
    terminal.status = MissionStatus.VERIFIED
    mission_service.store.put(terminal, expected_version=terminal.version)

    with client.stream(
        "GET",
        f"/api/v1/missions/{mission_id}/events",
        headers={"Last-Event-ID": "0"},
    ) as response:
        body = "".join(response.iter_text())
    assert response.status_code == 200
    assert "event: mission-event" in body
    assert "id: 1" in body

    with client.stream(
        "GET",
        f"/api/v1/missions/{mission_id}/events",
        headers={"Last-Event-ID": "1"},
    ) as response:
        resumed = "".join(response.iter_text())
    assert "id: 1" not in resumed


def test_internal_pubsub_validation_and_delivery(tmp_path, monkeypatch) -> None:
    client, _ = client_for(tmp_path, monkeypatch)
    mission = create(client, "pubsub-create")
    mission_id = mission["id"]
    invalid = client.post("/internal/pubsub", json={"message": {"data": "not-base64"}})
    assert invalid.status_code == 400

    telemetry = {
        "event_id": "pubsub-event",
        "event_type": "station_outage",
        "affected_resources": ["GS-PACIFIC-02"],
        "start_minute": 5,
        "expected_duration_minutes": 42,
        "confidence": 1,
        "source": "pubsub-test",
    }
    payload = json.dumps({"mission_id": mission_id, "telemetry": telemetry}).encode()
    envelope = {
        "message": {
            "messageId": "pubsub-message-1",
            "data": base64.b64encode(payload).decode(),
        }
    }
    accepted = client.post("/internal/pubsub", json=envelope)
    assert accepted.status_code == 200
    assert accepted.json()["accepted"] is True
    persisted = client.get(f"/api/v1/missions/{mission_id}").json()
    assert persisted["telemetry"][0]["event_id"] == "pubsub-event"


def test_cloud_retry_is_requeued_on_private_worker(tmp_path, monkeypatch) -> None:
    client, mission_service = client_for(tmp_path, monkeypatch)
    mission = create(client, "cloud-retry-create")
    mission_id = mission["id"]
    client.post(
        f"/api/v1/missions/{mission_id}/intent",
        headers={"Idempotency-Key": "cloud-retry-intent"},
        json={"text": DEFAULT_OPERATOR_TEXT, "idempotency_key": "ignored"},
    )
    client.post(
        f"/api/v1/missions/{mission_id}/clarifications",
        headers={"Idempotency-Key": "cloud-retry-clarify"},
        json={"answer": "urgent_deadline", "idempotency_key": "ignored"},
    )
    persisted = mission_service.get(mission_id)
    persisted.status = MissionStatus.CORTEX_UNAVAILABLE
    mission_service.store.put(persisted, expected_version=persisted.version)

    settings = main.get_settings()
    settings.mode = "cloud"
    settings.role = "web"
    settings.worker_base_url = "https://constellation-worker.example"
    dispatched: list[tuple[str, str, str]] = []

    def enqueue(settings, queued_mission_id, key, target):
        dispatched.append((queued_mission_id, key, target))
        return "projects/test/locations/us-central1/queues/mission-plans/tasks/retry"

    monkeypatch.setattr(main, "enqueue_plan", enqueue)
    response = client.post(
        f"/api/v1/missions/{mission_id}/retry",
        headers={"Idempotency-Key": "cloud-retry"},
        json={"idempotency_key": "ignored-body-key"},
    )

    assert response.status_code == 202
    assert response.json()["status"] == "planning"
    assert dispatched == [(mission_id, "cloud-retry", settings.worker_base_url)]
    assert response.json()["audit"][-1]["type"] == "planning.requeued"
