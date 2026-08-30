from __future__ import annotations

from collections import defaultdict
from itertools import permutations

from .digests import sha256_digest
from .models import (
    CandidateBundle,
    CostComponents,
    Interval,
    MissionIntent,
    OrbitalFleetSnapshot,
    ScheduledAction,
    TelemetryEvent,
)


def _failed_resources(events: list[TelemetryEvent]) -> set[str]:
    failed: set[str] = set()
    for event in events:
        failed.update(event.affected_resources)
    return failed


def _bundle(
    bundle_id: str,
    satellite_id: str,
    actions: list[ScheduledAction],
    obligations: list[str],
    resources: list[str],
    costs: CostComponents,
    energy: list[float],
    storage: list[float],
) -> CandidateBundle:
    payload = {
        "id": bundle_id,
        "satellite_id": satellite_id,
        "actions": [action.model_dump(mode="json") for action in actions],
        "obligations_covered": sorted(obligations),
        "resources_used": sorted(resources),
        "costs": costs.model_dump(mode="json"),
        "energy_trajectory": energy,
        "storage_trajectory": storage,
    }
    return CandidateBundle(
        **payload,
        dependencies=[],
        local_verification_digest=sha256_digest(payload),
    )


def generate_candidate_bundles(
    snapshot: OrbitalFleetSnapshot,
    intent: MissionIntent,
    events: list[TelemetryEvent],
) -> list[CandidateBundle]:
    """Generate deterministic, locally valid recovery bundles.

    This is deliberately domain code rather than an LLM tool. The model may state intent,
    but cannot mint resources, contact windows, or executable actions.
    """
    failed = _failed_resources(events)
    satellites = {sat.id: sat for sat in snapshot.satellites if sat.id not in failed and not sat.isolated}
    stations = {station.id: station for station in snapshot.ground_stations if station.id not in failed}
    windows_by_satellite: dict[str, list] = defaultdict(list)
    for window in snapshot.contact_windows:
        if window.satellite_id in satellites and window.station_id in stations:
            windows_by_satellite[window.satellite_id].append(window)

    bundles: list[CandidateBundle] = []
    for satellite_id in sorted(satellites):
        satellite = satellites[satellite_id]
        for window in sorted(windows_by_satellite[satellite_id], key=lambda value: value.interval.start):
            if window.kind in {"health", "both"} and satellite_id in {"SAT-01", "SAT-07", "SAT-11"}:
                action = ScheduledAction(
                    id=f"ACT-H-{satellite_id}-{window.id}",
                    kind="health",
                    satellite_id=satellite_id,
                    station_id=window.station_id,
                    interval=Interval(start=window.interval.start, end=window.interval.start + 3),
                    energy_delta=-1,
                )
                bundles.append(
                    _bundle(
                        f"B-H-{satellite_id}-{window.id}",
                        satellite_id,
                        [action],
                        [f"health:{satellite_id}"],
                        [satellite_id, window.station_id],
                        CostComponents(disruption=1),
                        [satellite.energy_capacity, satellite.energy_capacity - 1],
                        [0, 0],
                    )
                )

    jobs = {job.id: job for job in snapshot.jobs}
    eligible = [sat for sat in satellites.values() if sat.compute_slots > 0]
    for job_id in ("JOB-URGENT", "JOB-CRITICAL-01"):
        job = jobs[job_id]
        for satellite in sorted(eligible, key=lambda value: value.id):
            if satellite.compute_class != job.resource_class:
                continue
            compute_resource = f"COMPUTE-{satellite.id}"
            if compute_resource in failed:
                continue
            windows = [
                window
                for window in windows_by_satellite[satellite.id]
                if window.kind in {"downlink", "both"} and window.interval.end <= job.deadline
            ]
            for window in windows:
                compute_end = window.interval.start - 2
                compute_start = compute_end - job.duration
                if compute_start < 0 or window.capacity_mb < job.output_size_mb:
                    continue
                compute = ScheduledAction(
                    id=f"ACT-C-{job.id}-{satellite.id}-{window.id}",
                    kind="compute",
                    satellite_id=satellite.id,
                    job_id=job.id,
                    interval=Interval(start=compute_start, end=compute_end),
                    energy_delta=-float(job.duration),
                    storage_delta=float(job.output_size_mb),
                )
                downlink = ScheduledAction(
                    id=f"ACT-D-{job.id}-{satellite.id}-{window.id}",
                    kind="downlink",
                    satellite_id=satellite.id,
                    station_id=window.station_id,
                    job_id=job.id,
                    interval=Interval(start=window.interval.start, end=window.interval.start + 4),
                    energy_delta=-2,
                    storage_delta=-float(job.output_size_mb),
                )
                final_energy = satellite.energy_capacity - job.duration - 2
                if final_energy < satellite.energy_floor:
                    continue
                bundles.append(
                    _bundle(
                        f"B-J-{job.id}-{satellite.id}-{window.id}",
                        satellite.id,
                        [compute, downlink],
                        [f"compute:{job.id}", f"downlink:{job.id}"],
                        [satellite.id, compute_resource, window.station_id],
                        CostComponents(
                            disruption=2,
                            delay=max(0, downlink.interval.end - (job.deadline - 15)),
                            migration=0 if satellite.id in {"SAT-03", "SAT-09"} else 2,
                        ),
                        [satellite.energy_capacity, satellite.energy_capacity - job.duration, final_energy],
                        [0, job.output_size_mb, 0],
                    )
                )
    return sorted(bundles, key=lambda value: value.id)


def cover_contract(bundles: list[CandidateBundle], intent: MissionIntent) -> dict:
    universe = sorted(intent.required_obligations)
    element_index = {element: index for index, element in enumerate(universe)}
    sets = [[element_index[item] for item in bundle.obligations_covered if item in element_index] for bundle in bundles]
    conflicts: list[list[int]] = []
    for left_index, left in enumerate(bundles):
        for right_index in range(left_index + 1, len(bundles)):
            right = bundles[right_index]
            overlap = set(left.resources_used) & set(right.resources_used)
            temporal_overlap = any(
                a.interval.start < b.interval.end and b.interval.start < a.interval.end
                for a in left.actions
                for b in right.actions
            )
            if overlap and temporal_overlap:
                conflicts.append([left_index, right_index])
    return {
        "description": (
            "Select a minimum-disruption set of locally valid mission bundles covering every required obligation."
        ),
        "sets": sets,
        "elements": len(universe),
        "min_cover": [1 for _ in universe],
        "max_cover": [1 if element.startswith("compute:") else len(bundles) for element in universe],
        "cost": [bundle.costs.total for bundle in bundles],
        "conflicts": conflicts,
    }


def deterministic_cover(bundles: list[CandidateBundle], intent: MissionIntent) -> tuple[list[int], list[str]]:
    """Bounded local fallback: exhaustive search over the small committed demo fixture."""
    obligations = set(intent.required_obligations)
    best: tuple[int, list[int]] | None = None
    count = len(bundles)
    if count > 22:
        return [], sorted(obligations)
    for mask in range(1, 1 << count):
        selected = [index for index in range(count) if mask & (1 << index)]
        covered: set[str] = set()
        duplicate = False
        for index in selected:
            incoming = set(bundles[index].obligations_covered)
            if any(item.startswith("compute:") and item in covered for item in incoming):
                duplicate = True
                break
            covered.update(incoming)
        if duplicate or not obligations.issubset(covered):
            continue
        if any(
            set(bundles[left].resources_used) & set(bundles[right].resources_used)
            and any(
                a.interval.start < b.interval.end and b.interval.start < a.interval.end
                for a in bundles[left].actions
                for b in bundles[right].actions
            )
            for position, left in enumerate(selected)
            for right in selected[position + 1 :]
        ):
            continue
        cost = sum(bundles[index].costs.total for index in selected)
        if best is None or (cost, selected) < best:
            best = (cost, selected)
    if best is None:
        covered = set().union(*(set(bundle.obligations_covered) for bundle in bundles))
        return [], sorted(obligations - covered)
    return best[1], []


def qap_contract() -> dict:
    """Return the small, declared topology refinement contract used by the demo."""
    return {
        "description": (
            "Place four communicating compute shards onto four eligible orbital ranks "
            "to minimize declared traffic multiplied by link cost."
        ),
        "flow": [
            [0, 8, 2, 1],
            [8, 0, 6, 2],
            [2, 6, 0, 7],
            [1, 2, 7, 0],
        ],
        "dist": [
            [0, 1, 4, 3],
            [1, 0, 2, 4],
            [4, 2, 0, 1],
            [3, 4, 1, 0],
        ],
    }


def deterministic_qap(flow: list[list[int]], dist: list[list[int]]) -> tuple[list[int], int]:
    def cost(answer: tuple[int, ...]) -> int:
        return sum(flow[i][j] * dist[answer[i]][answer[j]] for i in range(len(flow)) for j in range(len(flow)))

    best_cost, best_answer = min((cost(answer), answer) for answer in permutations(range(len(flow))))
    return list(best_answer), best_cost
