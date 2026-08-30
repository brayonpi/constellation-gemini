"""Stable reviewer prompt shipped in every replay bundle."""

AI_REVIEW_PROMPT = """# Independent AI Review Prompt

You are reviewing Constellation as a skeptical software and systems engineer. Do not assume the
project is correct, novel, safe, optimal, or award-worthy. Establish each conclusion from the
provided files. Negative findings are welcome when supported by evidence.

## Review the downloaded replay bundle

1. Validate every entry in `checksums.json` against the corresponding file before trusting it.
2. Inspect `canonical-model.json`, `fixture.json`, `candidate-bundles.json`,
   `selected-bundles.json`, `mission-result.json`, and `verification-report.json`.
3. Confirm that each selected bundle exists, required obligations are covered, failed resources
   are absent, action intervals are coherent, and the reported QAP placement/cost can be
   recomputed from the declared matrices.
4. Confirm that `mission-patch.json` targets only the sandbox and that external application still
   requires review.
5. Treat `events.ndjson` as an observable state/evidence trail, not chain-of-thought.
6. If the repository is also available, run:
   `python -m constellation.verify_bundle mission-replay.zip`

## Review the repository

Trace this exact boundary through code and tests:

- Gemini interprets operator language; it does not certify or schedule the mission.
- Deterministic code canonicalizes the mission and computes its SHA-256 digest.
- HexStellar Cortex receives only documented public `cover` and optional `qap` contracts.
- The application must preserve the assurance/certainty returned by Cortex without promotion.
- The independent verifier must not import or call the HexStellar client.
- Only a currently verified input/plan digest may mutate the sandbox.

Pay special attention to points a shallow review may miss:

- `cover` and `qap` are separate stages; the repository does not establish joint global
  optimality.
- `verified_operation`, `heuristic`, `certified`, and `abstained` are different evidence labels.
- `local_deterministic` and `offline_precomputed` are different execution modes.
- Orbital geometry, stations, failures, and mission policies are simulated.
- Any Borg-derived workload fields must retain provenance and must not be described as a Google
  orbital mission or as reproducing the Borg scheduler.
- Project Suncatcher is public inspiration only; there is no affiliation or operational data.
- HexStellar Cortex predates this project and is integrated as an external public platform. The
  proprietary engine is not included.
- The Enterprise Low-Energy Runtime is a separate product and does not execute this application.

## Required output

Return:

1. an evidence table with claim, verdict, supporting file/field, and limitation;
2. correctness and security findings ordered by severity;
3. reproducibility blockers;
4. claims that should be narrowed or removed;
5. a final boundary statement describing exactly what the evidence establishes and what it does
   not establish.

Do not reward visual polish without technical evidence. Do not penalize an explicit abstention or
honest fallback merely for being less impressive. Never infer physical spacecraft safety,
universal AI capability, energy efficiency, acceleration, or optimality from this bundle.
"""
