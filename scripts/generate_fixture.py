#!/usr/bin/env python3
"""Generate the deterministic simulated orbital fixture and its integrity digest."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def main() -> None:
    satellites = []
    for index in range(1, 13):
        satellites.append(
            {
                "id": f"SAT-{index:02d}",
                "orbit_phase_deg": (index - 1) * 30,
                "compute_class": "C2" if index in {3, 5, 9, 10} else "C1",
                "compute_slots": 2 if index in {3, 5, 9, 10} else 1,
                "energy_capacity": 100,
                "energy_floor": 30,
                "storage_capacity": 240,
                "isolated": False,
            }
        )

    stations = [
        {"id": "GS-ALASKA-01", "latitude": 64.2, "longitude": -149.5, "offline_intervals": []},
        {"id": "GS-PACIFIC-02", "latitude": 19.7, "longitude": -155.1, "offline_intervals": []},
        {"id": "GS-ATACAMA-03", "latitude": -23.0, "longitude": -67.7, "offline_intervals": []},
        {"id": "GS-NORDIC-04", "latitude": 67.9, "longitude": 21.1, "offline_intervals": []},
    ]

    links = [
        {"source": f"SAT-{left:02d}", "target": f"SAT-{right:02d}", "cost": cost, "unavailable_intervals": []}
        for left, right, cost in [(1, 3, 2), (3, 5, 1), (5, 7, 2), (7, 9, 1), (9, 11, 2), (11, 1, 1)]
    ]

    windows = []
    station_ids = [station["id"] for station in stations]
    for index in range(1, 13):
        for pass_index, start in enumerate((20 + index, 62 + index, 108 + index)):
            windows.append(
                {
                    "id": f"CW-{index:02d}-{pass_index + 1}",
                    "satellite_id": f"SAT-{index:02d}",
                    "station_id": station_ids[(index + pass_index) % len(station_ids)],
                    "interval": {"start": start, "end": start + 10},
                    "capacity_mb": 180,
                    "kind": "both",
                }
            )

    jobs = [
        {
            "id": "JOB-URGENT",
            "source_trace_id": "borg-anon-0001",
            "resource_class": "C2",
            "duration": 12,
            "priority": 10,
            "output_size_mb": 120,
            "deadline": 92,
            "dependency_group": "eval",
            "criticality": "critical",
        },
        {
            "id": "JOB-CRITICAL-01",
            "source_trace_id": "borg-anon-0002",
            "resource_class": "C2",
            "duration": 10,
            "priority": 9,
            "output_size_mb": 90,
            "deadline": 121,
            "dependency_group": "safety",
            "criticality": "critical",
        },
    ]
    for index in range(3, 25):
        jobs.append(
            {
                "id": f"JOB-{index:02d}",
                "source_trace_id": f"borg-anon-{index:04d}",
                "resource_class": "C1" if index % 3 else "C2",
                "duration": 4 + index % 7,
                "priority": 1 + index % 6,
                "output_size_mb": 20 + (index % 5) * 10,
                "deadline": 120 + index,
                "dependency_group": f"batch-{index % 4}",
                "criticality": "deferable" if index % 2 else "normal",
            }
        )

    nominal = [
        {
            "id": "NOM-H-SAT-01",
            "kind": "health",
            "satellite_id": "SAT-01",
            "interval": {"start": 21, "end": 24},
            "station_id": "GS-PACIFIC-02",
            "energy_delta": -1,
            "storage_delta": 0,
        },
        {
            "id": "NOM-C-URGENT",
            "kind": "compute",
            "satellite_id": "SAT-07",
            "interval": {"start": 38, "end": 50},
            "job_id": "JOB-URGENT",
            "energy_delta": -12,
            "storage_delta": 120,
        },
        {
            "id": "NOM-D-URGENT",
            "kind": "downlink",
            "satellite_id": "SAT-07",
            "interval": {"start": 69, "end": 73},
            "job_id": "JOB-URGENT",
            "station_id": "GS-PACIFIC-02",
            "energy_delta": -2,
            "storage_delta": -120,
        },
    ]

    payload = {
        "id": "demo-12",
        "horizon_minutes": 180,
        "satellites": satellites,
        "ground_stations": stations,
        "links": links,
        "contact_windows": windows,
        "jobs": jobs,
        "existing_schedule": nominal,
        "dataset_provenance": {
            "name": "Google Borg ClusterData 2019 — committed demonstration slice",
            "source_url": "https://github.com/google/cluster-data",
            "license": "CC BY 4.0",
            "version": "clusterdata-2019; synthetic committed fixture pending BigQuery extraction",
            "derived_sha256": "fixture-only-no-production-trace",
            "transformation_manifest": "data/borg/PROVENANCE.json",
        },
        "generator_version": "constellation-fixture-v1",
    }
    payload["sha256"] = hashlib.sha256(canonical(payload).encode("utf-8")).hexdigest()
    target = ROOT / "data" / "fixtures" / "demo-12.json"
    target.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(target)
    print(payload["sha256"])


if __name__ == "__main__":
    main()
