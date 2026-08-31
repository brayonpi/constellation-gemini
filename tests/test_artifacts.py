from __future__ import annotations

import hashlib
import json
import zipfile
from pathlib import Path

import pytest
from constellation.cli import verify_file
from constellation.review_guide import AI_REVIEW_PROMPT
from constellation.store import IdempotencyConflict, MissionStore

from .test_workflow import build_verified


@pytest.mark.asyncio
async def test_replay_bundle_is_self_checking_and_network_free(mission_service, settings, capsys) -> None:
    mission = await build_verified(mission_service)
    replay = settings.artifact_dir / mission.id / "mission-replay.zip"
    assert replay.is_file()

    with zipfile.ZipFile(replay) as archive:
        names = set(archive.namelist())
        assert "AI-REVIEW-PROMPT.md" in names
        assert "VERIFIER-SOURCE.py" in names
        assert "runtime-telemetry.json" in names
        assert archive.read("AI-REVIEW-PROMPT.md").decode() == AI_REVIEW_PROMPT
        assert b"def verify_mission(" in archive.read("VERIFIER-SOURCE.py")
        runtime = json.loads(archive.read("runtime-telemetry.json"))
        assert runtime["process_peak_rss_scope"] == "worker_process_peak_since_start"
        assert runtime["measurement_note"].startswith("Operational telemetry for this run")
        checksums = json.loads(archive.read("checksums.json"))
        for name, expected in checksums.items():
            assert hashlib.sha256(archive.read(name)).hexdigest() == expected

    assert verify_file(replay) == 0
    assert '"verified": true' in capsys.readouterr().out


@pytest.mark.asyncio
async def test_tampered_replay_fails_before_verification(mission_service, settings, tmp_path: Path, capsys) -> None:
    mission = await build_verified(mission_service)
    source = settings.artifact_dir / mission.id / "mission-replay.zip"
    tampered = tmp_path / "tampered.zip"
    with zipfile.ZipFile(source) as original, zipfile.ZipFile(tampered, "w") as output:
        for name in original.namelist():
            content = original.read(name)
            if name == "mission-result.json":
                content += b"\n"
            output.writestr(name, content)

    assert verify_file(tampered) == 2
    assert "replay checksum mismatch" in capsys.readouterr().out


def test_idempotency_key_conflicts_on_payload_drift(tmp_path: Path) -> None:
    store = MissionStore(tmp_path / "store.sqlite3")
    assert store.claim_idempotency("intent", "same-key", "mission-1", "digest-a") == "mission-1"
    assert store.claim_idempotency("intent", "same-key", "mission-2", "digest-a") == "mission-1"
    with pytest.raises(IdempotencyConflict):
        store.claim_idempotency("intent", "same-key", "mission-1", "digest-b")
