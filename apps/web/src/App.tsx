import { lazy, Suspense, useEffect, useState } from 'react'
import {
  Activity,
  ArrowRight,
  Braces,
  ChevronRight,
  CircleDot,
  Command,
  Radio,
  RotateCcw,
  Satellite,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import { api, appendEvent } from './api'
import { DecisionTrace } from './components/DecisionTrace'
import { EvidenceRoom } from './components/EvidenceRoom'
import { Timeline } from './components/Timeline'
import type { AuditEvent, Health, Mission, MissionView } from './types'

const DEFAULT_INTENT = 'Preserve every health contact. Complete the urgent model-evaluation workload before the deadline. Avoid dropping previously accepted critical jobs and minimize schedule disruption.'
const OrbitalGlobe = lazy(() => import('./components/OrbitalGlobe').then((module) => ({ default: module.OrbitalGlobe })))
const runningStatuses = new Set([
  'interpreting', 'planning', 'generating_bundles', 'cortex_cover', 'cortex_qap', 'verifying',
])

function missionFromLocation(): string | undefined {
  return new URLSearchParams(window.location.search).get('mission')
    ?? window.localStorage.getItem('constellation:last-mission')
    ?? undefined
}

export default function App() {
  const [mission, setMission] = useState<Mission>()
  const [health, setHealth] = useState<Health>()
  const [intent, setIntent] = useState(DEFAULT_INTENT)
  const [operationBusy, setOperationBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [view, setView] = useState<MissionView>('nominal')
  const [streamState, setStreamState] = useState<'idle' | 'connected' | 'reconnecting'>('idle')
  const missionId = mission?.id
  const missionStatus = mission?.status
  const telemetryCount = mission?.telemetry.length ?? 0

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth({
      status: 'degraded', mode: 'local', role: 'web', gemini_live: false, cortex_live: false, simulation: true,
    }))
    const restored = missionFromLocation()
    if (restored) api.get(restored).then(setMission).catch(() => window.localStorage.removeItem('constellation:last-mission'))
  }, [])

  useEffect(() => {
    if (!missionId) return
    window.localStorage.setItem('constellation:last-mission', missionId)
    const location = new URL(window.location.href)
    location.searchParams.set('mission', missionId)
    window.history.replaceState({}, '', location)
    const source = new EventSource(api.eventsUrl(missionId))
    source.onopen = () => setStreamState('connected')
    source.onerror = () => setStreamState('reconnecting')
    source.addEventListener('mission-event', (raw) => {
      const incoming = JSON.parse((raw as MessageEvent).data) as AuditEvent
      setMission((current) => current ? appendEvent(current, incoming) : current)
      api.get(missionId).then(setMission).catch(() => undefined)
    })
    return () => source.close()
  }, [missionId])

  useEffect(() => {
    if (missionStatus === 'applied') setView('diff')
    else if (missionStatus === 'verified') setView('recovered')
    else if (telemetryCount > 0) setView('incident')
  }, [missionStatus, telemetryCount])

  const busy = operationBusy || Boolean(mission && runningStatuses.has(mission.status))
  const run = async <T,>(operation: () => Promise<T>, apply: (result: T) => void) => {
    setOperationBusy(true)
    setError(undefined)
    try { apply(await operation()) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unknown mission error') }
    finally { setOperationBusy(false) }
  }

  const launch = () => run(async () => {
    const created = await api.create()
    setMission(created)
    const interpreted = await api.intent(created.id, intent)
    setMission(interpreted)
    return api.event(created.id)
  }, (result) => { setMission(result); setView('incident') })

  const clarifyAndPlan = (answer: 'urgent_deadline' | 'noncritical_downlinks') => mission && run(async () => {
    const clarified = await api.clarify(mission.id, answer)
    setMission(clarified)
    return api.plan(clarified.id)
  }, (result) => { setMission(result); setView('incident') })

  const applyPlan = () => mission && run(
    () => api.apply(mission.id),
    (result) => { setMission(result); setView('diff') },
  )
  const reset = () => {
    setMission(undefined)
    setView('nominal')
    setError(undefined)
    window.localStorage.removeItem('constellation:last-mission')
    window.history.replaceState({}, '', window.location.pathname)
  }

  const needsClarification = mission?.status === 'awaiting_clarification'
  const verified = mission?.status === 'verified'
  const candidateSpace = mission?.bundles.length && mission.bundles.length < 53
    ? 2 ** mission.bundles.length
    : undefined
  const activeStage = mission?.audit.at(-1)?.message ?? 'Waiting for mission launch'
  const systemLive = health?.mode === 'cloud'

  return (
    <div className={`app-shell mission-${view}`}>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Constellation home">
          <span className="brand-mark"><span /><span /><i /></span>
          <span>CONSTELLATION</span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#mission">Mission</a><a href="#evidence">Evidence</a><span title="Repository remains private until release approval">Source at release</span>
        </nav>
        <div className="system-state">
          <i className={systemLive ? 'live' : ''} />
          <span>{systemLive ? 'Google Cloud' : 'Local development'}</span>
          {mission && <b className={`stream-${streamState}`}>{streamState}</b>}
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <div className="announcement"><Sparkles size={14} /> Proof-carrying mission control <ChevronRight size={14} /></div>
            <h1>Say the mission.<br /><span>Prove the plan.</span></h1>
            <p>A language model can propose a plan. Constellation formalizes it, searches the combinatorial space, independently replays every obligation, and only then permits action.</p>
            <div className="hero-actions">
              <button className="primary-button" onClick={launch} disabled={busy}>
                <Satellite size={17} />{busy && !mission ? 'Launching mission…' : 'Launch mission'}<ArrowRight size={16} />
              </button>
              {mission && <button className="secondary-button" onClick={reset}><RotateCcw size={15} /> Reset sandbox</button>}
            </div>
            <div className="built-with"><span>BUILT WITH</span><b>Gemini 3.5 Flash</b><i /><b>Google ADK</b><i /><b>Cloud Run</b><i /><b>HexStellar Cortex</b></div>
          </div>
          <div className="hero-visual" aria-hidden="true">
            <div className="hero-signal"><span>MISSION KERNEL</span><strong>{mission ? mission.status.replaceAll('_', ' ') : 'STANDBY'}</strong></div>
            <span className="orbit orbit-a"><i /></span><span className="orbit orbit-b"><i /></span>
            <div className="hero-planet"><span /></div>
            <div className="hero-proof"><ShieldCheck size={15} /><span>ADMISSION GATE</span><strong>{mission?.plan?.verification_report?.verified ? 'VERIFIED' : 'LOCKED'}</strong></div>
          </div>
        </section>

        <section className="mission-grid" id="mission">
          <div className="panel globe-panel">
            <div className="panel-heading globe-heading">
              <div><span className="eyebrow"><Radio size={12} /> State-driven digital twin</span><h2>Orbital compute network</h2></div>
              <div className="view-toggle" aria-label="Mission view">
                {(['nominal', 'incident', 'recovered', 'diff'] as MissionView[]).map((item) => (
                  <button className={view === item ? 'active' : ''} onClick={() => setView(item)} key={item}>{item}</button>
                ))}
              </div>
            </div>
            <Suspense fallback={<div className="globe-fallback"><strong>Initializing mission renderer</strong><p>The structured timeline remains authoritative.</p></div>}>
              <OrbitalGlobe mission={mission} view={view} />
            </Suspense>
            <div className="live-stage"><span className={busy ? 'pulse-dot' : ''} />{activeStage}</div>
            <div className="globe-stats">
              <div><span>Satellites</span><strong>{mission?.snapshot.satellites.length ?? 12}</strong></div>
              <div><span>Ground stations</span><strong>{mission?.snapshot.ground_stations.length ?? 4}</strong></div>
              <div><span>Workloads</span><strong>{mission?.snapshot.jobs.length ?? 24}</strong></div>
              <div><span>Contact windows</span><strong>{mission?.snapshot.contact_windows.length ?? 36}</strong></div>
            </div>
          </div>

          <aside className="panel console-panel">
            <div className="panel-heading"><div><span className="eyebrow"><Command size={12} /> Mission console</span><h2>Operator intent</h2></div><span className={`status-pill status-${mission?.status ?? 'idle'}`}>{mission?.status?.replaceAll('_', ' ') ?? 'standby'}</span></div>
            <div className="message operator-message"><span className="avatar">OP</span><p>{intent}</p></div>
            {!mission && <textarea aria-label="Mission intent" value={intent} onChange={(event) => setIntent(event.target.value)} maxLength={8000} />}
            {mission?.intent && <div className="canonical-card">
              <div><Braces size={14} /><span>Canonical mission model</span></div>
              <code>{mission.intent.canonical_digest}</code>
              <small>{mission.intent.hard_constraints.length} hard constraints · {mission.intent.objective_order.length} ordered objectives · {mission.intent.live_interpretation ? 'live interpretation' : 'fixture fallback disclosed'}</small>
            </div>}
            {needsClarification && <div className="clarification"><span className="avatar agent">AI</span><div><strong>One decision changes the formal objective order.</strong><p>If every objective cannot be met, which commitment has precedence?</p><button onClick={() => clarifyAndPlan('urgent_deadline')} disabled={busy}>Urgent compute deadline <ArrowRight size={14} /></button><button className="text-button" onClick={() => clarifyAndPlan('noncritical_downlinks')} disabled={busy}>Every non-critical downlink</button></div></div>}
            {mission?.plan && <div className={`result-card ${mission.plan.verification_report?.verified ? 'result-pass' : 'result-blocked'}`}><div className="result-icon">{mission.plan.verification_report?.verified ? <ShieldCheck size={22} /> : <TriangleAlert size={22} />}</div><div><span>{mission.plan.verification_report?.verified ? 'Independent replay passed' : 'Plan was not authorized'}</span><strong>{mission.plan.selected_bundle_ids.length} mission bundles selected</strong><small>{mission.plan.postponed_jobs.length} deferable jobs moved beyond this horizon · {mission.execution_mode.replaceAll('_', ' ')}</small></div></div>}
            {verified && <button className="primary-button apply-button" onClick={applyPlan} disabled={busy}><ShieldCheck size={16} />Apply verified digest to sandbox</button>}
            {mission?.status === 'applied' && <div className="applied-banner"><CircleDot size={15} /> Sandbox updated. Any external mission patch remains review-only.</div>}
            {error && <div className="error-banner" role="alert"><TriangleAlert size={15} />{error}</div>}
          </aside>

          <Timeline mission={mission} view={view} />
          <DecisionTrace mission={mission} busy={busy} />
          <div id="evidence"><EvidenceRoom mission={mission} /></div>
        </section>

        <section className="difference-section">
          <div className="difference-heading">
            <span className="eyebrow">Why this is different</span>
            <h2>A plan is not an answer.<br />It is an artifact that must survive verification.</h2>
            <p>Most agent demos stop when a model emits structured output. Constellation starts there and preserves the boundary between interpretation, combinatorial search, independent replay, and action.</p>
          </div>
          <div className="difference-flow">
            <article><span className="step-number">01</span><div className="step-icon gemini-step"><Sparkles size={20} /></div><small>INTERPRET</small><h3>Gemini compiles intent</h3><p>Language becomes explicit obligations, hard constraints, preferences, and objective order. Material ambiguity blocks execution.</p><strong>Cannot declare safety</strong></article>
            <i className="flow-arrow"><ArrowRight size={17} /></i>
            <article><span className="step-number">02</span><div className="step-icon cortex-step"><Activity size={20} /></div><small>SEARCH</small><h3>Cortex selects a contract candidate</h3><p>Locally valid bundles become a coverage contract with costs, conflicts, and quarantine boundaries.</p><strong>{candidateSpace ? `${candidateSpace.toLocaleString()} declared subsets` : 'Formal combinatorial contract'}</strong></article>
            <i className="flow-arrow"><ArrowRight size={17} /></i>
            <article><span className="step-number">03</span><div className="step-icon verify-step"><ShieldCheck size={20} /></div><small>REFUTE</small><h3>The verifier tries to break it</h3><p>Network-free original-domain replay recomputes every declared invariant and returns a concrete witness when one fails.</p><strong>{mission?.plan?.verification_report?.verified ? `${Object.keys(mission.plan.verification_report.checks).length} check families passed` : 'No pass, no action'}</strong></article>
          </div>
          <div className="boundary-callout"><span>THE BOUNDARY IS THE PRODUCT</span><p>Gemini never certifies itself. Cortex certainty is never promoted. Only the exact verified digest can mutate this sandbox.</p></div>
        </section>

        <section className="proof-strip">
          <div><Activity size={18} /><span>Event-driven</span><p>Telemetry begins the recovery flow; duplicate delivery is idempotent.</p></div>
          <div><Braces size={18} /><span>Semantically fail-closed</span><p>Meaningful model drift blocks the solve and remains visible in evidence.</p></div>
          <div><ShieldCheck size={18} /><span>Independently replayed</span><p>The verifier returns specific counterexamples instead of a decorative green badge.</p></div>
        </section>
      </main>

      <footer><div className="brand"><span className="brand-mark small"><span /><span /><i /></span><span>CONSTELLATION</span></div><p>An independent simulated research prototype. Not affiliated with or endorsed by Google or Project Suncatcher.</p><span>© 2026 HexStellar</span></footer>
    </div>
  )
}
