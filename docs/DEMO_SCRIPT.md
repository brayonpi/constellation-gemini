# Four-minute demo script

## 0:00 to 0:25: The friction

Show the network before the failure.

> An AI can write a schedule that sounds right and still use a dead computer, double-book a station,
> or finish an urgent job too late. Constellation refuses to act until a separate program checks every
> minute of the proposed recovery.

## 0:25 to 0:50: Autonomous event

Publish the committed compound failure through Pub/Sub.
Show the Pub/Sub message ID and private Cloud Run worker log correlation ID.

> One station is down. Two orbital computers are isolated. An urgent job just arrived. Nobody clicked
> a hidden “solve” button: the real event started the recovery.

## 0:50 to 1:20: Gemini and the material clarification

Show the real `gemini-3.5-flash` model record, extracted rules, and request fingerprint.
Answer the single priority question.
Show that the state machine resumes without further guidance.

> Gemini's job is understanding, not approval. This question matters because the answer changes which
> recovery plan wins. We freeze the confirmed meaning into a fingerprint before searching.

## 1:20 to 2:00: Combinatorial search

Show the number of candidate schedule pieces and combination space.
Open the integer-indexed `cover` contract, then the returned Cortex receipt and unchanged certainty.
Show the optional QAP compute placement and independently recomputed cost.

> Cortex compares complete combinations under the frozen rules. It is searching the formal scheduling
> problem, not writing a persuasive paragraph. This timing is telemetry for this run, not a benchmark.

## 2:00 to 2:40: Adversarial replay

Show all independent checker categories passing.
Load an overlapping contact and show the exact two reservations that collide.

> Now a separate Python program tries to reject the plan. It catches this overlap and keeps the action
> locked. The valid plan passes every declared software rule. That is the full claim: it does not prove
> physical spacecraft safety or global optimality.

## 2:40 to 3:10: Action

Apply the verified plan to the sandbox.
Show the Before failure, New plan, and What changed views, mission patch, Firestore state, and replay ZIP.

> Only the exact checked fingerprint can update this sandbox. A judge can download the inputs, receipts,
> log, checksums, and checker result, then rerun the check without Gemini or Cortex.

## 3:10 to 3:40: Architecture

Show `docs/architecture.svg` and identify Gemini, ADK, Pub/Sub, Cloud Tasks, Cloud Run, Firestore, Cortex, and the verifier trust boundary.

Open the public Cortex documentation button and briefly show the public HexStellar CLI/client link.

> Three jobs, three boundaries: understand, search, check. No system grades its own homework.

## 3:40 to 4:00: Proof and brand

Show the public `.run.app` URL, Cloud Run revision, Vertex model ID, and the exact submitted Git commit.

> Constellation. Say the mission. Prove the plan.

> **BRAYON PIESKE** | *"Engineering earns trust when every claim is testable and every release is verified."*
