from __future__ import annotations

import time
import uuid
from typing import Any

from .agent import interpret_intent
from .artifacts import build_mission_artifacts
from .bundles import (
    cover_contract,
    deterministic_cover,
    deterministic_qap,
    generate_candidate_bundles,
    qap_contract,
)
from .config import Settings
from .cortex import CortexClient, CortexContractRejected, CortexError, CortexUnavailable
from .digests import sha256_digest
from .fixtures import load_snapshot
from .models import (
    AuditEvent,
    ClarificationRequest,
    CortexReceipt,
    CostComponents,
    CreateMissionRequest,
    ExecutionMode,
    IntentRequest,
    MissionPlan,
    MissionRecord,
    MissionStatus,
    TelemetryEvent,
)
from .store import (
    ConcurrentUpdate,
    FirestoreMissionStore,
    IdempotencyConflict,
    MissionStore,
    StoreProtocol,
)
from .telemetry import capture_run_telemetry
from .verifier import qap_cost, verify_mission


class MissionNotFound(KeyError):
    pass


class InvalidTransition(RuntimeError):
    pass


class MissionService:
    """Central, auditable state machine for the committed mission scenario."""

    def __init__(self, settings: Settings):
        self.settings = settings
        if settings.mode == "cloud":
            if not settings.google_cloud_project:
                raise RuntimeError("GOOGLE_CLOUD_PROJECT is required in cloud mode")
            self.store: StoreProtocol = FirestoreMissionStore(settings.google_cloud_project)
        else:
            self.store = MissionStore(settings.database_path)
        self.cortex = CortexClient(settings)

    def _get(self, mission_id: str) -> MissionRecord:
        mission = self.store.get(mission_id)
        if not mission:
            raise MissionNotFound(mission_id)
        return mission

    def _save(self, mission: MissionRecord) -> MissionRecord:
        return self.store.put(mission, expected_version=mission.version)

    @staticmethod
    def _audit(
        mission: MissionRecord,
        event_type: str,
        message: str,
        *,
        component: str = "mission-coordinator",
        status: str = "info",
        duration_ms: int | None = None,
        input_digest: str | None = None,
        output_digest: str | None = None,
        retry_count: int = 0,
        certainty: str | None = None,
        artifact_refs: list[str] | None = None,
        **metadata: Any,
    ) -> None:
        mission.audit.append(
            AuditEvent(
                sequence=len(mission.audit) + 1,
                type=event_type,
                message=message,
                mission_id=mission.id,
                run_id=mission.run_id,
                correlation_id=mission.correlation_id,
                component=component,
                status=status,  # type: ignore[arg-type]
                duration_ms=duration_ms,
                input_digest=input_digest,
                output_digest=output_digest,
                retry_count=retry_count,
                certainty=certainty,
                artifact_refs=artifact_refs or [],
                metadata=metadata,
            )
        )

    def _claim(self, mission: MissionRecord, operation: str, key: str, payload: Any) -> None:
        claimed = self.store.claim_idempotency(
            f"{operation}:{mission.id}", key, mission.id, sha256_digest(payload)
        )
        if claimed != mission.id:
            raise IdempotencyConflict("idempotency key belongs to another mission")

    def _materialize_artifacts(self, mission: MissionRecord) -> None:
        try:
            mission.artifacts = build_mission_artifacts(self.settings, mission)
            self._audit(
                mission,
                "artifacts.materialized",
                "Replay ZIP and inspection files are ready",
                component="artifact-store",
                status="completed",
                artifact_refs=[artifact.name for artifact in mission.artifacts],
                count=len(mission.artifacts),
            )
        except RuntimeError as exc:
            self._audit(
                mission,
                "artifacts.failed",
                "Mission result was kept, but the evidence files could not be created",
                component="artifact-store",
                status="failed",
                error=str(exc),
            )

    def create(self, request: CreateMissionRequest) -> MissionRecord:
        candidate_id = str(uuid.uuid4())
        request_payload = request.model_dump(mode="json", exclude={"idempotency_key"})
        mission_id = self.store.claim_idempotency(
            "create", request.idempotency_key, candidate_id, sha256_digest(request_payload)
        )
        existing = self.store.get(mission_id)
        if existing:
            return existing
        mission = MissionRecord(
            id=mission_id,
            name=request.name,
            status=MissionStatus.CREATED,
            snapshot=load_snapshot(request.fixture),
            execution_mode=(ExecutionMode.LIVE if self.settings.mode == "cloud" else ExecutionMode.LOCAL_DETERMINISTIC),
        )
        self._audit(
            mission,
            "mission.created",
            "Starting simulated schedule loaded",
            status="completed",
            output_digest=mission.snapshot.sha256,
            fixture=request.fixture,
        )
        return self.store.put(mission, expected_version=0)

    async def set_intent(self, mission_id: str, request: IntentRequest) -> MissionRecord:
        mission = self._get(mission_id)
        self._claim(mission, "intent", request.idempotency_key, {"text": request.text})
        if mission.intent and mission.operator_text == request.text:
            return mission
        mission.status = MissionStatus.INTERPRETING
        mission.operator_text = request.text
        self._audit(
            mission,
            "interpretation.started",
            "Gemini is turning the request into testable rules",
            status="started",
        )
        self._save(mission)
        started = time.perf_counter()
        try:
            mission.intent = await interpret_intent(self.settings, request.text)
        except Exception as exc:
            mission.status = MissionStatus.INTERPRETATION_FAILED
            self._audit(
                mission,
                "interpretation.failed",
                "The request could not be safely turned into rules; the run stopped",
                component="gemini-adk",
                status="failed",
                duration_ms=round((time.perf_counter() - started) * 1000),
                error_type=type(exc).__name__,
            )
            self._save(mission)
            raise InvalidTransition("mission interpretation failed closed") from exc
        mission.status = (
            MissionStatus.AWAITING_CLARIFICATION if mission.intent.unresolved_ambiguities else MissionStatus.READY
        )
        if not mission.intent.live_interpretation:
            mission.execution_mode = ExecutionMode.DEGRADED_FIXTURE
        self._audit(
            mission,
            "intent.canonicalized",
            "Gemini output normalized and frozen as testable rules",
            component="gemini-adk",
            status="completed",
            duration_ms=mission.intent.duration_ms,
            output_digest=mission.intent.canonical_digest,
            live=mission.intent.live_interpretation,
            fallback_reason=mission.intent.fallback_reason,
        )
        if mission.status == MissionStatus.AWAITING_CLARIFICATION:
            self._audit(
                mission,
                "clarification.required",
                "One priority choice changes which recovery plan wins",
                status="started",
                ambiguity="urgent_deadline_vs_noncritical_downlinks",
            )
        return self._save(mission)

    def add_event(self, mission_id: str, event: TelemetryEvent, idempotency_key: str) -> MissionRecord:
        mission = self._get(mission_id)
        self._claim(mission, "event", idempotency_key, event.model_dump(mode="json"))
        if any(existing.event_id == event.event_id for existing in mission.telemetry):
            return mission
        mission.telemetry.append(event)
        self._audit(
            mission,
            "telemetry.accepted",
            "Failure event accepted; duplicates will not start extra work",
            component="event-ingress",
            status="completed",
            input_digest=sha256_digest(event),
            event_id=event.event_id,
            affected_resources=event.affected_resources,
        )
        return self._save(mission)

    async def clarify(self, mission_id: str, request: ClarificationRequest) -> MissionRecord:
        mission = self._get(mission_id)
        self._claim(mission, "clarification", request.idempotency_key, {"answer": request.answer})
        if mission.status == MissionStatus.READY and mission.intent and not mission.intent.unresolved_ambiguities:
            return mission
        if mission.status != MissionStatus.AWAITING_CLARIFICATION or not mission.operator_text:
            raise InvalidTransition("mission is not awaiting a material clarification")
        mission.intent = await interpret_intent(self.settings, mission.operator_text, priority_choice=request.answer)
        mission.status = MissionStatus.READY
        self._audit(
            mission,
            "clarification.accepted",
            "Operator choice updated the plan priorities",
            component="gemini-adk",
            status="completed",
            output_digest=mission.intent.canonical_digest,
            answer=request.answer,
        )
        return self._save(mission)

    async def plan(
        self,
        mission_id: str,
        idempotency_key: str,
        *,
        local_simulation: bool = False,
    ) -> MissionRecord:
        planning_started = time.perf_counter()
        verifier_wall_time_ms: int | None = None
        mission = self._get(mission_id)
        self._claim(
            mission,
            "plan",
            idempotency_key,
            {"mission_id": mission_id, "local_simulation": local_simulation},
        )
        if mission.status in {MissionStatus.VERIFIED, MissionStatus.APPLIED} and mission.plan:
            return mission
        retryable = {
            MissionStatus.READY,
            MissionStatus.PLANNING,
            MissionStatus.CORTEX_UNAVAILABLE,
            MissionStatus.CONTRACT_REJECTED,
            MissionStatus.VERIFICATION_FAILED,
            MissionStatus.REJECTED,
        }
        if mission.status not in retryable or not mission.intent:
            raise InvalidTransition("mission must have resolved intent before planning")

        if local_simulation or not self.settings.live_cortex_available:
            mission.execution_mode = ExecutionMode.LOCAL_DETERMINISTIC
        if local_simulation:
            self._audit(
                mission,
                "simulation.selected",
                "The operator selected transparent deterministic simulation after the live request stopped",
                component="local-simulator",
                status="completed",
            )
            self._save(mission)

        if mission.intent.objective_order[1:2] == ["noncritical_downlinks"]:
            mission.status = MissionStatus.CONTRACT_REJECTED
            self._audit(
                mission,
                "contract.unsupported_priority",
                (
                    "The lower priority download choice was honored, but this golden scenario cannot "
                    "prove that every previously computed output is available; search and action stopped"
                ),
                component="mission-coordinator",
                status="failed",
                unsupported_constraint="preserve_all_noncritical_downlinks",
            )
            mission.runtime_telemetry = capture_run_telemetry(
                planning_started=planning_started,
                verifier_wall_time_ms=None,
                cover_round_trip_ms=None,
                qap_round_trip_ms=None,
                candidate_bundle_count=0,
                execution_mode=mission.execution_mode,
            )
            return self._save(mission)

        mission.status = MissionStatus.GENERATING_BUNDLES
        self._audit(
            mission,
            "resources.quarantined",
            "Failed resources and anything that depends on them were removed",
            component="mission-kernel",
            status="completed",
        )
        self._save(mission)
        mission.bundles = generate_candidate_bundles(mission.snapshot, mission.intent, mission.telemetry)
        self._audit(
            mission,
            "bundles.generated",
            "Prechecked schedule pieces created deterministically",
            component="mission-kernel",
            status="completed",
            output_digest=sha256_digest(mission.bundles),
            count=len(mission.bundles),
        )
        self._save(mission)

        contract = cover_contract(mission.bundles, mission.intent)
        mission.status = MissionStatus.CORTEX_COVER
        self._audit(
            mission,
            (
                "simulation.cover.started"
                if mission.execution_mode == ExecutionMode.LOCAL_DETERMINISTIC
                else "cortex.cover.submitted"
            ),
            "Transparent deterministic simulation started"
            if local_simulation
            else (
                "Complete plan search sent to HexStellar Cortex"
                if self.settings.live_cortex_available
                else "Live Cortex is not configured; bounded local execution is explicitly selected"
            ),
            component=(
                "local-simulator"
                if mission.execution_mode == ExecutionMode.LOCAL_DETERMINISTIC
                else "cortex-adapter"
            ),
            status="started",
            input_digest=sha256_digest(contract),
            live=self.settings.live_cortex_available,
        )
        self._save(mission)

        selected_indices: list[int]
        uncovered: list[str]
        receipts: list[CortexReceipt]
        certainty: str
        try:
            if mission.execution_mode == ExecutionMode.LOCAL_DETERMINISTIC:
                raise CortexUnavailable("operator selected transparent deterministic simulation")
            cortex_result = await self.cortex.solve(
                "cover",
                contract,
                idempotency_key=f"constellation:{mission_id}:{idempotency_key}:cover",
                effort=self.settings.cortex_cover_effort,
            )
            response = cortex_result.body
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
                    effort=self.settings.cortex_cover_effort,
                    command="cover",
                    request_digest=cortex_result.request_digest,
                    response_digest=sha256_digest(response),
                    latency_ms=cortex_result.latency_ms,
                    retry_count=cortex_result.retry_count,
                    engine_elapsed_ms=self._metric_int(response, "elapsed_ms"),
                    engine_peak_rss_kb=self._metric_int(response, "peak_rss_kb"),
                    compute_units=self._metric_float(response, "compute_units"),
                    observability=(
                        response["observability"]
                        if isinstance(response.get("observability"), dict)
                        else {}
                    ),
                )
            ]
            mission.execution_mode = ExecutionMode.LIVE
        except CortexUnavailable as exc:
            if self.settings.live_cortex_available and not local_simulation:
                mission.status = MissionStatus.CORTEX_UNAVAILABLE
                self._audit(
                    mission,
                    "cortex.cover.unavailable",
                    "The live Cortex request did not complete; no replacement plan was fabricated",
                    component="cortex-adapter",
                    status="failed",
                    input_digest=sha256_digest(contract),
                    error=str(exc),
                )
                mission.runtime_telemetry = capture_run_telemetry(
                    planning_started=planning_started,
                    verifier_wall_time_ms=None,
                    cover_round_trip_ms=None,
                    qap_round_trip_ms=None,
                    candidate_bundle_count=len(mission.bundles),
                    execution_mode=mission.execution_mode,
                )
                return self._save(mission)
            selected_indices, uncovered = deterministic_cover(mission.bundles, mission.intent)
            certainty = "verified_operation"
            mission.execution_mode = ExecutionMode.LOCAL_DETERMINISTIC
            receipts = [self._local_receipt(mission, "cover", contract, str(exc))]
        except CortexContractRejected as exc:
            mission.status = MissionStatus.CONTRACT_REJECTED
            self._audit(
                mission,
                "cortex.cover.rejected",
                "The public Cortex contract was rejected; no mission was applied",
                component="cortex-adapter",
                status="failed",
                input_digest=sha256_digest(contract),
                error=str(exc),
            )
            self._save(mission)
            mission.runtime_telemetry = capture_run_telemetry(
                planning_started=planning_started,
                verifier_wall_time_ms=None,
                cover_round_trip_ms=None,
                qap_round_trip_ms=None,
                candidate_bundle_count=len(mission.bundles),
                execution_mode=mission.execution_mode,
            )
            self._save(mission)
            return mission

        selected = [mission.bundles[index] for index in selected_indices]
        local_cover = mission.execution_mode == ExecutionMode.LOCAL_DETERMINISTIC
        self._audit(
            mission,
            "simulation.cover.completed" if local_cover else "cortex.cover.received",
            "The deterministic simulation returned a candidate for independent checking"
            if local_cover
            else "Cortex returned a candidate; its contract fields were checked again",
            component="local-simulator" if local_cover else "cortex-adapter",
            status="completed",
            output_digest=sha256_digest(selected_indices),
            retry_count=receipts[0].retry_count,
            certainty=certainty,
            selected_count=len(selected_indices),
            uncovered_count=len(uncovered),
        )
        self._save(mission)

        topology = qap_contract()
        mission.status = MissionStatus.CORTEX_QAP
        qap_answer: list[int] | None = None
        qap_reported_cost: int | None = None
        try:
            if mission.execution_mode == ExecutionMode.LOCAL_DETERMINISTIC:
                raise CortexUnavailable("operator selected transparent deterministic simulation")
            qap_result = await self.cortex.solve(
                "qap",
                topology,
                idempotency_key=f"constellation:{mission_id}:{idempotency_key}:qap",
                effort=self.settings.cortex_qap_effort,
            )
            qap_response = qap_result.body
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
                            effort=self.settings.cortex_qap_effort,
                            command="qap",
                            request_digest=qap_result.request_digest,
                            response_digest=sha256_digest(qap_response),
                            latency_ms=qap_result.latency_ms,
                            retry_count=qap_result.retry_count,
                            engine_elapsed_ms=self._metric_int(qap_response, "elapsed_ms"),
                            engine_peak_rss_kb=self._metric_int(qap_response, "peak_rss_kb"),
                            compute_units=self._metric_float(qap_response, "compute_units"),
                            observability=(
                                qap_response["observability"]
                                if isinstance(qap_response.get("observability"), dict)
                                else {}
                            ),
                        )
                    )
        except CortexUnavailable as exc:
            if self.settings.live_cortex_available and not local_simulation:
                self._audit(
                    mission,
                    "topology.refinement_rejected",
                    "Valid schedule kept because optional compute placement was unavailable",
                    component="cortex-adapter",
                    status="failed",
                    error=str(exc),
                )
            else:
                qap_answer, qap_reported_cost = deterministic_qap(topology["flow"], topology["dist"])
                receipts.append(self._local_receipt(mission, "qap", topology, str(exc)))
        except CortexError as exc:
            self._audit(
                mission,
                "topology.refinement_rejected",
                "Valid schedule kept because optional compute placement was rejected",
                component="cortex-adapter",
                status="failed",
                error=str(exc),
            )

        self._audit(
            mission,
            "topology.refined" if qap_answer else "topology.refinement_rejected",
            "Optional compute placement cost checked independently"
            if qap_answer
            else "Valid schedule kept without optional compute placement",
            component=(
                "local-simulator"
                if mission.execution_mode == ExecutionMode.LOCAL_DETERMINISTIC
                else "cortex-adapter"
            ),
            status="completed" if qap_answer else "info",
            output_digest=sha256_digest(qap_answer) if qap_answer else None,
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
                "No available combination completed every required task; sandbox update blocked",
                status="failed",
                uncovered=uncovered,
            )
            mission.runtime_telemetry = capture_run_telemetry(
                planning_started=planning_started,
                verifier_wall_time_ms=None,
                cover_round_trip_ms=receipts[0].latency_ms if receipts else None,
                qap_round_trip_ms=(receipts[1].latency_ms if len(receipts) > 1 else None),
                candidate_bundle_count=len(mission.bundles),
                execution_mode=mission.execution_mode,
            )
            self._materialize_artifacts(mission)
            return self._save(mission)

        mission.status = MissionStatus.VERIFYING
        self._audit(
            mission,
            "verification.started",
            "Separate minute by minute plan check started",
            component="independent-verifier",
            status="started",
        )
        self._save(mission)
        verifier_started = time.perf_counter()
        mission.plan.verification_report = verify_mission(
            snapshot=mission.snapshot,
            intent=mission.intent,
            events=mission.telemetry,
            bundles=mission.bundles,
            plan=mission.plan,
        )
        verifier_wall_time_ms = round((time.perf_counter() - verifier_started) * 1000)
        report = mission.plan.verification_report
        if report.verified:
            mission.status = MissionStatus.VERIFIED
            self._audit(
                mission,
                "verification.passed",
                "Every declared scheduling and resource rule passed",
                component="independent-verifier",
                status="completed",
                output_digest=report.plan_digest,
            )
        else:
            mission.status = MissionStatus.VERIFICATION_FAILED
            mission.plan.apply_status = "rejected"
            self._audit(
                mission,
                "verification.failed",
                "The separate checker found an exact failure; sandbox update blocked",
                component="independent-verifier",
                status="failed",
                issues=[issue.model_dump(mode="json") for issue in report.issues],
            )
        mission.runtime_telemetry = capture_run_telemetry(
            planning_started=planning_started,
            verifier_wall_time_ms=verifier_wall_time_ms,
            cover_round_trip_ms=receipts[0].latency_ms if receipts else None,
            qap_round_trip_ms=(receipts[1].latency_ms if len(receipts) > 1 else None),
            candidate_bundle_count=len(mission.bundles),
            execution_mode=mission.execution_mode,
        )
        self._audit(
            mission,
            "telemetry.captured",
            "Run time and worker memory scope recorded without benchmark claims",
            component="runtime-telemetry",
            status="completed",
            duration_ms=mission.runtime_telemetry.planning_wall_time_ms,
            process_peak_rss_mb=mission.runtime_telemetry.process_peak_rss_mb,
            rss_scope=mission.runtime_telemetry.process_peak_rss_scope,
            verifier_wall_time_ms=verifier_wall_time_ms,
        )
        self._materialize_artifacts(mission)
        return self._save(mission)

    @staticmethod
    def _metric_int(response: dict[str, Any], field: str) -> int | None:
        value = response.get(field)
        if value is None or isinstance(value, bool):
            return None
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return None
        return parsed if parsed >= 0 else None

    @staticmethod
    def _metric_float(response: dict[str, Any], field: str) -> float | None:
        value = response.get(field)
        if value is None or isinstance(value, bool):
            return None
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            return None
        return parsed if parsed >= 0 else None

    @staticmethod
    def _local_receipt(mission: MissionRecord, command: str, contract: dict[str, Any], reason: str) -> CortexReceipt:
        return CortexReceipt(
            request_id=f"local-{mission.id}-{command}",
            model=f"local-bounded-exhaustive-{command}",
            certainty="verified_operation",
            receipt={
                "local_deterministic": True,
                "contract_digest": sha256_digest(contract),
                "fallback_reason": reason,
            },
            seed=4242,
            effort="bounded",
            command=command,  # type: ignore[arg-type]
            request_digest=sha256_digest(contract),
            response_digest=None,
            latency_ms=0,
        )

    def mark_queued(
        self,
        mission_id: str,
        task_name: str,
        idempotency_key: str,
        *,
        local_simulation: bool = False,
    ) -> MissionRecord:
        mission = self._get(mission_id)
        self._claim(
            mission,
            "queue",
            idempotency_key,
            {"mission_id": mission_id, "local_simulation": local_simulation},
        )
        if mission.status == MissionStatus.PLANNING:
            return mission
        retryable = {
            MissionStatus.CORTEX_UNAVAILABLE,
            MissionStatus.CONTRACT_REJECTED,
            MissionStatus.VERIFICATION_FAILED,
            MissionStatus.REJECTED,
        }
        if mission.status != MissionStatus.READY and mission.status not in retryable:
            raise InvalidTransition("only a ready or safely retryable mission can be queued")
        is_retry = mission.status in retryable
        mission.status = MissionStatus.PLANNING
        self._audit(
            mission,
            "simulation.queued"
            if local_simulation
            else ("planning.requeued" if is_retry else "planning.queued"),
            "Transparent deterministic simulation was scheduled"
            if local_simulation
            else (
                "Cloud Tasks scheduled a safe worker retry"
                if is_retry
                else "Cloud Tasks scheduled the recovery worker"
            ),
            component="cloud-tasks",
            status="completed",
            task_name=task_name,
        )
        return self._save(mission)

    def verify(self, mission_id: str, idempotency_key: str | None = None) -> MissionRecord:
        mission = self._get(mission_id)
        idempotency_key = idempotency_key or f"direct-verify-{mission_id}"
        self._claim(mission, "verify", idempotency_key, {"mission_id": mission_id})
        if not mission.intent or not mission.plan:
            raise InvalidTransition("mission has no plan to verify")
        was_applied = mission.status == MissionStatus.APPLIED
        report = verify_mission(
            snapshot=mission.snapshot,
            intent=mission.intent,
            events=mission.telemetry,
            bundles=mission.bundles,
            plan=mission.plan,
        )
        previous_report = mission.plan.verification_report
        report_unchanged = bool(previous_report) and previous_report.model_dump(
            exclude={"verified_at"}
        ) == report.model_dump(exclude={"verified_at"})
        if report_unchanged and mission.status in {
            MissionStatus.VERIFIED,
            MissionStatus.APPLIED,
        }:
            return mission
        mission.plan.verification_report = report
        mission.status = (
            MissionStatus.APPLIED
            if report.verified and was_applied
            else (MissionStatus.VERIFIED if report.verified else MissionStatus.VERIFICATION_FAILED)
        )
        return self._save(mission)

    def apply(self, mission_id: str, idempotency_key: str | None = None) -> MissionRecord:
        mission = self._get(mission_id)
        idempotency_key = idempotency_key or f"direct-apply-{mission_id}"
        self._claim(mission, "apply", idempotency_key, {"mission_id": mission_id})
        if mission.status == MissionStatus.APPLIED and mission.plan:
            return mission
        if mission.status != MissionStatus.VERIFIED or not mission.plan or not mission.plan.verification_report:
            raise InvalidTransition("only an independently verified plan can mutate sandbox state")
        report = mission.plan.verification_report
        current_input_digest = sha256_digest(
            {
                "snapshot_sha256": mission.snapshot.sha256,
                "intent_digest": mission.intent.canonical_digest,
                "event_ids": sorted(event.event_id for event in mission.telemetry),
            }
        )
        if not report.verified or report.input_digest != current_input_digest:
            mission.status = MissionStatus.APPLY_CONFLICT
            self._audit(
                mission,
                "sandbox.apply_conflict",
                "The mission changed after it was checked; sandbox update blocked",
                status="failed",
            )
            self._save(mission)
            raise InvalidTransition("verified digest does not match the current mission")
        mission.plan.apply_status = "applied_to_sandbox"
        mission.applied_plan_digest = report.plan_digest
        mission.status = MissionStatus.APPLIED
        self._audit(
            mission,
            "sandbox.updated",
            "Checked plan applied to the simulated mission state",
            component="sandbox-mutation",
            status="completed",
            output_digest=report.plan_digest,
        )
        try:
            return self._save(mission)
        except ConcurrentUpdate as exc:
            raise InvalidTransition("mission changed before sandbox apply") from exc

    def get(self, mission_id: str) -> MissionRecord:
        return self._get(mission_id)

    def events(self, mission_id: str, after_sequence: int = 0) -> list[AuditEvent]:
        self._get(mission_id)
        return self.store.list_events(mission_id, after_sequence)
