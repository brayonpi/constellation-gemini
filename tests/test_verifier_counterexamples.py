from __future__ import annotations

from copy import deepcopy

import pytest
from constellation.verifier import verify_mission

from .test_workflow import build_verified


def verify(mission, plan):
    return verify_mission(
        snapshot=mission.snapshot,
        intent=mission.intent,
        events=mission.telemetry,
        bundles=mission.bundles,
        plan=plan,
    )


@pytest.mark.asyncio
async def test_unknown_bundle_and_uncovered_mismatch_are_witnessed(mission_service) -> None:
    mission = await build_verified(mission_service)
    plan = mission.plan.model_copy(deep=True)
    plan.selected_bundle_ids.append("BUNDLE-DOES-NOT-EXIST")
    plan.uncovered_obligations = []
    report = verify(mission, plan)
    codes = {issue.code for issue in report.issues}
    assert "UNKNOWN_BUNDLE" in codes


@pytest.mark.asyncio
async def test_duplicate_compute_and_quarantined_resource_are_witnessed(mission_service) -> None:
    mission = await build_verified(mission_service)
    selected = set(mission.plan.selected_bundle_ids)
    original = next(bundle for bundle in mission.bundles if bundle.id in selected and any(
        obligation.startswith("compute:") for obligation in bundle.obligations_covered
    ))
    duplicate = original.model_copy(deep=True)
    duplicate.id = "B-DUPLICATE-COMPUTE"
    duplicate.resources_used.append("COMPUTE-SAT-07")
    bundles = [*mission.bundles, duplicate]
    plan = mission.plan.model_copy(deep=True)
    plan.selected_bundle_ids.append(duplicate.id)
    report = verify_mission(
        snapshot=mission.snapshot,
        intent=mission.intent,
        events=mission.telemetry,
        bundles=bundles,
        plan=plan,
    )
    codes = {issue.code for issue in report.issues}
    assert "DUPLICATE_JOB" in codes
    assert "FAILED_RESOURCE_USED" in codes


@pytest.mark.asyncio
async def test_temporal_resource_deadline_and_receipt_counterexamples(mission_service) -> None:
    mission = await build_verified(mission_service)
    selected = set(mission.plan.selected_bundle_ids)
    bundles = deepcopy(mission.bundles)
    target = next(bundle for bundle in bundles if bundle.id in selected and bundle.actions)
    target.actions[0].interval.start = 170
    target.actions[0].interval.end = 179
    target.actions[0].energy_delta = -10_000
    target.actions[0].storage_delta = 10_000
    plan = mission.plan.model_copy(deep=True)
    plan.receipts = []
    report = verify_mission(
        snapshot=mission.snapshot,
        intent=mission.intent,
        events=mission.telemetry,
        bundles=bundles,
        plan=plan,
    )
    codes = {issue.code for issue in report.issues}
    assert "ENERGY_FLOOR" in codes
    assert "STORAGE_BOUND" in codes
    assert "MALFORMED_RECEIPT" in codes


@pytest.mark.asyncio
async def test_qap_permutation_and_missing_evidence_counterexamples(mission_service) -> None:
    mission = await build_verified(mission_service)
    invalid = mission.plan.model_copy(deep=True)
    invalid.compute_placement = [0, 0, 1]
    report = verify(mission, invalid)
    assert any(issue.code == "INVALID_QAP_PERMUTATION" for issue in report.issues)

    missing = mission.plan.model_copy(deep=True)
    missing.qap_flow = None
    report = verify(mission, missing)
    assert any(issue.code == "QAP_EVIDENCE_MISSING" for issue in report.issues)
