from __future__ import annotations

import json

from .config import Settings


def enqueue_plan(
    settings: Settings,
    mission_id: str,
    idempotency_key: str,
    target_base_url: str,
) -> str:
    """Create a durable, authenticated Cloud Task for mission planning."""
    if not settings.google_cloud_project or not settings.task_service_account:
        raise RuntimeError("cloud task project and service account must be configured")
    try:
        from google.cloud import tasks_v2
    except ImportError as exc:  # pragma: no cover - optional cloud dependency
        raise RuntimeError("install the google dependency group for Cloud Tasks") from exc
    client = tasks_v2.CloudTasksClient()
    parent = client.queue_path(settings.google_cloud_project, settings.task_location, "mission-plans")
    task = {
        "http_request": {
            "http_method": tasks_v2.HttpMethod.POST,
            "url": f"{target_base_url.rstrip('/')}/internal/tasks/plan",
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"mission_id": mission_id, "idempotency_key": idempotency_key}).encode(),
            "oidc_token": {
                "service_account_email": settings.task_service_account,
                "audience": target_base_url.rstrip("/"),
            },
        }
    }
    response = client.create_task(parent=parent, task=task)
    return response.name
