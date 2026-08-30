from __future__ import annotations

import json
import re
from typing import Any

from .digests import sha256_digest
from .models import Constraint, MissionIntent

DEFAULT_OPERATOR_TEXT = (
    "Preserve every health contact. Complete the urgent model-evaluation workload before "
    "the deadline. Avoid dropping previously accepted critical jobs and minimize schedule disruption."
)


class SemanticCompilationError(ValueError):
    """Raised when untrusted model output cannot be represented honestly."""


def _canonical_payload(priority_choice: str | None) -> dict[str, Any]:
    objective_order = ["health_coverage"]
    ambiguities: list[str] = []
    if priority_choice is None:
        ambiguities.append("urgent_deadline_vs_noncritical_downlinks")
        objective_order.extend(["operator_clarification_required", "schedule_disruption"])
    elif priority_choice == "urgent_deadline":
        objective_order.extend(
            ["urgent_deadline", "accepted_critical_jobs", "noncritical_downlinks", "schedule_disruption"]
        )
    else:
        objective_order.extend(
            ["noncritical_downlinks", "urgent_deadline", "accepted_critical_jobs", "schedule_disruption"]
        )

    hard = [
        Constraint(kind="minimum", subject="health_contacts", value="all", source="operator"),
        Constraint(kind="exclude", subject="failed_resources", value=True, source="telemetry"),
        Constraint(kind="deadline", subject="JOB-URGENT", value=92, source="operator"),
        Constraint(kind="preserve", subject="accepted_critical_jobs", value=True, source="operator"),
    ]
    soft = [
        Constraint(kind="minimize", subject="schedule_disruption", value=True, source="operator"),
        Constraint(kind="defer_allowed", subject="noncritical_downlinks", value=True, source="policy"),
    ]
    return {
        "required_obligations": [
            "health:SAT-01",
            "health:SAT-07",
            "health:SAT-11",
            "compute:JOB-URGENT",
            "downlink:JOB-URGENT",
            "compute:JOB-CRITICAL-01",
        ],
        "hard_constraints": [item.model_dump(mode="json") for item in hard],
        "soft_preferences": [item.model_dump(mode="json") for item in soft],
        "objective_order": objective_order,
        "accepted_defaults": ["noncritical_downlinks_may_move_to_next_horizon"],
        "unresolved_ambiguities": ambiguities,
    }


def canonicalize_intent(
    *,
    operator_text: str,
    model_id: str,
    priority_choice: str | None = None,
    live_interpretation: bool = False,
    extracted: dict[str, Any] | None = None,
    interaction_id: str | None = None,
    duration_ms: int | None = None,
    usage_metadata: dict[str, Any] | None = None,
    fallback_reason: str | None = None,
) -> MissionIntent:
    """Compile model output into a canonical intent and fail closed on semantic drift.

    In local mode the committed mission contract is used. In live mode ``extracted`` is
    schema-validated and compared with that contract before a solve is authorized.
    """
    if len(operator_text.strip()) < 10:
        raise SemanticCompilationError("operator text is too short to establish mission intent")

    expected = _canonical_payload(priority_choice)
    if extracted is not None:
        allowed = set(expected)
        unexpected = set(extracted) - allowed
        if unexpected:
            raise SemanticCompilationError(f"unexpected model fields: {sorted(unexpected)}")
        candidate = {**expected, **extracted}
        # A live model may reorder prose-derived lists; canonical ordering removes presentation drift.
        for field in ("required_obligations", "hard_constraints", "soft_preferences", "accepted_defaults"):
            if field in candidate:
                candidate[field] = sorted(candidate[field], key=lambda value: json.dumps(value, sort_keys=True))
        expected_sorted = dict(expected)
        for field in ("required_obligations", "hard_constraints", "soft_preferences", "accepted_defaults"):
            expected_sorted[field] = sorted(expected_sorted[field], key=lambda value: json.dumps(value, sort_keys=True))
        if candidate != expected_sorted:
            delta_fields = sorted(key for key in expected_sorted if candidate.get(key) != expected_sorted[key])
            raise SemanticCompilationError(
                "live interpretation differs from the committed mission contract in: " + ", ".join(delta_fields)
            )
        expected = candidate

    digest = sha256_digest(expected)
    return MissionIntent(
        **expected,
        canonical_digest=digest,
        gemini_model_id=model_id,
        live_interpretation=live_interpretation,
        interaction_id=interaction_id,
        duration_ms=duration_ms,
        usage_metadata=usage_metadata or {},
        fallback_reason=fallback_reason,
    )


def looks_like_prompt_injection(text: str) -> bool:
    patterns = [
        r"ignore\s+(all\s+)?previous",
        r"system\s+prompt",
        r"reveal\s+(the\s+)?secret",
        r"execute\s+(a\s+)?shell",
    ]
    return any(re.search(pattern, text, flags=re.IGNORECASE) for pattern in patterns)
