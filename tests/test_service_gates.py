from __future__ import annotations

from copy import deepcopy

import pytest
from constellation import service as service_module
from constellation.compiler import DEFAULT_OPERATOR_TEXT
from constellation.cortex import CortexContractRejected, CortexResponse, CortexUnavailable
from constellation.models import (
    ClarificationRequest,
    CreateMissionRequest,
    IntentRequest,
    MissionStatus,
    TelemetryEvent,
)
from constellation.service import InvalidTransition, MissionNotFound, MissionService

from .test_workflow import build_verified


def failure_event(identifier: str = "service-failure") -> TelemetryEvent:
    return TelemetryEvent(
        event_id=identifier,
        event_type="compound_failure",
        affected_resources=["GS-PACIFIC-02", "COMPUTE-SAT-07", "COMPUTE-SAT-08"],
        start_minute=5,
        expected_duration_minutes=42,
        confidence=1,
        source="test",
    )


@pytest.mark.asyncio
async def test_interpretation_failure_is_persisted_and_closed(monkeypatch, mission_service) -> None:
    mission = mission_service.create(CreateMissionRequest(idempotency_key="create-interpretation-failure"))

    async def fail(*args, **kwargs):
        raise RuntimeError("provider exploded")

    monkeypatch.setattr(service_module, "interpret_intent", fail)
    with pytest.raises(InvalidTransition, match="failed closed"):
        await mission_service.set_intent(
            mission.id,
            IntentRequest(text=DEFAULT_OPERATOR_TEXT, idempotency_key="intent-failure"),
        )
    persisted = mission_service.get(mission.id)
    assert persisted.status == MissionStatus.INTERPRETATION_FAILED
    assert persisted.audit[-1].type == "interpretation.failed"


@pytest.mark.asyncio
async def test_invalid_state_transitions_are_explicit(mission_service) -> None:
    mission = mission_service.create(CreateMissionRequest(idempotency_key="create-invalid-transitions"))
    with pytest.raises(InvalidTransition, match="not awaiting"):
        await mission_service.clarify(
            mission.id,
            ClarificationRequest(answer="urgent_deadline", idempotency_key="clarify-too-early"),
        )
    with pytest.raises(InvalidTransition, match="resolved intent"):
        await mission_service.plan(mission.id, "plan-too-early")
    with pytest.raises(InvalidTransition, match="no plan"):
        mission_service.verify(mission.id, "verify-too-early")
    with pytest.raises(MissionNotFound):
        mission_service.get("missing-mission")


@pytest.mark.asyncio
async def test_apply_rejects_stale_input_digest(mission_service) -> None:
    mission = await build_verified(mission_service)
    persisted = mission_service.get(mission.id)
    persisted.telemetry.append(failure_event("late-event"))
    mission_service.store.put(persisted, expected_version=persisted.version)
    with pytest.raises(InvalidTransition, match="does not match"):
        mission_service.apply(mission.id, "apply-stale-digest")
    assert mission_service.get(mission.id).status == MissionStatus.APPLY_CONFLICT


@pytest.mark.asyncio
async def test_queue_is_idempotent_and_requires_ready_state(mission_service) -> None:
    mission = mission_service.create(CreateMissionRequest(idempotency_key="create-queue"))
    with pytest.raises(InvalidTransition, match="ready"):
        mission_service.mark_queued(mission.id, "task/early", "queue-early")
    mission = await mission_service.set_intent(
        mission.id,
        IntentRequest(text=DEFAULT_OPERATOR_TEXT, idempotency_key="intent-queue"),
    )
    mission = await mission_service.clarify(
        mission.id,
        ClarificationRequest(answer="urgent_deadline", idempotency_key="clarify-queue"),
    )
    queued = mission_service.mark_queued(mission.id, "task/one", "queue-ready")
    again = mission_service.mark_queued(mission.id, "task/one", "queue-ready")
    assert queued.status == again.status == MissionStatus.PLANNING


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "status",
    [
        MissionStatus.CORTEX_UNAVAILABLE,
        MissionStatus.CONTRACT_REJECTED,
        MissionStatus.VERIFICATION_FAILED,
        MissionStatus.REJECTED,
    ],
)
async def test_queue_accepts_only_safe_retry_states(mission_service, status) -> None:
    mission = mission_service.create(CreateMissionRequest(idempotency_key=f"create-retry-{status}"))
    mission = await mission_service.set_intent(
        mission.id,
        IntentRequest(text=DEFAULT_OPERATOR_TEXT, idempotency_key=f"intent-retry-{status}"),
    )
    mission = await mission_service.clarify(
        mission.id,
        ClarificationRequest(answer="urgent_deadline", idempotency_key=f"clarify-retry-{status}"),
    )
    mission.status = status
    mission_service.store.put(mission, expected_version=mission.version)

    queued = mission_service.mark_queued(mission.id, "task/retry", f"retry-{status}")

    assert queued.status == MissionStatus.PLANNING
    assert queued.audit[-1].type == "planning.requeued"


@pytest.mark.asyncio
async def test_configured_live_cortex_unavailability_never_fabricates_plan(settings) -> None:
    settings.hexstellar_api_key = "configured-test-key"
    service = MissionService(settings)
    mission = service.create(CreateMissionRequest(idempotency_key="create-live-unavailable"))
    mission = await service.set_intent(
        mission.id,
        IntentRequest(text=DEFAULT_OPERATOR_TEXT, idempotency_key="intent-live-unavailable"),
    )
    mission = await service.clarify(
        mission.id,
        ClarificationRequest(answer="urgent_deadline", idempotency_key="clarify-live-unavailable"),
    )
    mission = service.add_event(mission.id, failure_event(), "event-live-unavailable")

    async def unavailable(*args, **kwargs):
        raise CortexUnavailable("deadline exceeded")

    service.cortex.solve = unavailable
    result = await service.plan(mission.id, "plan-live-unavailable")
    assert result.status == MissionStatus.CORTEX_UNAVAILABLE
    assert result.plan is None
    assert result.execution_mode.value != "local_deterministic"
    assert result.audit[-1].type == "cortex.cover.unavailable"


@pytest.mark.asyncio
async def test_rejected_cover_contract_is_persisted(mission_service) -> None:
    mission = mission_service.create(CreateMissionRequest(idempotency_key="create-contract-rejected"))
    mission = await mission_service.set_intent(
        mission.id,
        IntentRequest(text=DEFAULT_OPERATOR_TEXT, idempotency_key="intent-contract-rejected"),
    )
    mission = await mission_service.clarify(
        mission.id,
        ClarificationRequest(answer="urgent_deadline", idempotency_key="clarify-contract-rejected"),
    )

    async def rejected(*args, **kwargs):
        raise CortexContractRejected("unsupported field")

    mission_service.settings.hexstellar_api_key = "configured-test-key"
    mission_service.cortex.solve = rejected
    result = await mission_service.plan(mission.id, "plan-contract-rejected")
    assert result.status == MissionStatus.CONTRACT_REJECTED
    assert result.audit[-1].type == "cortex.cover.rejected"


@pytest.mark.asyncio
async def test_live_response_preserves_certainty_and_rejects_invalid_qap(mission_service) -> None:
    mission = mission_service.create(CreateMissionRequest(idempotency_key="create-live-response"))
    mission = await mission_service.set_intent(
        mission.id,
        IntentRequest(text=DEFAULT_OPERATOR_TEXT, idempotency_key="intent-live-response"),
    )
    mission = await mission_service.clarify(
        mission.id,
        ClarificationRequest(answer="urgent_deadline", idempotency_key="clarify-live-response"),
    )
    mission = mission_service.add_event(mission.id, failure_event("live-response-event"), "event-live-response")
    mission_service.settings.hexstellar_api_key = "configured-test-key"

    async def solve(command, problem, **kwargs):
        if command == "cover":
            indices, uncovered = service_module.deterministic_cover(
                service_module.generate_candidate_bundles(mission.snapshot, mission.intent, mission.telemetry),
                mission.intent,
            )
            assert not uncovered
            return CortexResponse(
                body={
                    "answer": indices,
                    "uncovered": 0,
                    "violations": 0,
                    "certainty": "heuristic",
                    "request_id": "live-cover",
                    "receipt": {"scope": "cover"},
                },
                latency_ms=17,
                retry_count=1,
                request_digest="cover-request-digest",
            )
        return CortexResponse(
            body={"answer": [0, 0, 1], "cost": 0, "certainty": "heuristic"},
            latency_ms=4,
            retry_count=0,
            request_digest="qap-request-digest",
        )

    mission_service.cortex.solve = solve
    result = await mission_service.plan(mission.id, "plan-live-response")
    assert result.status == MissionStatus.VERIFIED
    assert result.plan and result.plan.certainty == "heuristic"
    assert result.plan.compute_placement is None
    assert result.plan.receipts[0].certainty == "heuristic"
    assert result.execution_mode.value == "live"


@pytest.mark.asyncio
async def test_verified_plan_and_apply_are_idempotent(mission_service) -> None:
    mission = await build_verified(mission_service)
    replayed = await mission_service.plan(mission.id, "plan-workflow-0001")
    assert replayed.version == mission.version
    applied = mission_service.apply(mission.id, "apply-repeat")
    version = applied.version
    again = mission_service.apply(mission.id, "apply-repeat")
    assert again.version == version
    assert deepcopy(again.plan).apply_status == "applied_to_sandbox"
