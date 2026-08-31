# Claims and limitations

## Plain-English boundary

Constellation establishes one narrow result: **this exact simulated recovery schedule passed the
software rules implemented by the independent checker for this exact fingerprinted input**.

It does not establish that a real satellite is safe, that every possible plan was examined, that the
operator's language is universally understood, or that one system is universally faster or more
efficient than another. “Verified” is a concrete software result, not a general seal of truth.

## What the committed evidence can establish

For the committed deterministic simulation, Constellation can establish that:

- operator language was compiled into the recorded formal mission model;
- the recorded canonical model has the displayed SHA-256 digest;
- selected bundles cover the recorded obligations without the counterexamples implemented by the independent verifier;
- reported QAP cost and permutation properties can be recomputed from the recorded matrices;
- the exact verified input and plan digest gated the recorded sandbox mutation; and
- the replay ZIP files match `checksums.json` at the time of independent review.

Each statement is conditional on the reviewed code, fixture, artifacts, and digest.
None is a universal capability claim.

## Simulation and execution boundary

The orbital fleet, collision, contact windows, failures, and sandbox are a deterministic simulation.
The compiler, Cortex adapter, verifier, digests, artifact builder, and apply gate are executable software.
When the run is labeled `live`, the backend submits the public formal contract to the external HexStellar
Cortex HTTPS service and preserves the sanitized response, returned assurance, and operational receipt.
When the run is labeled local or fallback, the interface does not present it as a live Cortex result.

Cortex executes supported formal contracts on HexStellar managed accelerated infrastructure.
No speedup factor is inferred from that architecture or from one response.
In this project, precision means explicit obligations, conflicts, costs, forced and forbidden choices,
unaltered assurance, stable fingerprints, and independent recomputation before action.
It does not mean universal optimality or real-world spacecraft accuracy.

## In-page and offline recheck boundary

The website button runs the Python verifier again against the frozen mission state.
The exact deployed source is viewable and downloadable from the same panel and is included in a fresh
replay ZIP as `VERIFIER-SOURCE.py`.
The checker does not import the HexStellar client, call Cortex, call Gemini, or repair a candidate.

“Independent” means computationally separate from the planner.
The verifier is project-authored and inspectable; it is not a third-party certification or proof that
unimplemented physical rules are true.

## What the project does not establish

Constellation does not establish:

- physical spacecraft safety or orbital fidelity;
- control of a satellite, station, Google system, or external production environment;
- universal language understanding or correct compilation of arbitrary missions;
- joint global optimality across the decomposed `cover` and `qap` stages;
- a performance, energy, or acceleration advantage over Gemini, Google, another solver, or a baseline;
- reproduction of the Borg scheduler;
- Project Suncatcher operational behavior, data, sponsorship, affiliation, or endorsement; or
- any property of the separate HexStellar Enterprise Low-Energy Runtime.

## Data boundary

The current committed workload fixture is `fixture_only` and trace-shaped.
It must not be described as Borg-derived until a reproducible extraction, row counts, transformation manifest, attribution, and source/derived hashes are committed and revalidated.

Orbital geometry, contact windows, stations, resource budgets, failures, policies, and objectives are simulated.
Public Project Suncatcher parameters are inspiration, not operational inputs.

## Computational evidence labels

- `certified` applies only to the exact property or bound declared by the originating response or identified checker.
- `verified_operation` means the recorded operation was recomputed for the declared contract; it does not imply optimality.
- `heuristic` means a candidate is reported without a proof of optimality or convergence.
- `abstained` means the contract or evidence was insufficient for the claimed property.
- `local_deterministic` is an explicitly selected local mode.
- `offline_precomputed` is reserved for a committed contingency replay.
- `degraded_fixture` identifies an interpretation fixture and persists the fallback reason.

The application preserves the provider's certainty string and never promotes it.

If a configured live Cortex request fails, the failure remains visible as `CORTEX_UNAVAILABLE`.
The user may retry live execution or explicitly select the deterministic simulator.
That simulation is labeled `local_deterministic`, does not manufacture Cortex metrics, and cannot
mutate the sandbox until the independent verifier passes.

Cortex is not represented as an LLM.
It is the structured computational platform that receives the formal contract in this project.
The application does not expose proprietary engine internals and does not infer a universal speed or
optimality claim from one execution.

## Generated imagery

The README cover and subtle hero texture use an original generated orbital background.
They are editorial illustration only.
The data-driven globe, timeline, contracts, receipts, checksums, verifier report, and replay artifacts are the technical evidence.

> **BRAYON PIESKE** | *"Engineering earns trust when every claim is testable and every release is verified."*
