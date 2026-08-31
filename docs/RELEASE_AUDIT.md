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
| Replay artifacts | Deterministic ZIP, per-file hashes, adversarial AI prompt, exact verifier source, and network-free verification | Pass locally | Release ZIP hash not frozen yet |
| API | RFC-style errors, security headers, SSE resume, logs, timeline, artifact and apply tests | Pass locally | Load/rate-limit test pending hosted environment |
| Frontend | TypeScript strict build, lint, state transformations, plain-language proof architecture, in-page recheck, exact deployed verifier source, incident-role regressions, exact public-link tests, and a manual first-time-judge browser walkthrough | Pass locally; 14 tests | Full Playwright/axe/visual matrix is not yet committed |
| Python coverage | 67 tests; 90.38% overall; agent 100%, service 90%, verifier 92%, compiler 96%, API 87%, and Cortex 86% | Pass | Firestore adapter is the lowest-covered deployment-specific module at 65% |
| Container | A prior local run recorded a reproducible `npm ci` build, immutable image, non-root UID 65532, and liveness/readiness smoke | Recorded local pass | Docker is installed but its daemon was unavailable for this final recheck; Trivy and registry digest remain pending |
| Release inventory | Routes, public functions, schemas, components, configuration, Terraform, dependencies, claims, fallbacks, and tests | Pass as inventory | Live evidence dispositions remain blocked |

## Product audit

| Surface | Evidence | Status | Residual risk |
|---|---|---|---|
| Hero and narrative | Plain-language understand/search/check flow, visible action lock, and public Cortex documentation/CLI paths | Pass in unit/static review | Final anonymous hosted browser review pending |
| Incident transition | Automatic viewport story, replay control, manual view override, debris chase POV, impact reaction, smooth mission control return, camera focus, collision, debris, telemetry, and clarification state were browser inspected frame by frame; only SAT-07 tumbles after impact while SAT-08 remains stable and visibly isolated | Pass locally across both editions | Pub/Sub-triggered hosted capture pending |
| Recovery and diff | The checked plan replays the same threat path, camera sequence, and clock while SAT-07 executes a deterministic avoidance maneuver; the diff view presents collision and safe miss side by side, and a full replay restarts at the first approach frame | Pass locally across both editions | Orbital motion is illustrative; only the mission schedule is verifier-authoritative |
| Globe | React Three Fiber view with an Americas opening, one-context default state, automatic context rebuild, visible retry, textual fallback, and unobstructed satellite models with the rotating target ring and colored proximity halo removed | Pass in six consecutive reloads and all four browser-inspected views | Cross-device frame-rate matrix pending |
| Timeline | Derived horizon, resource rows, metrics and action inspector | Pass locally | Mobile visual regression pending |
| Evidence stream | SSE-driven event list, filters, correlation and NDJSON | Pass locally | Reconnect under real Cloud Run proxy pending |
| Evidence room | Plain-language check results, receipts, counterexamples, a fresh in-page recheck, exact deployed Python source, artifacts, replay download, and public Cortex learning paths | Pass locally in the Gemini edition browser walkthrough | Cloud Storage retrieval pending |
| Reduced motion | CSS and renderer behavior implemented | Implemented | Automated WCAG/axe result pending |
| Material clarification | Both choices alter the formal contract; the unsupported all-downlink proof stops visibly before Cortex instead of fabricating state | Pass locally | Successful demo path intentionally uses urgent-deadline priority |
| Cortex failure | Live failure stops in `CORTEX_UNAVAILABLE`; retry and a separately labeled transparent simulation are explicit user actions | Pass in API, service, and browser review | Hosted transient-failure evidence is pending |
| First-time judge path | Desktop and mobile layouts, narrower mission card, mission controls, Americas opening, globe focus, manual globe override, diff view, timeline inspector, event filters, evidence drawer, failure path, simulation path, apply gate, and creator links were exercised | Pass locally | Final anonymous hosted review remains pending |

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
| Creator contact | Brayon Pieske, HexStellar, TrustCarbon, and LinkedIn are presented as professional identity links without email, phone, sponsor claims, slogans, or third-party logos | Pass with caution | The rules prohibit third-party advertising. TrustCarbon is unrelated to the project and is explicitly labeled that way, but removing that one link before submission would eliminate the remaining interpretation risk |
| Dependency audit | `pip-audit` and `npm audit --omit=dev` pass locally | Pass locally |
| Secret and container scan | CI structure present; 106 tracked files passed a local credential-shaped-value scan | **Blocker until gitleaks/Trivy run on frozen tree** |
| Terraform | Configuration reviewed; worker internal, identities separated, probes/limits/retention/budget declared | **Blocker until Terraform is installed and fmt/validate/plan/apply pass** |

The exhaustive surface map is [RELEASE_INVENTORY.md](RELEASE_INVENTORY.md).
The local production build reports one intentional residual performance warning: the lazy Three.js globe chunk is 915.97 kB minified and 246.28 kB gzip in this audited build.
The main application chunk is 261.48 kB minified and 81.65 kB gzip.
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

> **BRAYON PIESKE** | *"Engineering earns trust when every claim is testable and every release is verified."*
