# Threat model

## Protected assets

- Gemini and HexStellar credentials;
- Cloud Run worker invocation authority;
- mission and artifact integrity;
- idempotency records and event order;
- sandbox apply authority;
- public API availability; and
- claim accuracy and provenance.

## Untrusted inputs

Operator text, telemetry fields, Pub/Sub envelopes, browser requests, idempotency keys, Cortex responses, Gemini structured output, artifact names, and downloaded replay ZIPs are untrusted until validated at their boundary.

## Primary abuse cases and controls

| Abuse case | Control | Residual risk |
|---|---|---|
| Prompt injection in operator or telemetry content | Explicit untrusted-content delimiters, schema-constrained output, no shell/URL tools, deterministic semantic compiler | A novel semantic ambiguity may still require a human clarification |
| Credential exposure | Secrets only on the private worker, Secret Manager, sanitized events, no browser serialization | Misconfigured IAM or operator logging remains an operational risk |
| Duplicate delivery or request replay | Persisted idempotency key plus request digest; Pub/Sub `event_id` deduplication | Expiration and long-term key retention need production policy review |
| Accepted Cortex job resubmission | One POST followed by the literal returned poll URL | Provider-side behavior remains outside this repository |
| Provider output promotion | Certainty preserved verbatim; verifier issues a separate assurance | Reviewers may still conflate the two unless they inspect the receipt |
| Stale verified plan apply | Optimistic concurrency plus input and plan digest gate | Firestore transaction behavior must be validated in the deployed project |
| Artifact tampering | Per-file SHA-256, deterministic ZIP, network-free verifier | The ZIP itself still requires a trusted distribution or release hash |
| Arbitrary file access | Plain filename allowlist and mission-scoped artifact directory | Object-store IAM and bucket policies must be validated after deployment |
| Public sandbox cost abuse | Request limits, bounded scenario, Cloud Tasks rate limits, instance caps, budget alerts | A complete per-client and global quota service is still a release requirement |
| WebGL denial or accessibility failure | 2D/text fallback and reduced-motion support | Cross-device manual and automated accessibility evidence remains required |

## Action boundary

Automatic mutation is restricted to the committed simulated sandbox.
`mission-patch.json` states that any external application requires human review.
No repository tool can invoke spacecraft, stations, or an external mission-control system.

## Out of scope

Physical orbital threat analysis, spacecraft command authentication, radiation effects, collision avoidance, and safety-critical certification are outside this research prototype.

> **BRAYON PIESKE** | *"Engineering earns trust when every claim is testable and every release is verified."*
