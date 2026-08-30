from pathlib import Path

import pytest
from constellation.config import Settings
from constellation.service import MissionService


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        CONSTELLATION_DATABASE_PATH=tmp_path / "missions.sqlite3",
        CONSTELLATION_ARTIFACT_DIR=tmp_path / "artifacts",
    )


@pytest.fixture
def mission_service(settings: Settings) -> MissionService:
    return MissionService(settings)
