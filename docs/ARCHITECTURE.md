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
  -> awaiting_clarification -> ready
  -> planning -> verifying
  -> verified -> applied
              \-> rejected
  -> impossible
  -> failed
```

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
