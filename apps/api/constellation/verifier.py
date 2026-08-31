from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Iterable
from itertools import pairwise

from .digests import sha256_digest
from .models import (
    CandidateBundle,
    MissionIntent,
    MissionPlan,
    OrbitalFleetSnapshot,
    ScheduledAction,
    TelemetryEvent,
    VerificationIssue,
    VerificationReport,
)


def _overlap(left: ScheduledAction, right: ScheduledAction) -> bool:
    return left.interval.start < right.interval.end and right.interval.start < left.interval.end


def _issue(code: str, message: str, **witness: object) -> VerificationIssue:
    return VerificationIssue(code=code, message=message, witness=witness)


def verify_mission(
    *,
    snapshot: OrbitalFleetSnapshot,
    intent: MissionIntent,
    events: list[TelemetryEvent],
    bundles: list[CandidateBundle],
    plan: MissionPlan,
) -> VerificationReport:
    """Replay a proposed plan without importing or calling HexStellar.

    This verifier establishes the listed domain properties only. It does not establish
    physical spacecraft safety, solver optimality, or correctness outside the simulation.
    """
    issues: list[VerificationIssue] = []
    by_id = {bundle.id: bundle for bundle in bundles}
    selected: list[CandidateBundle] = []
    for bundle_id in plan.selected_bundle_ids:
        if bundle_id not in by_id:
            issues.append(_issue("UNKNOWN_BUNDLE", "selected bundle does not exist", bundle_id=bundle_id))
        else:
            selected.append(by_id[bundle_id])

    expected_input_digest = sha256_digest(
        {
            "snapshot_sha256": snapshot.sha256,
            "intent_digest": intent.canonical_digest,
            "event_ids": sorted(event.event_id for event in events),
        }
    )

    obligations = [item for bundle in selected for item in bundle.obligations_covered]
    obligation_counts = Counter(obligations)
    for required in intent.required_obligations:
        if obligation_counts[required] == 0:
            issues.append(_issue("UNCOVERED_OBLIGATION", "required obligation is uncovered", obligation=required))
    for obligation, count in obligation_counts.items():
        if obligation.startswith("compute:") and count > 1:
            issues.append(
                _issue(
                    "DUPLICATE_JOB", "compute obligation is covered more than once", obligation=obligation, count=count
                )
            )

    failed = {resource for event in events for resource in event.affected_resources}
    for bundle in selected:
        contaminated = sorted(set(bundle.resources_used) & failed)
        if contaminated:
            issues.append(
                _issue(
                    "FAILED_RESOURCE_USED",
                    "bundle references quarantined resource",
                    bundle_id=bundle.id,
                    resources=contaminated,
                )
            )

    satellites = {satellite.id: satellite for satellite in snapshot.satellites}
    stations = {station.id: station for station in snapshot.ground_stations}
    windows = snapshot.contact_windows
    actions = [action for bundle in selected for action in bundle.actions]
    resource_actions: dict[str, list[ScheduledAction]] = defaultdict(list)
    for action in actions:
        resource_actions[action.satellite_id].append(action)
        if action.station_id:
            resource_actions[action.station_id].append(action)

    for resource, scheduled in resource_actions.items():
        ordered = sorted(scheduled, key=lambda action: (action.interval.start, action.id))
        for left, right in pairwise(ordered):
            if _overlap(left, right):
                issues.append(
                    _issue(
                        "RESOURCE_OVERLAP",
                        "two actions overlap on a shared resource",
                        resource=resource,
                        first=left.id,
                        second=right.id,
                    )
                )

    for action in actions:
        if action.kind in {"downlink", "health"}:
            matches = [
                window
                for window in windows
                if window.satellite_id == action.satellite_id
                and window.station_id == action.station_id
                and window.interval.start <= action.interval.start
                and action.interval.end <= window.interval.end
                and (window.kind == "both" or window.kind == action.kind)
            ]
            if not matches:
                issues.append(
                    _issue("OUTSIDE_CONTACT_WINDOW", "contact action is outside a valid window", action_id=action.id)
                )
            station = stations.get(action.station_id or "")
            if station:
                for outage in station.offline_intervals:
                    if action.interval.start < outage.end and outage.start < action.interval.end:
                        issues.append(
                            _issue(
                                "STATION_OFFLINE",
                                "contact uses an offline station",
                                action_id=action.id,
                                station_id=station.id,
                            )
                        )

    job_actions: dict[str, list[ScheduledAction]] = defaultdict(list)
    for action in actions:
        if action.job_id:
            job_actions[action.job_id].append(action)
    jobs = {job.id: job for job in snapshot.jobs}
    for job_id, scheduled in job_actions.items():
        compute = [action for action in scheduled if action.kind == "compute"]
        downlink = [action for action in scheduled if action.kind == "downlink"]
        if downlink and (
            not compute or min(item.interval.start for item in downlink) < max(item.interval.end for item in compute)
        ):
            issues.append(_issue("DOWNLINK_BEFORE_COMPUTE", "downlink precedes completed compute", job_id=job_id))
        job = jobs.get(job_id)
        if job and job.criticality == "critical" and scheduled:
            completion = max(action.interval.end for action in scheduled)
            if completion > job.deadline:
                issues.append(
                    _issue(
                        "CRITICAL_DEADLINE_MISSED",
                        "critical workload completes after its deadline",
                        job_id=job_id,
                        completion=completion,
                        deadline=job.deadline,
                    )
                )

    for satellite_id, satellite in satellites.items():
        energy = satellite.energy_capacity
        storage = 0.0
        for action in sorted(resource_actions.get(satellite_id, []), key=lambda item: item.interval.end):
            energy += action.energy_delta
            storage += action.storage_delta
            if energy < satellite.energy_floor:
                issues.append(
                    _issue(
                        "ENERGY_FLOOR",
                        "energy fell below the configured floor",
                        satellite_id=satellite_id,
                        action_id=action.id,
                        energy=energy,
                        floor=satellite.energy_floor,
                    )
                )
            if storage < 0 or storage > satellite.storage_capacity:
                issues.append(
                    _issue(
                        "STORAGE_BOUND",
                        "storage left the valid range",
                        satellite_id=satellite_id,
                        action_id=action.id,
                        storage=storage,
                        capacity=satellite.storage_capacity,
                    )
                )

    if plan.compute_placement is not None:
        placement = plan.compute_placement
        if sorted(placement) != list(range(len(placement))):
            issues.append(
                _issue("INVALID_QAP_PERMUTATION", "compute placement is not a permutation", placement=placement)
            )
        elif plan.qap_flow is None or plan.qap_dist is None or plan.qap_reported_cost is None:
            issues.append(_issue("QAP_EVIDENCE_MISSING", "placement omitted its flow, distance, or reported cost"))
        else:
            try:
                recomputed = qap_cost(plan.qap_flow, plan.qap_dist, placement)
            except (ValueError, IndexError) as exc:
                issues.append(_issue("INVALID_QAP_CONTRACT", "QAP contract cannot be replayed", error=str(exc)))
            else:
                if recomputed != plan.qap_reported_cost:
                    issues.append(
                        _issue(
                            "QAP_COST_MISMATCH",
                            "reported QAP cost differs from independent recomputation",
                            reported=plan.qap_reported_cost,
                            recomputed=recomputed,
                        )
                    )

    receipt_valid = bool(plan.receipts) and all(
        receipt.request_id and receipt.model and receipt.certainty and isinstance(receipt.receipt, dict)
        for receipt in plan.receipts
    )
    if not receipt_valid:
        issues.append(_issue("MALFORMED_RECEIPT", "plan has no structurally valid computational receipt"))

    reported_uncovered = sorted(plan.uncovered_obligations)
    recomputed_uncovered = sorted(set(intent.required_obligations) - set(obligations))
    if reported_uncovered != recomputed_uncovered:
        issues.append(
            _issue(
                "UNCOVERED_MISMATCH",
                "reported uncovered obligations differ from replay",
                reported=reported_uncovered,
                recomputed=recomputed_uncovered,
            )
        )

    checks = {
        "coverage": not any(issue.code in {"UNCOVERED_OBLIGATION", "UNCOVERED_MISMATCH"} for issue in issues),
        "no_duplicate_jobs": not any(issue.code == "DUPLICATE_JOB" for issue in issues),
        "quarantine": not any(issue.code == "FAILED_RESOURCE_USED" for issue in issues),
        "temporal": not any(
            issue.code in {"RESOURCE_OVERLAP", "OUTSIDE_CONTACT_WINDOW", "DOWNLINK_BEFORE_COMPUTE", "STATION_OFFLINE"}
            for issue in issues
        ),
        "resources": not any(issue.code in {"ENERGY_FLOOR", "STORAGE_BOUND"} for issue in issues),
        "deadlines": not any(issue.code == "CRITICAL_DEADLINE_MISSED" for issue in issues),
        "qap": not any(issue.code.startswith("QAP_") or issue.code == "INVALID_QAP_PERMUTATION" for issue in issues),
        "provenance": receipt_valid,
    }
    # Application state is not part of the proposed schedule. Excluding apply_status keeps
    # the plan fingerprint stable when the already verified sandbox mutation is recorded.
    plan_payload = plan.model_dump(mode="json", exclude={"verification_report", "apply_status"})
    return VerificationReport(
        verified=not issues,
        assurance="verified" if not issues else "abstained",
        checks=checks,
        issues=issues,
        input_digest=expected_input_digest,
        plan_digest=sha256_digest(plan_payload),
    )


def qap_cost(flow: list[list[int]], dist: list[list[int]], placement: Iterable[int]) -> int:
    answer = list(placement)
    if sorted(answer) != list(range(len(answer))):
        raise ValueError("placement must be a permutation")
    return sum(flow[i][j] * dist[answer[i]][answer[j]] for i in range(len(flow)) for j in range(len(flow)))
