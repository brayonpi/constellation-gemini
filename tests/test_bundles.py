from constellation.bundles import cover_contract, generate_candidate_bundles
from constellation.compiler import DEFAULT_OPERATOR_TEXT, canonicalize_intent
from constellation.fixtures import load_snapshot
from constellation.models import TelemetryEvent


def test_bundle_generation_is_deterministic_and_quarantines_resources() -> None:
    snapshot = load_snapshot()
    intent = canonicalize_intent(
        operator_text=DEFAULT_OPERATOR_TEXT,
        model_id="fixture",
        priority_choice="urgent_deadline",
    )
    event = TelemetryEvent(
        event_id="failure-1",
        event_type="compound_failure",
        affected_resources=["GS-PACIFIC-02", "COMPUTE-SAT-03"],
        start_minute=5,
        expected_duration_minutes=42,
        confidence=1,
        source="test",
    )
    first = generate_candidate_bundles(snapshot, intent, [event])
    second = generate_candidate_bundles(snapshot, intent, [event])
    assert [bundle.local_verification_digest for bundle in first] == [
        bundle.local_verification_digest for bundle in second
    ]
    assert all("GS-PACIFIC-02" not in bundle.resources_used for bundle in first)
    assert all("COMPUTE-SAT-03" not in bundle.resources_used for bundle in first)


def test_cover_contract_uses_public_integer_schema() -> None:
    snapshot = load_snapshot()
    intent = canonicalize_intent(
        operator_text=DEFAULT_OPERATOR_TEXT, model_id="fixture", priority_choice="urgent_deadline"
    )
    bundles = generate_candidate_bundles(snapshot, intent, [])
    contract = cover_contract(bundles, intent)
    assert isinstance(contract["elements"], int)
    assert all(isinstance(index, int) for covered in contract["sets"] for index in covered)
    assert len(contract["max_cover"]) == contract["elements"]
