from __future__ import annotations

import uuid
from typing import Any

from .agent import interpret_intent
from .bundles import (
    cover_contract,
    deterministic_cover,
    deterministic_qap,
    generate_candidate_bundles,
    qap_contract,
)
from .config import Settings
from .cortex import CortexClient, CortexUnavailable
from .digests import sha256_digest
from .fixtures import load_snapshot
from .models import (
    AuditEvent,
    ClarificationRequest,
    CortexReceipt,
    CostComponents,
    CreateMissionRequest,
    IntentRequest,
    MissionPlan,
    MissionRecord,
    MissionStatus,
    TelemetryEvent,
)
from .store import FirestoreMissionStore, MissionStore
from .verifier import qap_cost, verify_mission


class MissionNotFound(KeyError):
    pass


class InvalidTransition(RuntimeError):
    pass


class MissionService:
    def __init__(self, settings: Settings):
        self.settings = settings
        if settings.mode == "cloud":
            if not settings.google_cloud_project:
                raise RuntimeError("GOOGLE_CLOUD_PROJECT is required in cloud mode")
            self.store = FirestoreMissionStore(settings.google_cloud_project)
        else:
            self.store = MissionStore(settings.database_path)
        self.cortex = CortexClient(settings)

    def _get(self, mission_id: str) -> MissionRecord:
        mission = self.store.get(mission_id)
        if not mission:
            raise MissionNotFound(mission_id)
        return mission

    @staticmethod
    def _audit(mission: MissionRecord, event_type: str, message: str, **metadata: Any) -> None:
        mission.audit.append(
            AuditEvent(sequence=len(mission.audit) + 1, type=event_type, message=message, metadata=metadata)
        )

    def create(self, request: CreateMissionRequest) -> MissionRecord:
        candidate_id = str(uuid.uuid4())
        mission_id = self.store.claim_idempotency("create", request.idempotency_key, candidate_id)
        existing = self.store.get(mission_id)
        if existing:
            return existing
        mission = MissionRecord(
            id=mission_id,
            name=request.name,
            status=MissionStatus.CREATED,
            snapshot=load_snapshot(request.fixture),
        )
        self._audit(mission, "mission.created", "Nominal simulated mission loaded", fixture=request.fixture)
        return self.store.put(mission)

    async def set_intent(self, mission_id: str, request: IntentRequest) -> MissionRecord:
        mission = self._get(mission_id)
        operation = f"intent:{mission_id}"
        claimed = self.store.claim_idempotency(operation, request.idempotency_key, mission_id)
        if claimed != mission_id:
            raise InvalidTransition("idempotency key belongs to another mission")
        if mission.intent and mission.operator_text == request.text:
            return mission
        mission.operator_text = request.text
        mission.intent = await interpret_intent(self.settings, request.text)
        mission.status = (
            MissionStatus.AWAITING_CLARIFICATION if mission.intent.unresolved_ambiguities else MissionStatus.READY
        )
        self._audit(
            mission,
            "intent.canonicalized",
            "Mission intent compiled into a canonical model",
            digest=mission.intent.canonical_digest,
            live=mission.intent.live_interpretation,
        )
        if mission.status == MissionStatus.AWAITING_CLARIFICATION:
            self._audit(
                mission,
                "clarification.required",
                "Objective priority changes the feasible recovery policy",
                ambiguity="urgent_deadline_vs_noncritical_downlinks",
            )
        return self.store.put(mission)

    def add_event(self, mission_id: str, event: TelemetryEvent, idempotency_key: str) -> MissionRecord:
        mission = self._get(mission_id)
        operation = f"event:{mission_id}"
        self.store.claim_idempotency(operation, idempotency_key, mission_id)
        if any(existing.event_id == event.event_id for existing in mission.telemetry):
            return mission
        mission.telemetry.append(event)
        self._audit(
            mission,
            "telemetry.accepted",
            "Telemetry event accepted and deduplicated",
            event_id=event.event_id,
            affected_resources=event.affected_resources,
        )
        return self.store.put(mission)

    async def clarify(self, mission_id: str, request: ClarificationRequest) -> MissionRecord:
        mission = self._get(mission_id)
        if mission.status != MissionStatus.AWAITING_CLARIFICATION or not mission.operator_text:
            raise InvalidTransition("mission is not awaiting a material clarification")
        mission.intent = await interpret_intent(
            self.settings,
            mission.operator_text,
            priority_choice=request.answer,
        )
        mission.status = MissionStatus.READY
        self._audit(
            mission,
            "clarification.accepted",
            "Objective order updated from explicit operator choice",
            answer=request.answer,
            digest=mission.intent.canonical_digest,
        )
        return self.store.put(mission)

    async def plan(self, mission_id: str, idempotency_key: str) -> MissionRecord:
        mission = self._get(mission_id)
        if mission.status in {MissionStatus.VERIFIED, MissionStatus.APPLIED} and mission.plan:
            return mission
        if mission.status not in {MissionStatus.READY, MissionStatus.PLANNING} or not mission.intent:
            raise InvalidTransition("mission must have resolved intent before planning")
        mission.status = MissionStatus.PLANNING
        self._audit(mission, "resources.quarantined", "Failed resources excluded before candidate generation")
        mission.bundles = generate_candidate_bundles(mission.snapshot, mission.intent, mission.telemetry)
        self._audit(
            mission,
            "bundles.generated",
            "Deterministic locally valid candidate bundles generated",
            count=len(mission.bundles),
        )
        contract = cover_contract(mission.bundles, mission.intent)
        self._audit(
            mission,
            "cortex.submitted",
            "Coverage contract submitted to HexStellar Cortex"
            if self.settings.live_cortex_available
            else "Live Cortex unavailable; bounded local fallback selected explicitly",
            live=self.settings.live_cortex_available,
            contract_digest=sha256_digest(contract),
        )
        selected_indices: list[int]
        uncovered: list[str]
        receipts: list[CortexReceipt]
        certainty: str
        try:
            response = await self.cortex.solve(
                "cover",
                contract,
                idempotency_key=f"constellation:{mission_id}:{idempotency_key}:cover",
            )
            selected_indices = [int(index) for index in response.get("answer", [])]
            indices_valid = len(set(selected_indices)) == len(selected_indices) and all(
                0 <= index < len(mission.bundles) for index in selected_indices
            )
            if response.get("uncovered") != 0 or response.get("violations") != 0 or not indices_valid:
                selected_indices = []
                uncovered = list(mission.intent.required_obligations)
            else:
                covered = {item for index in selected_indices for item in mission.bundles[index].obligations_covered}
                uncovered = sorted(set(mission.intent.required_obligations) - covered)
            certainty = str(response.get("certainty", "abstained"))
            receipts = [
                CortexReceipt(
                    request_id=str(response.get("request_id", mission_id)),
                    model=self.settings.cortex_model,
                    certainty=certainty,
                    receipt=response.get("receipt", {}),
                    seed=4242,
                    effort=self.settings.cortex_effort,
                )
            ]
        except CortexUnavailable:
            selected_indices, uncovered = deterministic_cover(mission.bundles, mission.intent)
            certainty = "verified_operation"
            receipts = [
                CortexReceipt(
                    request_id=f"offline-{mission_id}",
                    model="local-bounded-exhaustive-cover",
                    certainty=certainty,
                    receipt={"offline_precomputed": True, "contract_digest": sha256_digest(contract)},
                    seed=4242,
                    effort="bounded",
                )
            ]

        selected = [mission.bundles[index] for index in selected_indices]
        topology = qap_contract()
        qap_answer: list[int] | None = None
        qap_reported_cost: int | None = None
        try:
            qap_response = await self.cortex.solve(
                "qap",
                topology,
                idempotency_key=f"constellation:{mission_id}:{idempotency_key}:qap",
            )
            candidate_answer = [int(index) for index in qap_response.get("answer", [])]
            candidate_cost = int(qap_response.get("cost", -1))
            identity = list(range(len(topology["flow"])))
            recomputed_identity = qap_cost(topology["flow"], topology["dist"], identity)
            if sorted(candidate_answer) == identity:
                recomputed_candidate = qap_cost(topology["flow"], topology["dist"], candidate_answer)
                if candidate_cost == recomputed_candidate and recomputed_candidate <= recomputed_identity:
                    qap_answer, qap_reported_cost = candidate_answer, candidate_cost
                    receipts.append(
                        CortexReceipt(
                            request_id=str(qap_response.get("request_id", f"{mission_id}-qap")),
                            model=self.settings.cortex_model,
                            certainty=str(qap_response.get("certainty", "abstained")),
                            receipt=qap_response.get("receipt", {}),
                            seed=4242,
                            effort=self.settings.cortex_effort,
                        )
                    )
        except CortexUnavailable:
            qap_answer, qap_reported_cost = deterministic_qap(topology["flow"], topology["dist"])
            receipts.append(
                CortexReceipt(
                    request_id=f"offline-{mission_id}-qap",
                    model="local-bounded-exhaustive-qap",
                    certainty="verified_operation",
                    receipt={"offline_precomputed": True, "contract_digest": sha256_digest(topology)},
                    seed=4242,
                    effort="bounded",
                )
            )
        self._audit(
            mission,
            "topology.refined" if qap_answer else "topology.refinement_rejected",
            "Compute placement candidate recomputed independently"
            if qap_answer
            else "Coverage plan retained without topology refinement",
            live=self.settings.live_cortex_available,
        )
        mission.plan = MissionPlan(
            mission_id=mission.id,
            selected_bundle_ids=[bundle.id for bundle in selected],
            compute_placement=qap_answer,
            qap_flow=topology["flow"] if qap_answer else None,
            qap_dist=topology["dist"] if qap_answer else None,
            qap_reported_cost=qap_reported_cost,
            postponed_jobs=[job.id for job in mission.snapshot.jobs if job.criticality == "deferable"],
            uncovered_obligations=uncovered,
            objective_components=CostComponents(
                disruption=sum(bundle.costs.disruption for bundle in selected),
                delay=sum(bundle.costs.delay for bundle in selected),
                migration=sum(bundle.costs.migration for bundle in selected),
            ),
            certainty=certainty,
            receipts=receipts,
        )
        if uncovered:
            mission.status = MissionStatus.IMPOSSIBLE
            self._audit(
                mission,
                "mission.impossible",
                "No plan covered every required obligation; sandbox mutation blocked",
                uncovered=uncovered,
            )
            return self.store.put(mission)

        mission.status = MissionStatus.VERIFYING
        self._audit(mission, "verification.started", "Independent mission replay started")
        mission.plan.verification_report = verify_mission(
            snapshot=mission.snapshot,
            intent=mission.intent,
            events=mission.telemetry,
            bundles=mission.bundles,
            plan=mission.plan,
        )
        if mission.plan.verification_report.verified:
            mission.status = MissionStatus.VERIFIED
            self._audit(
                mission,
                "verification.passed",
                "All declared simulation-domain checks passed",
                plan_digest=mission.plan.verification_report.plan_digest,
            )
        else:
            mission.status = MissionStatus.REJECTED
            mission.plan.apply_status = "rejected"
            self._audit(
                mission,
                "verification.failed",
                "Independent replay found a counterexample; sandbox mutation blocked",
                issues=[issue.model_dump(mode="json") for issue in mission.plan.verification_report.issues],
            )
        return self.store.put(mission)

    def mark_queued(self, mission_id: str, task_name: str) -> MissionRecord:
        mission = self._get(mission_id)
        if mission.status != MissionStatus.READY:
            raise InvalidTransition("only a ready mission can be queued")
        mission.status = MissionStatus.PLANNING
        self._audit(
            mission,
            "planning.queued",
            "Durable authenticated worker task created",
            task_name=task_name,
        )
        return self.store.put(mission)

    def verify(self, mission_id: str) -> MissionRecord:
        mission = self._get(mission_id)
        if not mission.intent or not mission.plan:
            raise InvalidTransition("mission has no plan to verify")
        mission.plan.verification_report = verify_mission(
            snapshot=mission.snapshot,
            intent=mission.intent,
            events=mission.telemetry,
            bundles=mission.bundles,
            plan=mission.plan,
        )
        mission.status = MissionStatus.VERIFIED if mission.plan.verification_report.verified else MissionStatus.REJECTED
        return self.store.put(mission)

    def apply(self, mission_id: str) -> MissionRecord:
        mission = self._get(mission_id)
        if mission.status != MissionStatus.VERIFIED or not mission.plan or not mission.plan.verification_report:
            raise InvalidTransition("only an independently verified plan can mutate sandbox state")
        mission.plan.apply_status = "applied_to_sandbox"
        mission.status = MissionStatus.APPLIED
        self._audit(
            mission,
            "sandbox.updated",
            "Verified plan applied to the simulated mission state",
            plan_digest=mission.plan.verification_report.plan_digest,
        )
        return self.store.put(mission)

    def get(self, mission_id: str) -> MissionRecord:
        return self._get(mission_id)
