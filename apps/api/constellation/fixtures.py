from __future__ import annotations

import json
import os
from pathlib import Path

from .digests import sha256_digest
from .models import OrbitalFleetSnapshot

FIXTURE_DIR = Path(
    os.getenv("CONSTELLATION_FIXTURE_DIR", Path.cwd() / "data" / "fixtures")
).resolve()


def load_snapshot(name: str = "demo-12") -> OrbitalFleetSnapshot:
    path = FIXTURE_DIR / f"{name}.json"
    if not path.is_file():
        raise FileNotFoundError(f"unknown fixture: {name}")
    payload = json.loads(path.read_text(encoding="utf-8"))
    claimed = payload.pop("sha256")
    actual = sha256_digest(payload)
    if claimed != actual:
        raise ValueError(f"fixture digest mismatch: claimed {claimed}, computed {actual}")
    payload["sha256"] = claimed
    return OrbitalFleetSnapshot.model_validate(payload)
