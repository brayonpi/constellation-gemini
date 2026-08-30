# Constellation in 60 seconds

Constellation shows how an AI system can recover a simulated orbital compute mission without asking
the same system to trust its own answer.

The problem is easy to picture: one ground station stops working, two orbital computers become
unavailable, and an urgent job arrives. A replacement schedule may look reasonable while still
double-booking a station, using failed hardware, missing a health check, or finishing the urgent job
too late.

Constellation gives three separate systems three separate jobs:

1. **Gemini understands the request.** It turns plain language into a checklist and asks one question
   when the answer would change which plan wins.
2. **HexStellar Cortex searches the combinations.** It compares complete recovery plans under the
   frozen checklist.
3. **An independent Python checker tries to reject the result.** It replays the schedule minute by
   minute. One failed rule keeps the sandbox locked.

The simple rule is: **no system grades its own homework.**

## What to click

1. Select **Run the failure recovery**.
2. Watch the ground-station failure and isolated compute nodes appear.
3. Choose whether the urgent job or every lower-priority download matters more. This is a real choice:
   it changes the frozen rules and priority order. The successful golden path protects the urgent job.
   The alternative path stops before Cortex because the fixture does not record enough state to prove
   that every previously computed lower-priority output is available. That abstention is intentional,
   visible, and tested; the application does not invent missing data to make the second option pass.
4. Watch the live run log move through understanding, search, and independent checking.
5. Switch between **Before failure**, **Failure**, **New plan**, and **What changed**.
6. Open the Evidence Room. Download the log, individual files, or full replay ZIP.
7. Select **Use the checked plan in this sandbox** only after every rule passes.

## What makes the result inspectable

- The request and simulated scenario each have a SHA-256 fingerprint.
- The Cortex request, response, certainty label, and operational timing are recorded.
- The checker is separate from Cortex and does not import its client.
- A failure includes a specific example, such as the overlapping reservation or missed obligation.
- The replay ZIP contains checksums and can be checked without any external service.
- The sandbox update is tied to the exact input and plan fingerprints that passed.

Run an offline replay with:

```bash
python -m constellation.verify_bundle artifacts/mission-replay.zip
```

## Learn about HexStellar Cortex

- [Read how Cortex works](https://docs.hexstellar.com/).
- [Open the worked examples](https://docs.hexstellar.com/examples/).
- [Inspect the public HexStellar CLI/client](https://github.com/brayonpi/hexstellar).

The public repository is the supported client boundary. The proprietary Cortex engine is a separate,
pre-existing HexStellar platform and is not included in Constellation.

## What “verified” does and does not mean

In this project, verified means that the committed Python checker passed the declared software rules
for this exact deterministic simulation and plan.

It does **not** mean that Constellation controls real satellites, proves physical spacecraft safety,
understands every possible mission, establishes joint global optimality, or demonstrates a universal
speed or energy advantage. The orbital geometry, stations, failures, and mission rules are simulated.
Google and Project Suncatcher are public inspiration only; there is no affiliation or operational data.

For a deeper adversarial review, use [AI_REVIEW_GUIDE.md](../AI_REVIEW_GUIDE.md). The same review prompt
is included inside every replay ZIP so a judge can give the downloaded files to another AI without
losing the project's trust boundaries or claim limits.

> **BRAYON PIESKE** — *"Engineering earns trust when every claim is testable and every release is verified."*
