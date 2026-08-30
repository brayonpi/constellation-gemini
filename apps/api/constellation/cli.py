from __future__ import annotations

import argparse
import hashlib
import json
import zipfile
from pathlib import Path

from .models import MissionRecord
from .verifier import verify_mission


def verify_file(path: Path) -> int:
    if path.suffix == ".zip":
        try:
            with zipfile.ZipFile(path) as archive:
                names = set(archive.namelist())
                if "mission.json" not in names or "checksums.json" not in names:
                    raise ValueError("replay ZIP is missing mission.json or checksums.json")
                checksums = json.loads(archive.read("checksums.json"))
                for name, expected in checksums.items():
                    if name not in names:
                        raise ValueError(f"replay ZIP is missing {name}")
                    observed = hashlib.sha256(archive.read(name)).hexdigest()
                    if observed != expected:
                        raise ValueError(f"replay checksum mismatch: {name}")
                payload = json.loads(archive.read("mission.json"))
        except (zipfile.BadZipFile, KeyError, ValueError, json.JSONDecodeError) as exc:
            print(json.dumps({"verified": False, "error": str(exc)}, indent=2))
            return 2
    else:
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
    verify_parser.add_argument("path", type=Path, help="replay JSON or mission-replay.zip")
    args = parser.parse_args()
    return verify_file(args.path)


if __name__ == "__main__":
    raise SystemExit(main())
