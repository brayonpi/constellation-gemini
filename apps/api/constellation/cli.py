from __future__ import annotations

import argparse
import json
from pathlib import Path

from .models import MissionRecord
from .verifier import verify_mission


def verify_file(path: Path) -> int:
    payload = json.loads(path.read_text(encoding="utf-8"))
    mission_payload = payload.get("mission", payload)
    mission = MissionRecord.model_validate(mission_payload)
    if not mission.intent or not mission.plan:
        print(json.dumps({"verified": False, "error": "replay has no intent or plan"}, indent=2))
        return 2
    report = verify_mission(
        snapshot=mission.snapshot,
        intent=mission.intent,
        events=mission.telemetry,
        bundles=mission.bundles,
        plan=mission.plan,
    )
    print(report.model_dump_json(indent=2))
    return 0 if report.verified else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Independent Constellation mission verifier")
    subparsers = parser.add_subparsers(dest="command", required=True)
    verify_parser = subparsers.add_parser("verify", help="verify a replay bundle")
    verify_parser.add_argument("path", type=Path)
    args = parser.parse_args()
    return verify_file(args.path)


if __name__ == "__main__":
    raise SystemExit(main())
