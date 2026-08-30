#!/usr/bin/env python3
"""Build the committed offline replay through the shipped workflow."""

from __future__ import annotations

import asyncio
import json
import tempfile
from pathlib import Path

from constellation.compiler import DEFAULT_OPERATOR_TEXT
from constellation.config import Settings
from constellation.models import ClarificationRequest, CreateMissionRequest, IntentRequest, TelemetryEvent
from constellation.service import MissionService

ROOT = Path(__file__).resolve().parents[1]


async def build() -> None:
    with tempfile.TemporaryDirectory() as directory:
        service = MissionService(Settings(CONSTELLATION_DATABASE_PATH=Path(directory) / "replay.sqlite3"))
        mission = service.create(CreateMissionRequest(idempotency_key="committed-replay-create"))
        mission = await service.set_intent(
            mission.id,
            IntentRequest(text=DEFAULT_OPERATOR_TEXT, idempotency_key="committed-replay-intent"),
        )
        mission = service.add_event(
            mission.id,
            TelemetryEvent(
                event_id="committed-compound-failure",
                event_type="compound_orbital_compute_failure",
                affected_resources=[
                    "GS-PACIFIC-02",
                    "COMPUTE-SAT-07",
                    "COMPUTE-SAT-08",
                ],
                start_minute=5,
                expected_duration_minutes=42,
                confidence=1,
                source="committed-offline-replay",
            ),
            "committed-replay-event",
        )
        mission = await service.clarify(
            mission.id,
            ClarificationRequest(answer="urgent_deadline", idempotency_key="committed-replay-clarification"),
        )
        mission = await service.plan(mission.id, "committed-replay-plan")
        if not mission.plan or not mission.plan.verification_report or not mission.plan.verification_report.verified:
            raise RuntimeError("the shipped workflow did not produce a verifiable replay")
        payload = {
            "format": "constellation-replay-v1",
            "offline_precomputed": True,
            "mission": mission.model_dump(mode="json"),
        }
        target = ROOT / "data" / "fixtures" / "recovered-plan.json"
        target.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        print(target)


if __name__ == "__main__":
    asyncio.run(build())
