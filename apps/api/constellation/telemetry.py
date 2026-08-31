from __future__ import annotations

import platform
import resource
import sys
import time

from .models import ExecutionMode, RunTelemetry


def normalize_peak_rss_mb(raw_peak_rss: float, runtime_platform: str) -> float:
    """Normalize ``ru_maxrss`` to MiB without hiding its OS-specific units.

    macOS reports bytes. Linux and the other supported Cloud Run runtimes
    report KiB. Keeping this conversion isolated makes the measurement easy to
    test and prevents the common silent 1024x macOS error.
    """

    divisor = 1024**2 if runtime_platform == "darwin" else 1024
    return round(raw_peak_rss / divisor, 2)


def process_peak_rss_mb() -> float:
    usage = resource.getrusage(resource.RUSAGE_SELF)
    return normalize_peak_rss_mb(float(usage.ru_maxrss), sys.platform)


def capture_run_telemetry(
    *,
    planning_started: float,
    verifier_wall_time_ms: int | None,
    cover_round_trip_ms: int | None,
    qap_round_trip_ms: int | None,
    candidate_bundle_count: int,
    execution_mode: ExecutionMode,
) -> RunTelemetry:
    return RunTelemetry(
        planning_wall_time_ms=round((time.perf_counter() - planning_started) * 1000),
        verifier_wall_time_ms=verifier_wall_time_ms,
        cover_round_trip_ms=cover_round_trip_ms,
        qap_round_trip_ms=qap_round_trip_ms,
        process_peak_rss_mb=process_peak_rss_mb(),
        candidate_bundle_count=candidate_bundle_count,
        execution_mode=execution_mode,
        runtime_platform=f"{platform.system()} {platform.machine()} · Python {platform.python_version()}",
    )
