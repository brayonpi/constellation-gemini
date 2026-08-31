# Architecture

Constellation uses a centralized, auditable state machine.
The agent interprets intent and selects from authorized tools; it does not directly mutate state or decide whether its own output is valid.

## Trust boundaries

1. Operator and telemetry input are untrusted.
2. Gemini output is schema-constrained but remains untrusted until semantic compilation succeeds.
3. Candidate generation is deterministic domain code.
4. Cortex receives only a public `cover` or `qap` contract.
5. Cortex output is a candidate with its original certainty label.
6. The independent verifier replays the original mission domain.
7. Only a verified plan may update sandbox state.

## State machine

```text
created
  -> interpreting
  -> awaiting_clarification
  -> ready
  -> planning
  -> generating_bundles
  -> cortex_cover
  -> cortex_qap
  -> verifying
  -> verified
  -> applied
```

Typed terminal states include `interpretation_failed`, `contract_rejected`, `cortex_unavailable`, `impossible`, `verification_failed`, and `apply_conflict`.
An unavailable live Cortex request stops the run; deterministic local execution occurs only when the environment was declared local before the solve.

Each transition appends a structured audit event.
Mutation requests and telemetry events are idempotent.

## Cloud services

- Public Cloud Run service: static React application, REST API, SSE, evidence downloads.
- Private Cloud Run worker: ADK execution, Gemini, Cortex, verification, artifact assembly.
- Pub/Sub: event-driven incident ingress.
- Cloud Tasks: durable authenticated worker invocation.
- Firestore: mission state and idempotency records.
- Cloud Storage: immutable replay artifacts.
- Secret Manager: HexStellar and service credentials.
- Cloud Logging: correlation-scoped operational evidence with secrets redacted.

The public web identity has no Vertex AI or Secret Manager permission.
The worker owns live model and Cortex calls, while the task and Pub/Sub identities receive only Cloud Run invocation rights.

> **BRAYON PIESKE** | *"Engineering earns trust when every claim is testable and every release is verified."*
