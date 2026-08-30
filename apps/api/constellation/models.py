from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


def utc_now() -> datetime:
    return datetime.now(UTC)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=False)


class Interval(StrictModel):
    start: int = Field(ge=0)
    end: int = Field(gt=0)

    @model_validator(mode="after")
    def ordered(self) -> Interval:
        if self.end <= self.start:
            raise ValueError("interval end must be greater than start")
        return self


class Satellite(StrictModel):
    id: str
    orbit_phase_deg: float
    compute_class: str
    compute_slots: int = Field(ge=0)
    energy_capacity: float = Field(gt=0)
    energy_floor: float = Field(ge=0)
    storage_capacity: float = Field(gt=0)
    isolated: bool = False


class GroundStation(StrictModel):
    id: str
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    offline_intervals: list[Interval] = Field(default_factory=list)


class OpticalLink(StrictModel):
    source: str
    target: str
    cost: int = Field(ge=0)
    unavailable_intervals: list[Interval] = Field(default_factory=list)


class ContactWindow(StrictModel):
    id: str
    satellite_id: str
    station_id: str
    interval: Interval
    capacity_mb: int = Field(gt=0)
    kind: Literal["downlink", "health", "both"] = "both"


class OrbitalComputeJob(StrictModel):
    id: str
    source_trace_id: str
    resource_class: str
    duration: int = Field(gt=0)
    priority: int = Field(ge=0)
    output_size_mb: int = Field(ge=0)
    deadline: int = Field(gt=0)
    dependency_group: str | None = None
    criticality: Literal["critical", "normal", "deferable"] = "normal"


class ScheduledAction(StrictModel):
    id: str
    kind: Literal["compute", "downlink", "health", "transfer"]
    satellite_id: str
    interval: Interval
    job_id: str | None = None
    station_id: str | None = None
    link: tuple[str, str] | None = None
    energy_delta: float = 0
    storage_delta: float = 0


class DatasetProvenance(StrictModel):
    name: str
    source_url: str
    license: str
    version: str
    derived_sha256: str
    transformation_manifest: str


class OrbitalFleetSnapshot(StrictModel):
    id: str
    horizon_minutes: int = Field(gt=0)
    satellites: list[Satellite]
    ground_stations: list[GroundStation]
    links: list[OpticalLink]
    contact_windows: list[ContactWindow]
    jobs: list[OrbitalComputeJob]
    existing_schedule: list[ScheduledAction]
    dataset_provenance: DatasetProvenance
    generator_version: str
    sha256: str


class Constraint(StrictModel):
    kind: str
    subject: str
    value: str | int | float | bool | list[str]
    source: Literal["operator", "telemetry", "policy", "declared_default"]


class MissionIntent(StrictModel):
    required_obligations: list[str]
    hard_constraints: list[Constraint]
    soft_preferences: list[Constraint]
    objective_order: list[str]
    accepted_defaults: list[str] = Field(default_factory=list)
    unresolved_ambiguities: list[str] = Field(default_factory=list)
    canonical_digest: str
    gemini_model_id: str
    live_interpretation: bool


class TelemetryEvent(StrictModel):
    event_id: str
    event_type: str
    affected_resources: list[str]
    start_minute: int = Field(ge=0)
    expected_duration_minutes: int = Field(gt=0)
    confidence: float = Field(ge=0, le=1)
    source: str
    received_at: datetime = Field(default_factory=utc_now)


class CostComponents(StrictModel):
    disruption: int = 0
    delay: int = 0
    migration: int = 0

    @property
    def total(self) -> int:
        return self.disruption + self.delay + self.migration


class CandidateBundle(StrictModel):
    id: str
    satellite_id: str
    actions: list[ScheduledAction]
    obligations_covered: list[str]
    resources_used: list[str]
    energy_trajectory: list[float]
    storage_trajectory: list[float]
    dependencies: list[str] = Field(default_factory=list)
    costs: CostComponents
    local_verification_digest: str


class Assurance(StrEnum):
    CERTIFIED = "certified"
    VERIFIED = "verified"
    HEURISTIC = "heuristic"
    ABSTAINED = "abstained"


class CortexReceipt(StrictModel):
    request_id: str
    model: str
    certainty: str
    receipt: dict[str, Any]
    seed: int | None = None
    effort: str | None = None


class VerificationIssue(StrictModel):
    code: str
    message: str
    witness: dict[str, Any]


class VerificationReport(StrictModel):
    verified: bool
    assurance: Literal["verified", "abstained"]
    checks: dict[str, bool]
    issues: list[VerificationIssue]
    input_digest: str
    plan_digest: str
    verified_at: datetime = Field(default_factory=utc_now)


class MissionPlan(StrictModel):
    mission_id: str
    selected_bundle_ids: list[str]
    compute_placement: list[int] | None = None
    qap_flow: list[list[int]] | None = None
    qap_dist: list[list[int]] | None = None
    qap_reported_cost: int | None = None
    postponed_jobs: list[str]
    uncovered_obligations: list[str]
    objective_components: CostComponents
    certainty: str
    receipts: list[CortexReceipt]
    verification_report: VerificationReport | None = None
    apply_status: Literal["not_applied", "applied_to_sandbox", "rejected"] = "not_applied"
    replay_bundle_path: str | None = None


class MissionStatus(StrEnum):
    CREATED = "created"
    AWAITING_CLARIFICATION = "awaiting_clarification"
    READY = "ready"
    PLANNING = "planning"
    VERIFYING = "verifying"
    VERIFIED = "verified"
    IMPOSSIBLE = "impossible"
    REJECTED = "rejected"
    APPLIED = "applied"
    FAILED = "failed"


class AuditEvent(StrictModel):
    sequence: int
    type: str
    message: str
    at: datetime = Field(default_factory=utc_now)
    metadata: dict[str, Any] = Field(default_factory=dict)


class MissionRecord(StrictModel):
    id: str
    name: str
    status: MissionStatus
    snapshot: OrbitalFleetSnapshot
    operator_text: str | None = None
    intent: MissionIntent | None = None
    telemetry: list[TelemetryEvent] = Field(default_factory=list)
    bundles: list[CandidateBundle] = Field(default_factory=list)
    plan: MissionPlan | None = None
    audit: list[AuditEvent] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class CreateMissionRequest(StrictModel):
    name: str = "Suncatcher-inspired resilience scenario"
    fixture: str = "demo-12"
    idempotency_key: str = Field(min_length=8, max_length=128)


class IntentRequest(StrictModel):
    text: str = Field(min_length=10, max_length=8000)
    idempotency_key: str = Field(min_length=8, max_length=128)


class ClarificationRequest(StrictModel):
    answer: Literal["urgent_deadline", "noncritical_downlinks"]
    idempotency_key: str = Field(min_length=8, max_length=128)


class MutationRequest(StrictModel):
    idempotency_key: str = Field(min_length=8, max_length=128)
