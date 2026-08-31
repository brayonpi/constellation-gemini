from copy import deepcopy

import pytest
from constellation.compiler import DEFAULT_OPERATOR_TEXT
from constellation.models import ClarificationRequest, CreateMissionRequest, IntentRequest, TelemetryEvent
from constellation.service import InvalidTransition, MissionService
from constellation.verifier import verify_mission


async def build_verified(service: MissionService):
    mission = service.create(CreateMissionRequest(idempotency_key="create-workflow-0001"))
    mission = await service.set_intent(
        mission.id,
        IntentRequest(text=DEFAULT_OPERATOR_TEXT, idempotency_key="intent-workflow-0001"),
    )
    assert mission.status == "awaiting_clarification"
    event = TelemetryEvent(
        event_id="event-workflow-0001",
        event_type="compound_orbital_compute_failure",
        affected_resources=["GS-PACIFIC-02", "COMPUTE-SAT-07", "COMPUTE-SAT-08"],
        start_minute=5,
        expected_duration_minutes=42,
        confidence=1,
        source="test-pubsub",
    )
    mission = service.add_event(mission.id, event, "event-key-workflow-0001")
    mission = await service.clarify(
        mission.id,
        ClarificationRequest(answer="urgent_deadline", idempotency_key="clarify-workflow-0001"),
    )
    return await service.plan(mission.id, "plan-workflow-0001")


@pytest.mark.asyncio
async def test_full_workflow_verifies_and_applies(mission_service: MissionService) -> None:
    mission = await build_verified(mission_service)
    assert mission.status == "verified"
    assert mission.plan and mission.plan.verification_report
    assert mission.plan.verification_report.verified
    assert mission.plan.compute_placement is not None
    assert mission.runtime_telemetry
    assert mission.runtime_telemetry.candidate_bundle_count == len(mission.bundles)
    assert mission.runtime_telemetry.process_peak_rss_mb > 0
    assert mission.runtime_telemetry.verifier_wall_time_ms is not None
    assert any(
        event.type == "simulation.cover.started" and event.component == "local-simulator"
        for event in mission.audit
    )
    assert any(
        event.type == "simulation.cover.completed" and event.component == "local-simulator"
        for event in mission.audit
    )
    assert all(
        event.component == "local-simulator"
        for event in mission.audit
        if event.type == "topology.refined"
    )
    applied = mission_service.apply(mission.id)
    assert applied.status == "applied"
    assert applied.plan and applied.plan.apply_status == "applied_to_sandbox"


@pytest.mark.asyncio
async def test_tampered_qap_cost_yields_counterexample(mission_service: MissionService) -> None:
    mission = await build_verified(mission_service)
    assert mission.plan and mission.intent
    tampered = mission.plan.model_copy(deep=True)
    assert tampered.qap_reported_cost is not None
    tampered.qap_reported_cost += 1
    report = verify_mission(
        snapshot=mission.snapshot,
        intent=mission.intent,
        events=mission.telemetry,
        bundles=mission.bundles,
        plan=tampered,
    )
    assert not report.verified
    assert any(issue.code == "QAP_COST_MISMATCH" for issue in report.issues)


@pytest.mark.asyncio
async def test_unverified_plan_cannot_apply(mission_service: MissionService) -> None:
    mission = mission_service.create(CreateMissionRequest(idempotency_key="create-blocked-0001"))
    with pytest.raises(InvalidTransition):
        mission_service.apply(mission.id)


@pytest.mark.asyncio
async def test_impossible_mission_reports_uncovered_and_never_applies(
    mission_service: MissionService,
) -> None:
    mission = mission_service.create(CreateMissionRequest(idempotency_key="create-impossible-0001"))
    mission = await mission_service.set_intent(
        mission.id,
        IntentRequest(text=DEFAULT_OPERATOR_TEXT, idempotency_key="intent-impossible-0001"),
    )
    mission = await mission_service.clarify(
        mission.id,
        ClarificationRequest(answer="urgent_deadline", idempotency_key="clarify-impossible-0001"),
    )
    event = TelemetryEvent(
        event_id="all-stations-offline",
        event_type="ground_network_outage",
        affected_resources=[station.id for station in mission.snapshot.ground_stations],
        start_minute=0,
        expected_duration_minutes=180,
        confidence=1,
        source="test",
    )
    mission = mission_service.add_event(mission.id, event, "event-impossible-0001")
    mission = await mission_service.plan(mission.id, "plan-impossible-0001")
    assert mission.status == "impossible"
    assert mission.plan and mission.plan.uncovered_obligations
    assert mission.plan.apply_status == "not_applied"
    with pytest.raises(InvalidTransition):
        mission_service.apply(mission.id)


@pytest.mark.asyncio
async def test_alternative_priority_changes_contract_and_fails_closed_when_not_representable(
    mission_service: MissionService,
) -> None:
    mission = mission_service.create(CreateMissionRequest(idempotency_key="create-alternative-0001"))
    mission = await mission_service.set_intent(
        mission.id,
        IntentRequest(text=DEFAULT_OPERATOR_TEXT, idempotency_key="intent-alternative-0001"),
    )
    mission = await mission_service.clarify(
        mission.id,
        ClarificationRequest(answer="noncritical_downlinks", idempotency_key="clarify-alternative-0001"),
    )
    assert mission.intent
    assert mission.intent.objective_order[1] == "noncritical_downlinks"
    mission = await mission_service.plan(mission.id, "plan-alternative-0001")
    assert mission.status == "contract_rejected"
    assert mission.plan is None
    assert mission.bundles == []
    assert mission.audit[-1].type == "contract.unsupported_priority"
    with pytest.raises(InvalidTransition):
        mission_service.apply(mission.id)


def test_duplicate_telemetry_is_idempotent(mission_service: MissionService) -> None:
    mission = mission_service.create(CreateMissionRequest(idempotency_key="create-dedupe-0001"))
    event = TelemetryEvent(
        event_id="same-event",
        event_type="station_outage",
        affected_resources=["GS-PACIFIC-02"],
        start_minute=5,
        expected_duration_minutes=42,
        confidence=1,
        source="test",
    )
    first = mission_service.add_event(mission.id, event, "event-dedupe-0001")
    second = mission_service.add_event(mission.id, deepcopy(event), "event-dedupe-0002")
    assert len(first.telemetry) == len(second.telemetry) == 1
