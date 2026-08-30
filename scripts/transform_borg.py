#!/usr/bin/env python3
"""Transform an authorized Borg trace extraction into OrbitalComputeJob records.

The transformation preserves workload provenance while keeping the orbital mission objective
explicitly project-created. It does not claim to reproduce Borg scheduling or TPU semantics.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resource_class(cpu: float, memory: float) -> str:
    if cpu >= 0.5 or memory >= 0.5:
        return "C2"
    return "C1"


def transform(rows: list[dict[str, str]], limit: int) -> list[dict]:
    jobs: list[dict] = []
    for index, row in enumerate(rows[:limit], start=1):
        cpu = float(row["requested_cpu"])
        memory = float(row["requested_memory"])
        start = int(row["start_time"])
        end = int(row["end_time"])
        normalized_duration = max(3, min(24, round((end - start) / 60_000_000)))
        priority = max(0, int(float(row["priority"])))
        criticality = "critical" if index <= 2 else "deferable" if index % 2 else "normal"
        job_id = "JOB-URGENT" if index == 1 else "JOB-CRITICAL-01" if index == 2 else f"JOB-{index:02d}"
        jobs.append(
            {
                "id": job_id,
                "source_trace_id": row["anonymized_collection_id"],
                "resource_class": resource_class(cpu, memory),
                "duration": normalized_duration,
                "priority": priority,
                "output_size_mb": 20 + min(160, round(memory * 200)),
                "deadline": 92 if index == 1 else 121 if index == 2 else 120 + index,
                "dependency_group": f"trace-{row['anonymized_collection_id'][:8]}",
                "criticality": criticality,
                "transformation_notes": {
                    "requested_cpu": cpu,
                    "requested_memory": memory,
                    "output_size_and_deadline": "project-created scenario fields, not Borg trace measurements",
                },
            }
        )
    return jobs


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--dataset-version", default="clusterdata-2019")
    parser.add_argument("--limit", type=int, default=24)
    args = parser.parse_args()
    with args.input.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    jobs = transform(rows, args.limit)
    args.output.write_text(json.dumps(jobs, indent=2) + "\n", encoding="utf-8")
    manifest = {
        "status": "borg_derived",
        "source_name": "Google Borg ClusterData 2019",
        "source_url": "https://github.com/google/cluster-data",
        "license": "CC BY",
        "dataset_version": args.dataset_version,
        "extraction_timestamp_utc": datetime.now(UTC).isoformat(),
        "query": "data/borg/extract.sql",
        "source_file": args.input.name,
        "source_row_count": len(rows),
        "derived_row_count": len(jobs),
        "source_sha256": file_sha256(args.input),
        "derived_sha256": file_sha256(args.output),
        "transformation_script": "scripts/transform_borg.py",
        "claim_boundary": (
            "Resource classes derive from normalized CPU and memory requests. Output size, deadline, "
            "criticality, and all orbital objectives are project-created scenario fields."
        ),
    }
    args.manifest.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
