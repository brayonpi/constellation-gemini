from functools import lru_cache

from constellation import main
from constellation.config import Settings
from constellation.service import MissionService
from fastapi.testclient import TestClient


def test_health_and_create(tmp_path) -> None:
    main.service.cache_clear()
    main.get_settings.cache_clear()
    main.service = lru_cache(lambda: MissionService(Settings(CONSTELLATION_DATABASE_PATH=tmp_path / "api.sqlite3")))
    client = TestClient(main.app)
    health = client.get("/api/v1/health")
    assert health.status_code == 200
    assert health.json()["simulation"] is True
    created = client.post(
        "/api/v1/missions",
        json={"name": "API mission", "fixture": "demo-12", "idempotency_key": "api-create-0001"},
    )
    assert created.status_code == 201
    assert created.json()["snapshot"]["id"] == "demo-12"
