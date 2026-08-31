import {
  Activity,
  ArrowRight,
  Braces,
  CheckCircle2,
  FileArchive,
  Fingerprint,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'

interface ProofArchitectureProps {
  languageModelName: string
  executionMode?: string
  candidateSpace?: number
  candidateCount?: number
  passedRuleGroups?: number
}

const checkedConsequences = [
  ['Energy reserve', 'The simulated battery never falls below the declared safety floor.'],
  ['Storage capacity', 'Computed output is never accepted when the simulated satellite has no room for it.'],
  ['Shared time', 'A satellite or ground station is never booked for incompatible actions at the same time.'],
  ['Health contact', 'Every mandatory status check remains scheduled after the failure.'],
  ['Failed hardware', 'The new plan never quietly puts an offline station or isolated compute node back to work.'],
  ['Urgent deadline', 'The critical evaluation job finishes before the time the operator confirmed.'],
] as const

const failureBoundaries = [
  ['The language model misunderstood the request', 'Show the extracted rules, ask about material ambiguity, and require the operator to confirm the meaning. The checker cannot read the operator’s mind.'],
  ['Cortex returned a structurally bad candidate', 'Replay the complete timeline in separate Python code and block the plan with a concrete counterexample.'],
  ['A file changed after verification', 'Recompute SHA-256 fingerprints. A mismatch invalidates the evidence package.'],
  ['The mission changed before apply', 'Compare the mission version, canonical fingerprint, and verification fingerprint in one guarded update.'],
  ['The simulation differs from physical reality', 'Stop at the prototype boundary. Constellation does not claim real spacecraft safety or issue real flight commands.'],
] as const

export function ProofArchitecture({ languageModelName, executionMode, candidateSpace, candidateCount, passedRuleGroups }: ProofArchitectureProps) {
  const candidateSpaceLabel = candidateSpace
    ? `${candidateSpace.toLocaleString('en-US')} possible subsets from ${candidateCount ?? 'the'} candidate pieces, before constraints`
    : 'Compares combinations under an explicit contract'
  const liveCortexRun = executionMode === 'live'

  return <>
    <section className="judge-primer" aria-labelledby="plain-language-title">
      <div className="judge-primer-copy">
        <span>THE 20 SECOND EXPLANATION</span>
        <h3 id="plain-language-title">A translator, a planner, an inspector, and a tamper seal.</h3>
        <p>You describe the outcome in ordinary language. One component translates it into visible rules, one searches the hard combinations, one tries to reject the answer, and one locks the accepted files to their fingerprints.</p>
      </div>
      <ol className="plain-role-list">
        <li><span>01</span><div><strong>{languageModelName} is the translator</strong><p>It converts the request into a checklist you can inspect. It cannot approve a plan.</p></div></li>
        <li><span>02</span><div><strong>Cortex is the planner</strong><p>It receives a structured puzzle, not prose, and chooses schedule pieces that can fit together.</p></div></li>
        <li><span>03</span><div><strong>Python is the inspector</strong><p>Separate code replays every minute and rejects the first broken rule with a concrete example.</p></div></li>
        <li><span>04</span><div><strong>SHA-256 is the tamper seal</strong><p>Only the exact mission version and exact plan that passed may unlock the sandbox update.</p></div></li>
      </ol>
    </section>

    <div className="role-flow" aria-label="The three computational responsibilities">
      <article><span>01</span><div className="role-icon gemini-step"><Sparkles size={21} /></div><small>TRANSLATE</small><h3>{languageModelName} writes the checklist</h3><p>It extracts required work, failed resources, priorities, and missing decisions from the operator’s words.</p><strong>Does not choose or approve the schedule</strong></article>
      <ArrowRight className="role-arrow" size={19} />
      <article><span>02</span><div className="role-icon cortex-step"><Activity size={21} /></div><small>SEARCH</small><h3>Cortex compares complete choices</h3><p>It selects compatible schedule pieces while honoring required work, forbidden resources, conflicts, and declared costs.</p><strong>{candidateSpaceLabel}</strong></article>
      <ArrowRight className="role-arrow" size={19} />
      <article><span>03</span><div className="role-icon verify-step"><ShieldCheck size={21} /></div><small>TRY TO REJECT</small><h3>Python checks the entire result</h3><p>It independently recomputes coverage, timing, deadlines, energy, storage, placement cost, and fingerprints.</p><strong>{passedRuleGroups ? `${passedRuleGroups} rule groups passed in this run` : 'One broken rule means no action'}</strong></article>
    </div>

    <section className="cortex-contract" aria-labelledby="cortex-contract-title">
      <div className="cortex-contract-heading">
        <div className="cortex-contract-icon"><Activity size={22} /></div>
        <div><span>WHAT CORTEX ACTUALLY DOES</span><h3 id="cortex-contract-title">It solves a data puzzle that has too many connected choices for a convincing sentence to settle.</h3><p>Each candidate piece is already locally valid. One piece can mean: run a job on a satellite, hold its output, then send it through a compatible station during an allowed window. The difficult part is choosing a whole set without creating a conflict somewhere else.</p></div>
      </div>
      <div className="contract-flow" aria-label="Cortex input and output">
        <div className="contract-column contract-input">
          <span>STRUCTURED INPUT</span>
          <h4>The rules of the puzzle</h4>
          <ul>
            <li><strong>Must cover</strong><small>urgent work and every mandatory health contact</small></li>
            <li><strong>Must not use</strong><small>the failed station and isolated compute nodes</small></li>
            <li><strong>Cannot overlap</strong><small>the same satellite, link, or station at incompatible times</small></li>
            <li><strong>Should prefer</strong><small>fewer changes, less delay, and lower declared disruption cost</small></li>
          </ul>
        </div>
        <ArrowRight className="contract-arrow" size={22} />
        <div className="contract-column contract-output">
          <span>STRUCTURED OUTPUT</span>
          <h4>A candidate plus its receipt</h4>
          <ul>
            <li><strong>Selected IDs</strong><small>the schedule pieces Cortex chose</small></li>
            <li><strong>Coverage state</strong><small>what is covered, uncovered, or reported as a violation</small></li>
            <li><strong>Declared result</strong><small>cost fields and the assurance Cortex actually returned</small></li>
            <li><strong>Operational receipt</strong><small>request fingerprint, response fingerprint, timing, and memory when reported live</small></li>
          </ul>
        </div>
      </div>
      <div className="cortex-boundary"><TriangleAlert size={17} /><p><strong>Cortex is not an LLM and it does not control the mission.</strong> It does not interpret the operator’s sentence, invent orbital facts, certify real spacecraft safety, or update state. Constellation preserves the result and assurance exactly as returned, then sends the candidate to the independent checker.</p></div>
      <div className="cortex-proof-points">
        <article><Activity size={18} /><div><strong>Where acceleration enters</strong><p>The formal contract is submitted to HexStellar’s managed accelerated Cortex service. On a live response, Constellation shows the engine’s reported time and peak RSS exactly as returned. One live run is operational telemetry, not a speedup benchmark, so no unsupported multiplier is claimed.</p></div></article>
        <article><ShieldCheck size={18} /><div><strong>What precision means here</strong><p>Required work, conflicts, costs, forced choices, and forbidden resources are explicit data. The Cortex assurance label is never promoted, and separate Python code recomputes the mission properties before action. Precision does not mean universal optimality.</p></div></article>
      </div>
    </section>

    <section className="reality-boundary" aria-labelledby="reality-boundary-title">
      <div className="subsection-heading"><span>WHAT IS SIMULATED AND WHAT ACTUALLY RUNS</span><h3 id="reality-boundary-title">The orbital emergency is a laboratory. The computational chain is executable software.</h3><p>The globe explains the scenario. It is not the evidence and it does not manufacture the selected plan.</p></div>
      <div className="reality-grid">
        <article><span>SIMULATED DOMAIN</span><strong>The satellites, collision, stations, batteries, storage, and sandbox</strong><p>They form a deterministic research scenario. Constellation does not claim real ephemerides, flight dynamics, spacecraft control, or physical safety.</p></article>
        <article><span>EXECUTED PIPELINE</span><strong>The compiler, formal contract, planner adapter, checker, hashes, and apply lock</strong><p>In live mode the backend sends the public <code>cover</code> contract to Cortex over HTTPS, stores the sanitized response, and gives the selected IDs to separate Python code.</p></article>
      </div>
      <div className={`current-execution ${liveCortexRun ? 'is-live' : 'is-local'}`}><Activity size={18} /><div><span>CURRENT RUN LABEL</span><strong>{liveCortexRun ? 'Live Cortex execution recorded' : 'Transparent non-live execution'}</strong><p>{liveCortexRun ? 'Inspect the receipt, returned assurance, engine telemetry, request fingerprint, and response fingerprint in the Evidence Room.' : 'This run is labeled local or fallback. It demonstrates the pipeline and checker, but it is not presented as evidence of a live Cortex call.'}</p></div></div>
      <p className="independence-note"><ShieldCheck size={16} /><span><strong>“Independent” has a precise scope:</strong> the checker does not import the HexStellar client, does not call Cortex, and cannot change the candidate. It is project-authored software that judges can inspect, not a third-party certification.</span></p>
    </section>

    <section className="why-model-boundary" aria-labelledby="why-model-title">
      <div className="subsection-heading"><span>WHY NOT LET THE LANGUAGE MODEL DO EVERYTHING?</span><h3 id="why-model-title">A plausible plan and a checked plan are different products.</h3></div>
      <div className="reason-grid">
        <article><Sparkles size={19} /><strong>Language models generate likely answers</strong><p>A schedule can read perfectly while hiding one double booking, one late job, or one use of failed hardware.</p></article>
        <article><Braces size={19} /><strong>The choices affect one another</strong><p>Moving one downlink changes station time, satellite storage, energy, later contacts, and possibly another job’s deadline.</p></article>
        <article><ShieldCheck size={19} /><strong>Confidence is not a mechanical check</strong><p>Asking the same model to review its own answer is not independent evidence. The checker has no authority to make a bad plan look good.</p></article>
      </div>
    </section>

    <section className="consequence-section" aria-labelledby="consequence-title">
      <div className="subsection-heading"><span>TRANSLATE RULES INTO CONSEQUENCES</span><h3 id="consequence-title">What “every rule passed” means in ordinary language.</h3></div>
      <div className="consequence-grid">
        {checkedConsequences.map(([name, meaning]) => <article key={name}><CheckCircle2 size={17} /><div><strong>{name}</strong><p>{meaning}</p></div></article>)}
      </div>
    </section>

    <section className="failure-boundaries" aria-labelledby="failure-boundaries-title">
      <div className="subsection-heading"><span>WHERE EACH FAILURE STOPS</span><h3 id="failure-boundaries-title">The system does not pretend one checker can catch everything.</h3><p>Meaning, computation, verification, tampering, and real-world validity are different risks. Each needs its own boundary.</p></div>
      <div className="boundary-list">
        {failureBoundaries.map(([failure, response], index) => <div key={failure}><span>{String(index + 1).padStart(2, '0')}</span><strong>{failure}</strong><p>{response}</p></div>)}
      </div>
    </section>

    <section className="custody-section" aria-labelledby="custody-title">
      <div className="subsection-heading"><span>CHAIN OF CUSTODY</span><h3 id="custody-title">Follow one decision from the operator’s sentence to the downloadable ZIP.</h3></div>
      <ol className="custody-flow">
        <li><Sparkles size={18} /><span>01</span><strong>Request captured</strong><p>The original instruction and clarification are retained.</p></li>
        <li><Braces size={18} /><span>02</span><strong>Meaning frozen</strong><p>Canonical JSON receives a SHA-256 fingerprint.</p></li>
        <li><Activity size={18} /><span>03</span><strong>Search recorded</strong><p>Sanitized contracts, results, assurance, and receipts are preserved.</p></li>
        <li><ShieldCheck size={18} /><span>04</span><strong>Plan replayed</strong><p>Python produces passes or a specific counterexample.</p></li>
        <li><LockKeyhole size={18} /><span>05</span><strong>Apply guarded</strong><p>Version and fingerprints must still match atomically.</p></li>
        <li><FileArchive size={18} /><span>06</span><strong>Evidence exported</strong><p>The ZIP contains checksums and an AI review guide.</p></li>
      </ol>
      <div className="offline-proof-note"><Fingerprint size={18} /><p><strong>What offline replay proves:</strong> a judge can recheck the frozen input, selected plan, and verifier result without trusting this screen or calling an external service. It does not rerun {languageModelName} or Cortex, so it does not claim those services are deterministic.</p><a href="#evidence">Inspect the original files <ArrowRight size={14} /></a></div>
    </section>

    <section className="transfer-section" aria-labelledby="transfer-title">
      <div className="subsection-heading"><span>WHY THIS PATTERN MATTERS BEYOND ORBIT</span><h3 id="transfer-title">The same separation is useful whenever mistakes are expensive and rules can be encoded.</h3><p>These are adaptation examples, not capabilities claimed by this satellite demonstration. Every new field needs its own formal model, data, safety policy, and independent checker.</p></div>
      <div className="transfer-grid">
        <article><strong>Logistics recovery</strong><p>Translate an operational goal, search vehicle and time-window combinations, then check capacity, duty, and delivery rules.</p></article>
        <article><strong>Compute infrastructure</strong><p>Translate service priorities, search workload placements, then check memory, network, energy, replica, and deadline limits.</p></article>
        <article><strong>Infrastructure maintenance</strong><p>Translate restoration priorities, search crews and outage windows, then check dependencies, access, and mandatory coverage.</p></article>
      </div>
    </section>

    <div className="verification-rule"><LockKeyhole size={22} /><div><span>THE SIMPLE RULE</span><p>The sandbox key fits only the exact plan fingerprint the independent checker passed. Change the meaning, plan, evidence, or mission version, and the key no longer fits.</p></div></div>
  </>
}
