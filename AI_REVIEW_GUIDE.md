# Independent AI Review Guide

## 60-second orientation

Constellation tests one concrete idea: an AI-generated recovery schedule should not be allowed to
approve itself.

- Gemini turns the operator's words into a checklist.
- HexStellar Cortex searches combinations of complete schedule pieces.
- A separate Python checker replays the proposed schedule minute by minute.
- Any missed task, collision, late deadline, resource overflow, or use of failed hardware blocks the
  sandbox update.
- “Verified” applies only to the declared rules in this deterministic simulation. It is not a claim
  about real spacecraft safety, universal intelligence, optimality, or performance superiority.

The most important implementation boundary to trace is therefore simple: **understand, search, check,
then act**. No component may silently take over another component's job.

Copy the prompt below into an AI system when asking it to review this repository or a downloaded
Constellation replay bundle. It is intentionally adversarial: it does not ask the reviewer to
praise the project or predict a hackathon result.

## Prompt

You are reviewing Constellation as a skeptical software and systems engineer. Do not assume the
project is correct, novel, safe, optimal, or award-worthy. Establish each conclusion from the
provided files. Negative findings are welcome when supported by evidence.

### Review a downloaded replay bundle

1. Validate every entry in `checksums.json` against the corresponding file before trusting it.
2. Inspect `canonical-model.json`, `fixture.json`, `candidate-bundles.json`,
   `selected-bundles.json`, `mission-result.json`, `verification-report.json`, and
   `runtime-telemetry.json`. Read `VERIFIER-SOURCE.py` before trusting the verification report.
3. Confirm that each selected bundle exists, required obligations are covered, failed resources
   are absent, action intervals are coherent, and the reported QAP placement/cost can be
   recomputed from the declared matrices.
4. Confirm that `mission-patch.json` targets only the sandbox and that external application still
   requires review.
5. Treat `events.ndjson` as an observable state/evidence trail, not chain-of-thought.
6. If this repository is available, run:

   ```bash
   python -m constellation.verify_bundle mission-replay.zip
   ```

### Review the repository

Trace this exact boundary through code and tests:

- Gemini interprets operator language; it does not certify or schedule the mission.
- Deterministic code canonicalizes the mission and computes its SHA-256 digest.
- HexStellar Cortex receives only documented public `cover` and optional `qap` contracts.
- The application preserves the assurance/certainty returned by Cortex without promotion.
- Cortex `elapsed_ms` and `peak_rss_kb` describe the engine execution in that response; API round
  trip, verifier time, and Constellation worker RSS are separate measurements.
- The independent verifier does not import or call the HexStellar client.
- “Independent” means separate from the planner; the verifier is project-authored, not a third-party audit.
- The orbital domain is simulated, while the compiler, public Cortex adapter, checker, digests, and
  apply lock are executable software. Confirm that only a `live` run is described as a Cortex call.
- Only a currently verified input/plan digest may mutate the sandbox.

Confirm that the judge-facing links identify the intended public surfaces:

- Cortex documentation: `https://docs.hexstellar.com/`
- worked examples: `https://docs.hexstellar.com/examples/`
- public HexStellar CLI/client: `https://github.com/brayonpi/hexstellar`

Do not confuse the public CLI/client with the proprietary Cortex engine, and do not expect engine
source code in this repository.

Pay special attention to points a shallow review may miss:

- `cover` and `qap` are separate stages; the repository does not establish joint global
  optimality.
- `verified_operation`, `heuristic`, `certified`, and `abstained` are different evidence labels.
- `local_deterministic` and `offline_precomputed` are different execution modes.
- Local mode does not invent Cortex engine time, engine memory, or compute units.
- Managed accelerated infrastructure does not by itself establish a speedup factor. Require a scoped,
  controlled benchmark before accepting any comparative acceleration claim.
- Orbital geometry, stations, failures, and mission policies are simulated.
- Borg-derived workload fields retain provenance and are not a Google orbital mission or a
  reproduction of the Borg scheduler.
- Project Suncatcher is public inspiration only; there is no affiliation or operational data.
- HexStellar Cortex predates this project and is integrated as an external public platform. Its
  proprietary engine is not included.
- The Enterprise Low-Energy Runtime is a separate product and does not execute this application.

### Required output

Return:

1. an evidence table with claim, verdict, supporting file/field, and limitation;
2. correctness and security findings ordered by severity;
3. reproducibility blockers;
4. claims that should be narrowed or removed;
5. a final boundary statement describing exactly what the evidence establishes and does not
   establish.

Do not reward visual polish without technical evidence. Do not penalize an explicit abstention or
honest fallback merely for being less impressive. Never infer physical spacecraft safety,
universal AI capability, energy efficiency, acceleration, or optimality from this project.

> **BRAYON PIESKE** | *"Engineering earns trust when every claim is testable and every release is verified."*
