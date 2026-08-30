# Release inventory

Inventory date: 2026-08-30.

This is the review map for the release candidate.
It inventories externally reachable routes, public code surfaces, schemas, configuration, infrastructure, direct dependencies, claims, fallbacks, and tests.
Private helpers are reviewed with their owning module and remain visible to coverage and static analysis.

## HTTP routes

| Route | Mutation and trust boundary | Automated evidence | Disposition |
|---|---|---|---|
| `GET /api/v1/health` | Public health alias; no state | API tests | Pass locally |
| `GET /api/v1/health/live` | Process liveness only | API and container smoke tests | Pass locally |
| `GET /api/v1/health/ready` | Required runtime configuration; reports degraded local mode | API and container smoke tests | Pass locally; cloud dependencies pending |
| `POST /api/v1/missions` | Idempotent sandbox mission creation | API idempotency and validation tests | Pass locally |
| `POST /api/v1/missions/{id}/intent` | Gemini/fixture interpretation; typed canonical IR | API, compiler, and agent tests | Pass locally; live Gemini pending |
| `POST /api/v1/missions/{id}/events` | Idempotent untrusted telemetry ingestion | API and workflow tests | Pass locally |
| `POST /api/v1/missions/{id}/clarifications` | Accepts either declared material priority and recompiles rules/digest | API, compiler, workflow, and UI tests | Pass locally; unsupported all-downlink proof stops before Cortex |
| `POST /api/v1/missions/{id}/plan` | Creates Cloud Task in cloud mode; local background task in local mode | API, cloud contract, and workflow tests | Pass locally; deployed task pending |
| `POST /api/v1/missions/{id}/retry` | Requeues only explicit safe failure states | API and state-gate tests | Pass locally; deployed task pending |
| `POST /api/v1/missions/{id}/verify` | Replays without Gemini or Cortex | API and verifier tests | Pass locally |
| `POST /api/v1/missions/{id}/apply-sandbox` | Transactional digest/version/status gate; sandbox only | API, concurrency, and stale-digest tests | Pass locally |
| `GET /api/v1/missions/{id}` | Current mission snapshot | API tests | Pass locally |
| `GET /api/v1/missions/{id}/events` | Resumable SSE with `Last-Event-ID` and heartbeat | SSE tests and browser inspection | Pass locally; Cloud Run proxy pending |
| `GET /api/v1/missions/{id}/logs` | Sanitized append-only NDJSON download | API tests | Pass locally |
| `GET /api/v1/missions/{id}/timeline` | Structured nominal/recovered actions | API and UI tests | Pass locally |
| `GET /api/v1/missions/{id}/artifacts` | Artifact manifest only | API and artifact tests | Pass locally |
| `GET /api/v1/missions/{id}/artifacts/{name}` | Allowlisted manifest-backed download | API and artifact tests | Pass locally; Cloud Storage pending |
| `GET /api/v1/missions/{id}/bundle` | Replay ZIP alias | API and offline replay tests | Pass locally |
| `GET /api/v1/missions/{id}/patch` | Reviewable sandbox-only patch | API and apply tests | Pass locally |
| `POST /internal/pubsub` | IAM/internal-token protected event delivery | Pub/Sub envelope and auth tests | Pass locally; deployed IAM pending |
| `POST /internal/tasks/plan` | IAM/internal-token protected worker delivery | API/state-machine tests | Pass locally; deployed IAM pending |

Every public mutation requires an `Idempotency-Key`.
Public errors use an RFC 9457-shaped problem response with a correlation identifier and retryability flag.

## Python public surface

| Module or class | Public surface | Responsibility | Evidence |
|---|---|---|---|
| `agent` | `build_adk_app`, `interpret_intent` | ADK/Interactions construction, low-to-medium extraction, typed fallback | `test_agent.py`, `test_compiler.py` |
| `compiler` | `canonicalize_intent`, `looks_like_prompt_injection` | Deterministic normalization, semantic gates, canonical SHA-256 | `test_compiler.py`, `test_agent.py` |
| `bundles` | `generate_candidate_bundles`, `cover_contract`, `deterministic_cover`, `qap_contract`, `deterministic_qap` | Locally valid bundle generation and public solver contracts | `test_bundles.py`, `test_workflow.py` |
| `CortexClient` | `solve` | Analyze-before-solve, exact polling, bounded retry, response validation | `test_cortex.py` |
| `verifier` | `verify_mission`, `qap_cost` | Independent domain replay and counterexamples | `test_verifier_counterexamples.py`, `test_workflow.py` |
| `ArtifactStore` | `write`, `read`; `build_mission_artifacts` | Immutable local/GCS evidence and deterministic replay ZIP | `test_artifacts.py`, `test_api.py` |
| `MissionStore` | `get`, `put`, `claim_idempotency`, `list_events` | SQLite optimistic state and append-only local events | service/API tests |
| `FirestoreMissionStore` | `get`, `put`, `claim_idempotency`, `list_events` | Firestore transactions and event subcollections | interface/static tests; deployed evidence pending |
| `MissionService` | `create`, `set_intent`, `add_event`, `clarify`, `mark_queued`, `plan`, `verify`, `apply`, `get`, `events` | Central state machine and all mutation gates | `test_service_gates.py`, `test_workflow.py`, `test_api.py` |
| `cloud` | `enqueue_plan` | Authenticated Cloud Tasks dispatch | `test_runtime_boundaries.py`, `test_api.py` |
| `fixtures` | `load_snapshot` | Digest-checked deterministic scenario loading | fixture, workflow, and API tests |
| `digests` | `canonical_json`, `sha256_digest` | Stable JSON and SHA-256 boundary | compiler/artifact/workflow tests |
| `cli` | `verify_file`, `main` | Offline verifier CLI | CLI/replay tests and `make verify-demo` |
| `verify_bundle` | `main` | One-command network-free replay entry point | artifact and runtime-boundary tests |

The verifier imports no HexStellar client and performs no network request.
The Gemini adapter does not select bundles, certify a plan, or mutate state.

## Schemas and state vocabulary

| Group | Schemas | Review status |
|---|---|---|
| Fleet | `Interval`, `Satellite`, `GroundStation`, `OpticalLink`, `ContactWindow`, `OrbitalComputeJob`, `ScheduledAction`, `DatasetProvenance`, `OrbitalFleetSnapshot` | Strict Pydantic models; covered by fixture/bundle/verifier tests |
| Intent | `Constraint`, `MissionIntent`, `GeminiIntentExtraction` | Structured extraction separated from deterministic canonicalization |
| Incident | `TelemetryEvent` | Size/type constrained and treated as untrusted input |
| Search | `CostComponents`, `CandidateBundle`, `CortexResponse`, `CortexReceipt`, `Assurance` | Certainty retained; no joint-optimality inference |
| Proof | `VerificationIssue`, `VerificationReport`, `ArtifactManifest` | Counterexample and SHA-256 fields tested |
| Mission | `MissionPlan`, `MissionStatus`, `ExecutionMode`, `AuditEvent`, `MissionRecord` | Explicit state/failure vocabulary and optimistic version |
| Requests | `CreateMissionRequest`, `IntentRequest`, `ClarificationRequest`, `MutationRequest` | Strict extra-field rejection and bounded text/key sizes |

Terminal failure states are explicit: `INTERPRETATION_FAILED`, `CONTRACT_REJECTED`, `CORTEX_UNAVAILABLE`, `MISSION_IMPOSSIBLE`, `VERIFICATION_FAILED`, and `APPLY_CONFLICT`.

## Frontend surface

| Component or module | Responsibility | Evidence | Residual risk |
|---|---|---|---|
| `App` | Restored mission, state-directed narrative, launch/clarify/plan/apply orchestration, and visible fail-closed alternative choice | claim test and browser E2E inspection | Full Playwright matrix pending |
| `OrbitalGlobe` | Data-driven R3F globe, incident/recovery paths, accessible 2D/text fallback | browser and production-build inspection | Cross-device GPU matrix pending |
| `Timeline` | Horizon-derived compute/contact/resource/diff evidence | component tests and browser inspection | Mobile visual regression pending |
| `DecisionTrace` | Filterable observable run events; no chain-of-thought | browser inspection | Cloud proxy reconnect pending |
| `EvidenceRoom` | Receipts, checks, counterexamples, manifests, downloads | component/API tests | GCS live retrieval pending |
| `api` | Typed HTTP mutations, random idempotency keys, EventSource/download URLs | API transformation tests | Hosted rate/load tests pending |
| `links` | Single allowlisted map for public Cortex docs, worked examples, public CLI/client, and project source | exact-URL unit tests | Constellation source remains private until release approval |
| `types` | TypeScript projection of public mission/evidence schemas | strict TypeScript build | Generated OpenAPI types are not yet used |

The main JavaScript entry chunk is approximately 233 kB minified and 74 kB gzip.
The lazily loaded globe chunk is approximately 866 kB minified and 233 kB gzip; this is a recorded performance warning, not a hidden pass.

## Runtime configuration

| Variable | Secret | Owner and purpose | Release status |
|---|---:|---|---|
| `CONSTELLATION_MODE` | No | Selects `local` or `cloud` persistence/execution | Implemented |
| `CONSTELLATION_ROLE` | No | Selects public web or private worker behavior | Implemented |
| `CONSTELLATION_DATABASE_PATH` | No | SQLite development state path | Implemented |
| `CONSTELLATION_PUBLIC_BASE_URL` | No | Public URL metadata | Implemented |
| `CONSTELLATION_INTERNAL_TOKEN` | Yes | Optional defense in depth for local/internal delivery | Implemented; Cloud IAM remains primary |
| `CONSTELLATION_TASK_SERVICE_ACCOUNT` | No | OIDC identity for Cloud Tasks | Terraform wired |
| `CONSTELLATION_TASK_LOCATION` | No | Queue region | Terraform wired |
| `CONSTELLATION_WORKER_BASE_URL` | No | Private worker target | Terraform wired |
| `GOOGLE_CLOUD_PROJECT` | No | Vertex/Firestore/Tasks project and live-Gemini switch | Terraform wired; deploy pending |
| `GOOGLE_CLOUD_LOCATION` | No | Gemini endpoint location | Terraform wired; availability must be confirmed |
| `GEMINI_MODEL` | No | Defaults to `gemini-3.5-flash` | Implemented; live receipt pending |
| `HEXSTELLAR_API_URL` | No | Public Cortex API base URL | Implemented |
| `HEXSTELLAR_API_KEY` | Yes | Cortex credential; worker Secret Manager only | Terraform wired; secret not provisioned here |
| `CORTEX_MODEL` | No | Defaults to `cortex-1.0` | Implemented |
| `CORTEX_COVER_EFFORT` | No | Public effort enum; defaults to `medium` | Implemented |
| `CORTEX_QAP_EFFORT` | No | Public effort enum; defaults to `flash` | Implemented |
| `CONSTELLATION_ARTIFACT_DIR` | No | Local artifact root | Implemented |
| `CONSTELLATION_ARTIFACT_BUCKET` | No | Private GCS evidence bucket | Terraform wired; deploy pending |
| `CONSTELLATION_CORS_ORIGINS` | No | Explicit browser origin allowlist | Implemented |
| `CONSTELLATION_MAX_REQUEST_BYTES` | No | API request ceiling | Implemented and tested |
| `CONSTELLATION_WEB_DIST` | No | Built SPA directory in the container | Implemented and container-tested |

`CONSTELLATION_PUBLIC_RUN_LIMIT` is reserved in configuration but is not yet a distributed hosted quota.
The hosted release remains blocked until a Firestore-backed admission counter or equivalent API Gateway/Cloud Armor policy is deployed and load-tested.

## Google Cloud infrastructure

| Resource group | Concrete resources | Security/reliability disposition |
|---|---|---|
| APIs | Vertex AI, Artifact Registry, Billing Budgets, Cloud Build, Firestore, Pub/Sub, Cloud Run, Secret Manager, Storage, Cloud Tasks | Terraform declared; enablement pending |
| Identity | `constellation-web`, `constellation-worker`, `constellation-events`, `constellation-tasks` | Separate identities with scoped invoker/data roles |
| Compute | Public `constellation-web`; internal-only `constellation-worker` | Instance/concurrency limits and startup/liveness probes declared |
| State | Native Firestore database | Transactional mission versions and event subcollections implemented |
| Events | `constellation-telemetry` topic and authenticated push subscription | Retry/retention policy declared |
| Work | `mission-plans` Cloud Tasks queue | Authenticated OIDC, bounded retry, rate and concurrency declared |
| Evidence | Private versioned GCS bucket | Public-access prevention and 30-day lifecycle declared |
| Secrets | `constellation-hexstellar-api-key` | Worker-only accessor role |
| Cost | Optional USD 50 billing budget | 50%, 90%, and 100% thresholds declared |

Terraform formatting and validation are CI gates.
They remain locally unverified because Terraform is not installed in the current environment.

## Direct dependencies

| Runtime | Direct dependencies | Audit evidence |
|---|---|---|
| Python core | FastAPI, HTTPX, Pydantic, pydantic-settings, python-multipart, Uvicorn | Version ranges declared; `pip-audit` clean for published packages |
| Google | Google ADK, Firestore, Pub/Sub, Cloud Storage, Cloud Tasks, Google Gen AI SDK | Isolated optional group; container installation passed |
| Python development | pytest, pytest-asyncio, pytest-cov, pip-audit, Ruff | Test/lint/audit commands pass; one Starlette TestClient deprecation warning recorded |
| Web runtime | React, React DOM, Three.js, React Three Fiber, Lucide React | Lockfile present; `npm audit --omit=dev` reports zero known vulnerabilities |
| Web build/test | Vite, TypeScript, ESLint, Testing Library, jsdom, Vitest | Strict build, lint, and seven component/unit tests pass |

Transitive JavaScript versions are frozen by `package-lock.json` and installed with `npm ci` in CI and Docker.
Python production versions are bounded rather than fully hash-locked; an immutable container digest is the intended deployment unit.

## Claims and external references

| Claim/reference | Evidence and limit | Disposition |
|---|---|---|
| Proof-carrying mission flow | State machine, artifacts, verifier, and apply digest gate | Supported for the committed deterministic simulation |
| Gemini role | Structured extraction before deterministic canonicalization | Live Gemini interaction pending; no scheduling/safety claim |
| Cortex role | Public `cover` and optional `qap` contracts | Live sanitized receipt pending; no universal or joint-optimality claim |
| Verification | Replayed implemented constraints and counterexamples | Supported narrowly; not physical spacecraft safety |
| Project Suncatcher | Google Research article | Inspiration only; no affiliation or operational data |
| Constellation scheduling | Google Research publication | Problem-formulation context only |
| Leaf Space | Google Cloud customer story | Operational ground-segment context only |
| Google Borg ClusterData 2019 | Official Google repository | Current fixture is trace-shaped, not yet Borg-derived |
| All Things Agentic requirements | Official Devpost rules | Deadline and submission gates checked on 2026-08-30 |
| HexStellar IP boundary | Public adapter and explicit disclosure | Proprietary engine/runtime absent; Enterprise Runtime separate |
| Cortex documentation and CLI/client | Official HexStellar docs and `brayonpi/hexstellar` public repository | Judge links use the intended public surfaces; no private engine link |

All committed product and contest references are first-party Google, Google Research, Google Cloud,
official Google GitHub, official Devpost, or official public HexStellar surfaces.

## Fallback inventory

| Failure | Behavior | Apply allowed |
|---|---|---:|
| Gemini absent in declared local mode | Committed structured fixture; `degraded_fixture` | Only after full verification |
| Gemini live transport/schema failure | Typed fallback with reason and live flag; no fabricated live receipt | Only after full verification |
| Cortex absent in declared local mode | Bounded deterministic cover; `local_deterministic` | Only after full verification |
| Cortex configured live but unavailable | Stop at `CORTEX_UNAVAILABLE`; durable retry only | No |
| Cortex contract rejected | Stop at `CONTRACT_REJECTED` with persisted evidence | No |
| Selected policy requires unmodeled prior output state | Recompile the changed rules, record the new digest, and stop before Cortex with an explicit boundary | No |
| Mission impossible | Report uncovered obligations/counterexample | No |
| QAP rejected or invalid | Retain valid cover result and record rejection | Cover plan only after verification |
| Verifier failure | Preserve evidence and specific witness | No |
| Stale mission/version/digest | `APPLY_CONFLICT` | No |
| WebGL or motion limitation | 2D/text or reduced-motion presentation | Mission workflow unaffected |
| Image generation unavailable | Deterministic globe/timeline remain authoritative | Mission workflow unaffected |
| Hosted dependency outage | No hidden offline replay; committed replay is explicitly `offline_precomputed` | Replay cannot mutate live state |

## Test inventory

| Area | Test files | Current local result |
|---|---|---|
| Gemini and compiler | `test_agent.py`, `test_compiler.py` | Pass |
| Candidate generation and Cortex | `test_bundles.py`, `test_cortex.py` | Pass |
| Workflow, state, persistence gates | `test_workflow.py`, `test_service_gates.py`, `test_api.py` | Pass |
| Verifier and tampering | `test_verifier_counterexamples.py`, `test_runtime_boundaries.py` | Pass |
| Artifacts and replay | `test_artifacts.py` | Pass |
| Dataset transformation | `test_borg_transform.py` | Pass for fixture pipeline; extraction claim abstained |
| Frontend | `App.test.tsx`, `api.test.ts`, `Timeline.test.tsx`, `Evidence.test.tsx` | Seven tests pass, including exact public-link and plain-language evidence labels |
| Static/build | Ruff, TypeScript strict, ESLint, Vite production build | Pass |
| Supply chain | `pip-audit`, `npm audit --omit=dev` | No known published-package vulnerabilities locally |
| Container | Production build, UID, `/health/live`, `/health/ready` | Pass locally as UID 65532 |
| Cloud/IaC | Terraform fmt/validate, Trivy, gitleaks | CI configured; frozen-tree evidence pending |

Current Python result: 62 tests passing and 90.31% statement coverage.
The separate `coverage report --fail-under=90` command is the authoritative threshold gate.

## Release disposition

This inventory does not authorize publication.
The blockers in [RELEASE_AUDIT.md](RELEASE_AUDIT.md) remain authoritative, especially live Gemini, live Cortex, applied Google Cloud infrastructure, hosted admission control, anonymous demo validation, final video, immutable evidence hashes, and explicit owner approval.

> **BRAYON PIESKE** — *"Engineering earns trust when every claim is testable and every release is verified."*
