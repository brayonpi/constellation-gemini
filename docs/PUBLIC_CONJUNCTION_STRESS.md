# Public-conjunction stress scenario

## Decision

The strongest honest heavy-mode extension is a **response-planning stress test seeded by public
predicted close approaches**.
It must not be presented as a replacement for operational conjunction screening, orbit
propagation, collision-probability estimation, or maneuver authorization.

CelesTrak SOCRATES Plus publishes predicted close approaches derived from public GP data.
Its result fields include the two catalog objects, time of closest approach, minimum range,
relative speed, and maximum probability:
<https://celestrak.org/SOCRATES/socrates-format.php>.
The bounded source query is the top 250 records by maximum probability:
<https://celestrak.org/SOCRATES/table-socrates.php?MAX=250&NAME=,&ORDER=MAXPROB>.

NASA CARA describes the operational distinction clearly: screening predicts conjunction events,
and higher-fidelity data products can include states and covariances at time of closest approach.
Constellation starts **after** that screening step:
<https://www.nasa.gov/cara/step-1-conjunction-event-prediction/>.

## What Constellation would solve

For each imported alert, deterministic domain code would create simulated response bundles such
as observation, compute, crosslink, ground contact, and review reservations.
Each bundle would carry:

- alert obligations covered;
- simulated spacecraft and ground resources used;
- response and review intervals;
- energy and storage trajectories;
- mutual conflicts;
- disruption and delay cost;
- the public alert identifier and source digest.

Gemini would compile the operator's policy and ask one material priority question.
Cortex `cover` would select compatible bundles.
The independent verifier would then recompute alert coverage, duplicate responses, time/resource
conflicts, energy, storage, source hashes, reported objective, and assurance labels.
Only a verified simulation patch could update the sandbox.

The UI may show the raw subset-space label `2^N`, where `N` is the number of candidate bundles.
That label describes the unconstrained set of possible subsets; it must never imply that Cortex
enumerated every subset or certified global optimality.

## Experiment contract

### Wall

The committed golden mission is deep enough to demonstrate proof-carrying action but too small to
demonstrate a large response portfolio.

### Hypothesis

Risk-prioritized candidate bundling plus Cortex `cover` will produce a verified response portfolio
with fewer missed high-priority obligations or lower disruption than the committed baselines on the
same frozen source snapshot.

### Incumbent and controls

- Incumbent: earliest-time-of-closest-approach greedy selection.
- Random control: seed-fixed random selection from locally valid bundles.
- Contender: the same candidate bundles submitted to Cortex `cover`.
- Bounded verifier: independent original-domain replay; it does not import the HexStellar client.

### Invariants

- Every displayed source record traces to the frozen query response and SHA-256.
- No resource or time conflict is hidden.
- The response's certainty is preserved exactly.
- A heuristic result is never renamed optimal.
- Local mode never fabricates live Cortex engine metrics or a large solve.
- Public close-approach predictions are not described as confirmed collisions.

### Promotion gate

The public `Run conjunction stress test` button may be enabled only when all of the following pass:

1. the fixed allowlisted CelesTrak query is cached according to its usage policy;
2. the source timestamp, query, transformation version, row count, and SHA-256 are persisted;
3. a legal/redistribution review approves the committed derived fixture;
4. the hosted worker has live Cortex credentials and a bounded compute-unit ceiling;
5. duplicate clicks reuse one idempotent run;
6. greedy, random, and Cortex candidates are checked by the same verifier;
7. the replay bundle includes the frozen public inputs and runtime metrics;
8. the feature survives the impossible, unavailable, and tampered-result tests.

Until that gate passes, Constellation must not display a theatrical heavy-solve button.
The golden mission remains the reliable release path.

## Falsification criteria

The mechanism is rejected or kept out of the demo if Cortex's candidate fails independent replay,
does not improve the declared metric over both controls, requires an unbounded source fetch, cannot
be reproduced from the frozen snapshot, or relies on knowing the desired answer in advance.

> **BRAYON PIESKE** | *"Scale becomes evidence only when the input, comparison, and failure conditions are frozen before the result."*
