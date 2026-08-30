import { useEffect, useState } from 'react'
import { Activity, ArrowRight, Braces, ChevronRight, CircleDot, Command, Radio, RotateCcw, Satellite, ShieldCheck, Sparkles } from 'lucide-react'
import { api } from './api'
import { DecisionTrace } from './components/DecisionTrace'
import { EvidenceRoom } from './components/EvidenceRoom'
import { OrbitalGlobe } from './components/OrbitalGlobe'
import { Timeline } from './components/Timeline'
import type { Mission } from './types'

const DEFAULT_INTENT = 'Preserve every health contact. Complete the urgent model-evaluation workload before the deadline. Avoid dropping previously accepted critical jobs and minimize schedule disruption.'

type View = 'nominal' | 'incident' | 'recovered' | 'diff'

export default function App() {
  const [mission, setMission] = useState<Mission>()
  const [health, setHealth] = useState<{ mode: string; gemini_live: boolean; cortex_live: boolean }>()
  const [intent, setIntent] = useState(DEFAULT_INTENT)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [view, setView] = useState<View>('nominal')

  useEffect(() => { api.health().then(setHealth).catch(() => setHealth({ mode: 'local', gemini_live: false, cortex_live: false })) }, [])

  const run = async <T,>(operation: () => Promise<T>, apply: (result: T) => void) => {
    setBusy(true); setError(undefined)
    try { apply(await operation()) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unknown error') } finally { setBusy(false) }
  }

  const launch = () => run(async () => {
    const created = await api.create()
    const withEvent = await api.event(created.id)
    return api.intent(withEvent.id, intent)
  }, (result) => { setMission(result); setView('incident') })

  const clarifyAndPlan = () => mission && run(async () => {
    const clarified = await api.clarify(mission.id)
    return api.plan(clarified.id)
  }, (result) => { setMission(result); setView(result.status === 'verified' ? 'recovered' : 'incident') })

  const applyPlan = () => mission && run(() => api.apply(mission.id), (result) => { setMission(result); setView('diff') })
  const reset = () => { setMission(undefined); setView('nominal'); setError(undefined) }
  const needsClarification = mission?.status === 'awaiting_clarification'
  const verified = mission?.status === 'verified'
  const candidateSpace = mission?.bundles.length ? 2 ** mission.bundles.length : 0

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Constellation home">
          <span className="brand-mark"><span /><span /><i /></span>
          <span>CONSTELLATION</span>
        </a>
        <nav><a href="#mission">Mission</a><a href="#evidence">Evidence</a><a href="https://github.com/brayonpi/constellation">Source</a></nav>
        <div className="system-state"><i className={health?.mode === 'cloud' ? 'live' : ''} />{health?.mode === 'cloud' ? 'Google Cloud' : 'Local development mode'}</div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <div className="announcement"><Sparkles size={14} /> Proof-carrying mission control <ChevronRight size={14} /></div>
            <h1>Say the mission.<br /><span>Prove the plan.</span></h1>
            <p>Gemini understands mission intent. HexStellar searches the combinatorial space. Independent verification decides what can fly.</p>
            <div className="hero-actions">
              <button className="primary-button" onClick={launch} disabled={busy}><Satellite size={17} />{busy && !mission ? 'Launching…' : 'Launch mission'}<ArrowRight size={16} /></button>
              {mission && <button className="secondary-button" onClick={reset}><RotateCcw size={15} /> Reset demo</button>}
            </div>
            <div className="built-with"><span>BUILT WITH</span><b>Gemini 3.5 Flash</b><i /><b>Google ADK</b><i /><b>Cloud Run</b><i /><b>HexStellar Cortex</b></div>
          </div>
          <div className="hero-orbit" aria-hidden="true"><span className="orbit orbit-a"><i /></span><span className="orbit orbit-b"><i /></span><div className="hero-planet"><span /></div></div>
        </section>

        <section className="mission-grid" id="mission">
          <div className="panel globe-panel">
            <div className="panel-heading globe-heading">
              <div><span className="eyebrow"><Radio size={12} /> Live digital twin</span><h2>Orbital compute network</h2></div>
              <div className="view-toggle">{(['nominal','incident','recovered','diff'] as View[]).map((item) => <button className={view === item ? 'active' : ''} onClick={() => setView(item)} key={item}>{item}</button>)}</div>
            </div>
            <OrbitalGlobe mission={mission} view={view} />
            <div className="globe-stats">
              <div><span>Satellites</span><strong>12</strong></div><div><span>Ground stations</span><strong>4</strong></div><div><span>Workloads</span><strong>24</strong></div><div><span>Contact windows</span><strong>36</strong></div>
            </div>
          </div>

          <aside className="panel console-panel">
            <div className="panel-heading"><div><span className="eyebrow"><Command size={12} /> Mission console</span><h2>Operator intent</h2></div><span className={`status-pill status-${mission?.status ?? 'idle'}`}>{mission?.status?.replaceAll('_',' ') ?? 'standby'}</span></div>
            <div className="message operator-message"><span className="avatar">OP</span><p>{intent}</p></div>
            {!mission && <textarea value={intent} onChange={(event) => setIntent(event.target.value)} aria-label="Mission intent" />}
            {mission?.intent && <div className="canonical-card"><div><Braces size={15} /><span>Canonical mission model</span></div><code>{mission.intent.canonical_digest.slice(0, 24)}…</code><small>{mission.intent.live_interpretation ? 'Live Gemini interpretation' : 'Structured local fixture — not a live Gemini call'}</small></div>}
            {needsClarification && <div className="clarification"><span className="avatar agent">AI</span><div><strong>One decision changes the mission.</strong><p>If every objective cannot be met, should the system preserve the urgent compute deadline or every non-critical downlink?</p><button onClick={clarifyAndPlan} disabled={busy}>Preserve urgent deadline <ArrowRight size={14} /></button><button className="text-button" disabled>Preserve non-critical downlinks</button></div></div>}
            {mission?.plan && <div className="result-card"><div className="result-icon"><ShieldCheck size={22} /></div><div><span>{mission.plan.verification_report?.verified ? 'Independent replay passed' : 'Plan was not authorized'}</span><strong>{mission.plan.selected_bundle_ids.length} mission bundles selected</strong><small>{mission.plan.postponed_jobs.length} deferable jobs moved beyond this horizon</small></div></div>}
            {verified && <button className="primary-button apply-button" onClick={applyPlan} disabled={busy}><ShieldCheck size={16} />Apply verified plan to sandbox</button>}
            {mission?.status === 'applied' && <div className="applied-banner"><CircleDot size={15} /> Sandbox state updated. External patch remains review-only.</div>}
            {error && <div className="error-banner">{error}</div>}
          </aside>

          <Timeline mission={mission} />
          <DecisionTrace mission={mission} busy={busy} />
          <div id="evidence"><EvidenceRoom mission={mission} /></div>
        </section>

        <section className="difference-section">
          <div className="difference-heading">
            <span className="eyebrow">Why this is different</span>
            <h2>From plausible language<br />to an admissible action.</h2>
            <p>Most agent demos stop when the model emits structured output. Constellation starts there.</p>
          </div>
          <div className="difference-flow">
            <article>
              <span className="step-number">01</span>
              <div className="step-icon gemini-step"><Sparkles size={20} /></div>
              <small>UNDERSTAND</small>
              <h3>Gemini compiles intent</h3>
              <p>Language becomes explicit obligations, hard constraints, preferences, and objective order. Material ambiguity blocks execution.</p>
              <strong>Semantic model</strong>
            </article>
            <i className="flow-arrow"><ArrowRight size={17} /></i>
            <article>
              <span className="step-number">02</span>
              <div className="step-icon cortex-step"><Activity size={20} /></div>
              <small>SEARCH</small>
              <h3>Cortex explores globally</h3>
              <p>Locally valid mission bundles become a coverage contract with cost, conflicts, force, and quarantine boundaries.</p>
              <strong>{candidateSpace ? `${candidateSpace.toLocaleString()} candidate subsets` : 'Combinatorial contract'}</strong>
            </article>
            <i className="flow-arrow"><ArrowRight size={17} /></i>
            <article>
              <span className="step-number">03</span>
              <div className="step-icon verify-step"><ShieldCheck size={20} /></div>
              <small>REFUTE</small>
              <h3>The verifier tries to break it</h3>
              <p>Original-domain replay recomputes every declared invariant and returns a concrete witness when one fails.</p>
              <strong>{mission?.plan?.verification_report?.verified ? '8 check families passed' : 'No pass, no action'}</strong>
            </article>
          </div>
          <div className="boundary-callout"><span>THE BOUNDARY IS THE PRODUCT</span><p>Gemini never certifies itself. Cortex certainty is never promoted. The sandbox changes only after independent replay.</p></div>
        </section>

        <section className="proof-strip">
          <div><Activity size={18} /><span>Event-driven</span><p>Telemetry starts the workflow; duplicate delivery is safe.</p></div>
          <div><Braces size={18} /><span>Semantically fail-closed</span><p>Meaningful model drift blocks the solve and exposes a diff.</p></div>
          <div><ShieldCheck size={18} /><span>Independently replayed</span><p>The verifier can return a concrete counterexample, not a green badge.</p></div>
        </section>
      </main>

      <footer><div className="brand"><span className="brand-mark small"><span /><span /><i /></span><span>CONSTELLATION</span></div><p>An independent simulated research prototype. Not affiliated with or endorsed by Google or Project Suncatcher.</p><span>© 2026 HexStellar</span></footer>
    </div>
  )
}
