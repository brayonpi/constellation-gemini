# Release audit

Audit date: 2026-08-30.

Official submission deadline: **2026-08-31 17:00 PDT (America/Los_Angeles)**.
The [official Devpost rules](https://allthingsagentichackathon.devpost.com/rules) were reopened during this audit.

Disposition: **not releasable yet**.
The repository must remain private until the owner explicitly approves publication after all blocking live-cloud evidence is attached.

## Code audit

| Subsystem | Evidence | Status | Residual risk |
|---|---|---|---|
| Formal compiler | Equivalent-paraphrase and semantic-drift tests | Pass | Golden scenario, not arbitrary mission compilation |
| Gemini adapter | Schema, low-to-medium escalation, typed transport fallback, hidden-thought configuration tests | Pass locally | Real Gemini 3.5 interaction and usage metadata not yet captured |
| Cortex adapter | Analyze-before-solve, tag/description, exact poll URL, Retry-After, typed failures, certainty tests | Pass locally | Public live `cover` receipt not yet captured in this release audit |
| Mission state machine | Typed states, append-only events, versioning, idempotency, stale-digest apply test, durable retry requeue | Pass locally | Firestore concurrency needs deployed evidence |
| Independent verifier | Coverage, temporal, resource, quarantine, deadline, QAP, receipt and tamper tests | Pass | Establishes only implemented simulation-domain properties |
| Replay artifacts | Deterministic ZIP, per-file hashes, adversarial AI prompt, network-free verification | Pass locally | Release ZIP hash not frozen yet |
| API | RFC-style errors, security headers, SSE resume, logs, timeline, artifact and apply tests | Pass locally | Load/rate-limit test pending hosted environment |
| Frontend | TypeScript strict build, lint, state transformations, timeline/evidence interactions, and exact public-link tests | Pass locally | Full Playwright/axe/visual matrix is not yet committed |
| Python coverage | 62 tests; 90.31% overall; agent 100%, service 90.69%, verifier 91.67%, compiler 96.30%, API 86.92%, Cortex 86.23% | Pass | Firestore adapter is the lowest-covered deployment-specific module |
| Container | Reproducible `npm ci` build, immutable local image, non-root UID 65532, liveness/readiness smoke | Pass locally | Trivy scan and registry digest pending |
| Release inventory | Routes, public functions, schemas, components, configuration, Terraform, dependencies, claims, fallbacks, and tests | Pass as inventory | Live evidence dispositions remain blocked |

## Product audit

| Surface | Evidence | Status | Residual risk |
|---|---|---|---|
| Hero and narrative | Plain-language understand/search/check flow, visible action lock, and public Cortex documentation/CLI paths | Pass in unit/static review | Final anonymous hosted browser review pending |
| Incident transition | Browser-inspected telemetry and clarification state | Pass locally | Pub/Sub-triggered hosted capture pending |
| Recovery and diff | Browser-inspected verified and applied states | Pass locally | Live Cortex/Gemini labels pending |
| Globe | React Three Fiber view plus textual/WebGL fallback | Pass locally | Cross-device frame-rate matrix pending |
| Timeline | Derived horizon, resource rows, metrics and action inspector | Pass locally | Mobile visual regression pending |
| Evidence stream | SSE-driven event list, filters, correlation and NDJSON | Pass locally | Reconnect under real Cloud Run proxy pending |
| Evidence room | Plain-language check results, receipts, counterexamples, artifacts, replay download, and public Cortex learning paths | Pass locally | Cloud Storage retrieval pending |
| Reduced motion | CSS and renderer behavior implemented | Implemented | Automated WCAG/axe result pending |
| Material clarification | Both choices alter the formal contract; the unsupported all-downlink proof stops visibly before Cortex instead of fabricating state | Pass locally | Successful demo path intentionally uses urgent-deadline priority |

## Submission audit

| Requirement | Status | Release disposition |
|---|---|---|
| Repository access | Private by owner decision; rules permit private code if both named judging addresses receive access | **Owner policy still blocks public release until explicit approval** |
| Cloud Run public URL | Not deployed from this environment | **Blocker** |
| Private worker and distinct service accounts | Terraform prepared | **Blocker until applied and inspected** |
| Pub/Sub initiates live run | Code and Terraform prepared | **Blocker until captured** |
| Cloud Task created and resumes worker | Code and local contract tests pass | **Blocker until captured** |
| Firestore transitions | Adapter implemented | **Blocker until captured** |
| Cloud Storage artifacts | Adapter implemented and bucket provisioned in Terraform | **Blocker until captured** |
| Gemini 3.5 Flash live | Adapter implemented | **Blocker until model interaction is captured** |
| Cortex `cover` live | Adapter implemented | **Blocker until sanitized receipt is captured** |
| Independent verifier and sandbox apply | Local E2E passed | Pass locally |
| Impossible mission does not apply | Automated test passes | Pass |
| Four-minute English video | Script prepared | **Blocker until recorded and reviewed** |
| Devpost links and anonymous access | Not available yet | **Blocker** |
| Borg-derived claim | Not enabled; fixture is explicitly synthetic | Pass by abstention |
| Dependency audit | `pip-audit` and `npm audit --omit=dev` pass locally | Pass locally |
| Secret and container scan | CI structure present; local pattern scan found no tracked credential candidate | **Blocker until gitleaks/Trivy run on frozen tree** |
| Terraform | Configuration reviewed; worker internal, identities separated, probes/limits/retention/budget declared | **Blocker until fmt/validate/plan/apply** |

The exhaustive surface map is [RELEASE_INVENTORY.md](RELEASE_INVENTORY.md).
The local production build reports one intentional residual performance warning: the lazy Three.js globe chunk is approximately 866 kB minified and 233 kB gzip.
The main application chunk is approximately 233 kB minified and 74 kB gzip.
Python tests also report a Starlette TestClient deprecation warning involving the future `httpx2` migration; it does not affect the deployed runtime but is retained as a tooling follow-up.

## Final release gate

Before publication:

1. authenticate `gcloud` interactively on the owner's machine;
2. select the isolated billing-enabled project and confirm the budget guardrail;
3. apply Terraform and record the plan/apply output;
4. add the Cortex key directly to Secret Manager without placing it in chat or shell history;
5. deploy an immutable container digest;
6. execute and capture one live golden mission and one impossible mission;
7. download and independently replay the final bundle;
8. run the full CI, secret, container, Terraform, accessibility, quota/load, and anonymous-browser gates;
9. freeze the release commit and evidence hashes; and
10. obtain explicit owner approval before changing GitHub visibility.

> **BRAYON PIESKE** — *"Engineering earns trust when every claim is testable and every release is verified."*
