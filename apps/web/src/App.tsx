import { lazy, Suspense, useEffect, useState } from 'react'
import {
  Activity,
  ArrowRight,
  BookOpen,
  Braces,
  ChevronRight,
  CircleDot,
  Command,
  ExternalLink,
  Github,
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
import { EXTERNAL_LINKS } from './links'
import type { AuditEvent, Health, Mission, MissionView } from './types'

const DEFAULT_INTENT = 'Preserve every health contact. Complete the urgent model-evaluation workload before the deadline. Avoid dropping previously accepted critical jobs and minimize schedule disruption.'
const OrbitalGlobe = lazy(() => import('./components/OrbitalGlobe').then((module) => ({ default: module.OrbitalGlobe })))
const runningStatuses = new Set([
  'interpreting', 'planning', 'generating_bundles', 'cortex_cover', 'cortex_qap', 'verifying',
])
const terminalStatuses = new Set([
  'verified', 'applied', 'impossible', 'rejected', 'interpretation_failed', 'contract_rejected',
  'cortex_unavailable', 'verification_failed', 'apply_conflict',
])
const viewLabels: Record<MissionView, string> = {
  nominal: 'Before failure',
  incident: 'Failure',
  recovered: 'New plan',
  diff: 'What changed',
}
const statusLabels: Record<string, string> = {
  idle: 'ready',
  created: 'mission created',
  interpreting: 'understanding request',
  awaiting_clarification: 'waiting for one choice',
  planning: 'building recovery plan',
  generating_bundles: 'building schedule pieces',
  cortex_cover: 'searching complete plans',
  cortex_qap: 'placing compute work',
  verifying: 'checking every rule',
  verified: 'every rule passed',
  applied: 'sandbox updated',
  impossible: 'no valid plan found',
  rejected: 'plan blocked',
  interpretation_failed: 'request could not be understood',
  contract_rejected: 'search request rejected',
  cortex_unavailable: 'Cortex unavailable',
  verification_failed: 'plan failed a rule',
  apply_conflict: 'mission changed before update',
}
const executionLabels: Record<string, string> = {
  live: 'live services',
  local_deterministic: 'local deterministic demo',
  offline_precomputed: 'clearly marked offline replay',
  degraded_fixture: 'clearly marked interpretation fallback',
}

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
  const [streamState, setStreamState] = useState<'idle' | 'connected' | 'reconnecting' | 'complete'>('idle')
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
    source.onerror = () => {
      api.get(missionId).then((latest) => {
        setMission(latest)
        if (terminalStatuses.has(latest.status)) {
          source.close()
          setStreamState('complete')
        } else {
          setStreamState('reconnecting')
        }
      }).catch(() => setStreamState('reconnecting'))
    }
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
          <a href="#mission">Live story</a>
          <a href="#how-it-works">How it works</a>
          <a href="#evidence">Proof</a>
          <a href={EXTERNAL_LINKS.cortexDocs} target="_blank" rel="noreferrer">Cortex docs <ExternalLink size={11} /></a>
          <a href={EXTERNAL_LINKS.projectSource} target="_blank" rel="noreferrer" title="Available anonymously after release approval">Source <Github size={11} /></a>
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
            <div className="announcement"><Sparkles size={14} /> AI planning with an independent pass/fail test <ChevronRight size={14} /></div>
            <h1>Say the mission.<br /><span>Prove the plan.</span></h1>
            <p>When part of the network fails, Constellation finds a replacement schedule — then a separate checker plays it forward minute by minute. If one required job is missed, one station is double-booked, or failed hardware is used, nothing changes.</p>
            <div className="hero-steps" aria-label="Constellation in three steps">
              <span><b>1</b> Understand the request</span>
              <span><b>2</b> Search whole plans</span>
              <span><b>3</b> Block any broken plan</span>
            </div>
            <div className="hero-actions">
              <button className="primary-button" onClick={launch} disabled={busy}>
                <Satellite size={17} />{busy && !mission ? 'Starting failure recovery…' : 'Run the failure recovery'}<ArrowRight size={16} />
              </button>
              {mission && <button className="secondary-button" onClick={reset}><RotateCcw size={15} /> Reset sandbox</button>}
              <a className="secondary-button" href={EXTERNAL_LINKS.cortexDocs} target="_blank" rel="noreferrer"><BookOpen size={15} /> See how Cortex works <ExternalLink size={13} /></a>
            </div>
            <div className="built-with"><span>BUILT WITH</span><b>Gemini 3.5 Flash</b><i /><b>Google ADK</b><i /><b>Cloud Run</b><i /><b>HexStellar Cortex</b></div>
          </div>
          <div className="hero-visual" aria-hidden="true">
            <div className="hero-signal"><span>RECOVERY STATUS</span><strong>{mission ? statusLabels[mission.status] ?? mission.status.replaceAll('_', ' ') : 'READY TO DEMO'}</strong></div>
            <span className="orbit orbit-a"><i /></span><span className="orbit orbit-b"><i /></span>
            <div className="hero-planet"><span /></div>
            <div className="hero-proof"><ShieldCheck size={15} /><span>INDEPENDENT CHECK</span><strong>{mission?.plan?.verification_report?.verified ? 'EVERY RULE PASSED' : 'ACTION LOCKED'}</strong></div>
          </div>
        </section>

        <section className="mission-grid" id="mission">
          <div className="panel globe-panel">
            <div className="panel-heading globe-heading">
              <div><span className="eyebrow"><Radio size={12} /> Same mission, four views</span><h2>See the failure and the recovery</h2></div>
              <div className="view-toggle" aria-label="Mission view">
                {(['nominal', 'incident', 'recovered', 'diff'] as MissionView[]).map((item) => (
                  <button className={view === item ? 'active' : ''} onClick={() => setView(item)} key={item}>{viewLabels[item]}</button>
                ))}
              </div>
            </div>
            <Suspense fallback={<div className="globe-fallback"><strong>Drawing the simulated network</strong><p>The schedule below contains the values that are actually checked.</p></div>}>
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
            <div className="panel-heading"><div><span className="eyebrow"><Command size={12} /> What the operator asked for</span><h2>Plain language becomes testable rules</h2></div><span className={`status-pill status-${mission?.status ?? 'idle'}`}>{statusLabels[mission?.status ?? 'idle']}</span></div>
            <div className="message operator-message"><span className="avatar">OP</span><p>{intent}</p></div>
            {!mission && <textarea aria-label="Mission intent" value={intent} onChange={(event) => setIntent(event.target.value)} maxLength={8000} />}
            {mission?.intent && <div className="canonical-card">
              <div><Braces size={14} /><span>The request, frozen as testable rules</span></div>
              <code>{mission.intent.canonical_digest}</code>
              <small>This fingerprint changes if the meaning changes. {mission.intent.hard_constraints.length} rules cannot be broken · {mission.intent.objective_order.length} priorities are checked in order · {mission.intent.live_interpretation ? 'Gemini interpreted this live' : 'the committed fallback is clearly disclosed'}</small>
            </div>}
            {needsClarification && <div className="clarification"><span className="avatar agent">AI</span><div><strong>This choice changes which plan wins.</strong><p>If both goals cannot fit, what must Constellation protect first?</p><button onClick={() => clarifyAndPlan('urgent_deadline')} disabled={busy}>Finish the urgent job on time <ArrowRight size={14} /></button><button className="text-button" onClick={() => clarifyAndPlan('noncritical_downlinks')} disabled={busy}>Keep every lower-priority download</button></div></div>}
            {mission?.plan && <div className={`result-card ${mission.plan.verification_report?.verified ? 'result-pass' : 'result-blocked'}`}><div className="result-icon">{mission.plan.verification_report?.verified ? <ShieldCheck size={22} /> : <TriangleAlert size={22} />}</div><div><span>{mission.plan.verification_report?.verified ? 'A separate checker passed every rule' : 'The checker blocked this plan'}</span><strong>{mission.plan.selected_bundle_ids.length} complete schedule pieces fit together</strong><small>{mission.plan.postponed_jobs.length} lower-priority jobs safely moved later · {executionLabels[mission.execution_mode] ?? mission.execution_mode.replaceAll('_', ' ')}</small></div></div>}
            {mission?.status === 'contract_rejected' && <div className="error-banner" role="status"><TriangleAlert size={15} /><span><strong>This choice was real—and the system stopped honestly.</strong> The golden scenario does not record enough state to prove that every previously computed lower-priority output is available. No Cortex search ran and no plan can be applied.</span></div>}
            {verified && <button className="primary-button apply-button" onClick={applyPlan} disabled={busy}><ShieldCheck size={16} />Use the checked plan in this sandbox</button>}
            {mission?.status === 'applied' && <div className="applied-banner"><CircleDot size={15} /> The simulated mission now uses the checked plan. A real external system would still require human review.</div>}
            {error && <div className="error-banner" role="alert"><TriangleAlert size={15} />{error}</div>}
          </aside>

          <Timeline mission={mission} view={view} />
          <DecisionTrace mission={mission} busy={busy} />
          <div id="evidence"><EvidenceRoom mission={mission} /></div>
        </section>

        <section className="difference-section" id="how-it-works">
          <div className="difference-heading">
            <span className="eyebrow">Why this is different — in plain English</span>
            <h2>Three different jobs.<br />No system grades its own homework.</h2>
            <p>Many AI demos stop when the model writes something that looks like a plan. Constellation separates understanding the request, finding a complete schedule, and checking every rule. A plan only becomes usable after all three agree.</p>
          </div>
          <div className="difference-flow">
            <article><span className="step-number">01</span><div className="step-icon gemini-step"><Sparkles size={20} /></div><small>UNDERSTAND</small><h3>Gemini turns words into a checklist</h3><p>It identifies what must happen, what may move, and which goal matters most. If a missing answer would change the winner, it asks first.</p><strong>It does not approve the plan</strong></article>
            <i className="flow-arrow"><ArrowRight size={17} /></i>
            <article><span className="step-number">02</span><div className="step-icon cortex-step"><Activity size={20} /></div><small>SEARCH</small><h3>Cortex compares whole recovery plans</h3><p>It searches combinations of pre-checked schedule pieces together, so fixing one satellite cannot quietly break another station or deadline.</p><strong>{candidateSpace ? `${candidateSpace.toLocaleString()} raw combinations before rules` : 'Searches combinations, not prose'}</strong></article>
            <i className="flow-arrow"><ArrowRight size={17} /></i>
            <article><span className="step-number">03</span><div className="step-icon verify-step"><ShieldCheck size={20} /></div><small>CHECK</small><h3>A separate program tries to reject it</h3><p>It plays the schedule minute by minute. It catches missed work, double booking, late deadlines, full storage, low energy, or failed hardware.</p><strong>{mission?.plan?.verification_report?.verified ? `${Object.keys(mission.plan.verification_report.checks).length} groups of rules passed` : 'One broken rule means no action'}</strong></article>
          </div>
          <div className="boundary-callout"><span>THE SIMPLE RULE</span><p>Gemini cannot approve itself. Cortex cannot update the mission. The independent checker holds the key, and the key only fits the exact plan it checked.</p></div>
          <div className="learn-cortex">
            <div><BookOpen size={20} /><span><strong>Want to inspect the platform behind the search?</strong><small>The public docs explain the inputs, outputs, examples, certainty labels, and verification workflow used by Cortex.</small></span></div>
            <div className="learn-cortex-actions">
              <a href={EXTERNAL_LINKS.cortexDocs} target="_blank" rel="noreferrer">Read the Cortex docs <ExternalLink size={13} /></a>
              <a href={EXTERNAL_LINKS.cortexClient} target="_blank" rel="noreferrer">Inspect the public CLI/client <Github size={13} /></a>
            </div>
          </div>
        </section>

        <section className="proof-strip">
          <div><Activity size={18} /><span>A real event starts the work</span><p>The failure message begins recovery automatically. Receiving the same message twice does not create two missions.</p></div>
          <div><Braces size={18} /><span>A changed meaning stops the run</span><p>If the operator's request and the frozen rules disagree, Constellation shows the difference and asks instead of guessing.</p></div>
          <div><ShieldCheck size={18} /><span>A failure comes with an explanation</span><p>The checker names the exact missed task, overlap, deadline, or resource violation — not just a red badge.</p></div>
        </section>
      </main>

      <footer><div className="brand"><span className="brand-mark small"><span /><span /><i /></span><span>CONSTELLATION</span></div><p>A simulated research prototype: it checks this software mission, not real spacecraft. No affiliation with Google or Project Suncatcher.</p><div className="footer-links"><a href={EXTERNAL_LINKS.cortexDocs} target="_blank" rel="noreferrer">Cortex docs</a><a href={EXTERNAL_LINKS.projectSource} target="_blank" rel="noreferrer">Project source</a><span>© 2026 HexStellar</span></div></footer>
    </div>
  )
}
