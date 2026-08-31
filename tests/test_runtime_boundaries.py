from __future__ import annotations

import json
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest
from constellation import cli, verify_bundle
from constellation.artifacts import ArtifactNotFound, ArtifactStore
from constellation.cloud import enqueue_plan
from constellation.config import Settings
from constellation.models import CreateMissionRequest
from constellation.store import ConcurrentUpdate


def test_artifact_store_enforces_immutable_plain_names(settings) -> None:
    store = ArtifactStore(settings)
    manifest = store.write("mission", "evidence.json", b"{}", "application/json", "test")
    assert manifest.sha256
    assert store.read("mission", "evidence.json") == b"{}"
    store.write("mission", "evidence.json", b"{}", "application/json", "test")
    with pytest.raises(RuntimeError, match="immutable artifact collision"):
        store.write("mission", "evidence.json", b"changed", "application/json", "test")
    with pytest.raises(ValueError):
        store.write("mission", "../escape", b"x", "text/plain", "test")
    with pytest.raises(ArtifactNotFound):
        store.read("mission", "../escape")
    with pytest.raises(ArtifactNotFound):
        store.read("mission", "missing.json")


def test_sqlite_store_detects_optimistic_concurrency_and_filters_events(mission_service) -> None:
    mission = mission_service.create(CreateMissionRequest(idempotency_key="runtime-store-create"))
    stale = mission.model_copy(deep=True)
    mission.name = "updated"
    mission_service.store.put(mission, expected_version=mission.version)
    with pytest.raises(ConcurrentUpdate):
        mission_service.store.put(stale, expected_version=stale.version)
    assert mission_service.store.list_events(mission.id, after_sequence=1) == []


def test_cloud_task_contract_uses_oidc_and_private_worker(monkeypatch) -> None:
    captured: dict = {}

    class Client:
        def queue_path(self, project, location, queue):
            return f"projects/{project}/locations/{location}/queues/{queue}"

        def create_task(self, *, parent, task):
            captured.update(parent=parent, task=task)
            return SimpleNamespace(name=f"{parent}/tasks/task-1")

    tasks_v2 = SimpleNamespace(CloudTasksClient=Client, HttpMethod=SimpleNamespace(POST="POST"))
    google_cloud = ModuleType("google.cloud")
    google_cloud.tasks_v2 = tasks_v2
    monkeypatch.setitem(sys.modules, "google.cloud", google_cloud)
    settings = Settings(
        GOOGLE_CLOUD_PROJECT="project-1",
        CONSTELLATION_TASK_SERVICE_ACCOUNT="worker@project-1.iam.gserviceaccount.com",
    )
    name = enqueue_plan(settings, "mission-1", "idempotency-1", "https://worker.example/")
    assert name.endswith("/tasks/task-1")
    request = captured["task"]["http_request"]
    assert request["url"] == "https://worker.example/internal/tasks/plan"
    assert request["oidc_token"]["audience"] == "https://worker.example"
    body = json.loads(request["body"])
    assert body["mission_id"] == "mission-1"
    assert body["local_simulation"] is False

    enqueue_plan(
        settings,
        "mission-1",
        "idempotency-2",
        "https://worker.example/",
        local_simulation=True,
    )
    assert json.loads(captured["task"]["http_request"]["body"])["local_simulation"] is True


def test_cloud_task_requires_project_and_service_account() -> None:
    with pytest.raises(RuntimeError, match="must be configured"):
        enqueue_plan(Settings(), "mission", "key", "https://worker.example")


def test_verify_bundle_entrypoint_usage_and_delegation(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(sys, "argv", ["verify_bundle"])
    assert verify_bundle.main() == 2
    replay = tmp_path / "replay.zip"
    replay.write_bytes(b"not-a-zip")
    monkeypatch.setattr(sys, "argv", ["verify_bundle", str(replay)])
    assert verify_bundle.main() == 2


def test_cli_entrypoint_rejects_incomplete_json_replay(monkeypatch, tmp_path: Path, mission_service) -> None:
    replay = tmp_path / "incomplete.json"
    mission = mission_service.create(CreateMissionRequest(idempotency_key="cli-incomplete-replay"))
    replay.write_text(mission.model_dump_json(), encoding="utf-8")
    monkeypatch.setattr(sys, "argv", ["constellation", "verify", str(replay)])
    assert cli.main() == 2


def test_cli_entrypoint_reports_invalid_zip(monkeypatch, tmp_path: Path) -> None:
    replay = tmp_path / "invalid.zip"
    replay.write_bytes(b"invalid")
    monkeypatch.setattr(sys, "argv", ["constellation", "verify", str(replay)])
    assert cli.main() == 2
