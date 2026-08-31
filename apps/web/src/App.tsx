import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity,
  ArrowDown,
  ArrowRight,
  BookOpen,
  Braces,
  CheckCircle2,
  CircleDot,
  Command,
  Download,
  ExternalLink,
  Github,
  LockKeyhole,
  Play,
  Radio,
  RotateCcw,
  Satellite,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  WifiOff,
  Zap,
} from 'lucide-react'
import { api, appendEvent } from './api'
import { DecisionTrace } from './components/DecisionTrace'
import { EvidenceRoom } from './components/EvidenceRoom'
import { ProofArchitecture } from './components/ProofArchitecture'
import { Timeline } from './components/Timeline'
import { EXTERNAL_LINKS } from './links'
import type { AuditEvent, Health, Mission, MissionView } from './types'

const DEFAULT_INTENT = 'Preserve every health contact. Complete the urgent model evaluation workload before the deadline. Avoid dropping previously accepted critical jobs and minimize schedule disruption.'
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
  recovered: 'Checked plan',
  diff: 'What changed',
}
const statusLabels: Record<string, string> = {
  idle: 'ready to run',
  created: 'mission created',
  interpreting: 'understanding request',
  awaiting_clarification: 'your choice is needed',
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
  const eventStreamRef = useRef<EventSource | undefined>(undefined)
  const automaticStoryTimersRef = useRef<number[]>([])
  const automaticStoryPlayedRef = useRef(false)
  const automaticStoryActiveRef = useRef(false)
  const verifiedPlanRef = useRef(false)
  const [mission, setMission] = useState<Mission>()
  const [health, setHealth] = useState<Health>()
  const [intent, setIntent] = useState(DEFAULT_INTENT)
  const [operationBusy, setOperationBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [view, setView] = useState<MissionView>('nominal')
  const [viewReplayKey, setViewReplayKey] = useState(0)
  const [automaticStoryActive, setAutomaticStoryActive] = useState(false)
  const [streamRevision, setStreamRevision] = useState(0)
  const [streamState, setStreamState] = useState<'idle' | 'connected' | 'reconnecting' | 'complete'>('idle')
  const missionId = mission?.id
  const missionStatus = mission?.status
  const telemetryCount = mission?.telemetry.length ?? 0
  verifiedPlanRef.current = Boolean(mission?.plan?.verification_report?.verified)

  const stopAutomaticStory = useCallback(() => {
    automaticStoryTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    automaticStoryTimersRef.current = []
    automaticStoryActiveRef.current = false
    setAutomaticStoryActive(false)
  }, [])

  const playAutomaticStory = useCallback(() => {
    stopAutomaticStory()
    automaticStoryPlayedRef.current = true
    setViewReplayKey((current) => current + 1)
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setView('incident')
      return
    }
    automaticStoryActiveRef.current = true
    setAutomaticStoryActive(true)
    setView('nominal')
    automaticStoryTimersRef.current = [
      window.setTimeout(() => {
        setView('incident')
        setViewReplayKey((current) => current + 1)
      }, 950),
      window.setTimeout(() => {
        if (verifiedPlanRef.current) setView('recovered')
        automaticStoryActiveRef.current = false
        setAutomaticStoryActive(false)
        automaticStoryTimersRef.current = []
      }, 7400),
    ]
  }, [stopAutomaticStory])

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth({
      status: 'degraded', mode: 'local', role: 'web', gemini_live: false, cortex_live: false, simulation: true,
    }))
    const restored = missionFromLocation()
    if (restored) api.get(restored).then(setMission).catch(() => window.localStorage.removeItem('constellation:last-mission'))
  }, [])

  useEffect(() => {
    const target = document.getElementById('live-map')
    if (!target || automaticStoryPlayedRef.current) return
    const mapTarget = target
    const Observer = (window as Window & { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver
    let observer: IntersectionObserver | undefined
    const cleanup = () => {
      observer?.disconnect()
      window.removeEventListener('scroll', checkPosition)
      window.removeEventListener('resize', checkPosition)
    }
    const start = () => {
      cleanup()
      playAutomaticStory()
    }
    function checkPosition() {
      const rect = mapTarget.getBoundingClientRect()
      const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0))
      const requiredHeight = Math.min(rect.height, window.innerHeight) * 0.3
      if (visibleHeight >= requiredHeight) start()
    }
    if (Observer) {
      observer = new Observer((entries) => {
        if (entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.3)) start()
      }, { threshold: [0.3] })
      observer.observe(mapTarget)
    } else {
      window.addEventListener('scroll', checkPosition, { passive: true })
      window.addEventListener('resize', checkPosition)
      window.setTimeout(checkPosition, 0)
    }
    return cleanup
  }, [playAutomaticStory])

  useEffect(() => () => stopAutomaticStory(), [stopAutomaticStory])

  useEffect(() => {
    if (!missionId) return
    let active = true
    window.localStorage.setItem('constellation:last-mission', missionId)
    const location = new URL(window.location.href)
    location.searchParams.set('mission', missionId)
    window.history.replaceState({}, '', location)
    const source = new EventSource(api.eventsUrl(missionId))
    eventStreamRef.current = source
    source.onopen = () => { if (active) setStreamState('connected') }
    source.onerror = () => {
      api.get(missionId).then((latest) => {
        if (!active) return
        setMission(latest)
        if (terminalStatuses.has(latest.status)) {
          source.close()
          setStreamState('complete')
        } else {
          setStreamState('reconnecting')
        }
      }).catch(() => { if (active) setStreamState('reconnecting') })
    }
    source.addEventListener('mission-event', (raw) => {
      if (!active) return
      const incoming = JSON.parse((raw as MessageEvent).data) as AuditEvent
      setMission((current) => current ? appendEvent(current, incoming) : current)
      api.get(missionId).then((latest) => { if (active) setMission(latest) }).catch(() => undefined)
    })
    return () => {
      active = false
      source.close()
      if (eventStreamRef.current === source) eventStreamRef.current = undefined
    }
  }, [missionId, streamRevision])

  useEffect(() => {
    if (automaticStoryActiveRef.current) return
    if (missionStatus === 'applied') setView('recovered')
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
    stopAutomaticStory()
    const created = await api.create()
    setMission(created)
    const interpreted = await api.intent(created.id, intent)
    setMission(interpreted)
    return api.event(created.id)
  }, (result) => { setMission(result); setView('incident') })

  const startDemo = () => {
    document.getElementById('live-map')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    void launch()
  }

  const clarifyAndPlan = (answer: 'urgent_deadline' | 'noncritical_downlinks') => mission && run(async () => {
    stopAutomaticStory()
    const clarified = await api.clarify(mission.id, answer)
    setMission(clarified)
    return api.plan(clarified.id)
  }, (result) => { setMission(result); setView('incident') })

  const applyPlan = () => {
    if (!mission) return
    stopAutomaticStory()
    return run(
      () => api.apply(mission.id),
      (result) => { setMission(result); setView('diff') },
    )
  }
  const retryLiveCortex = () => {
    if (!mission) return
    stopAutomaticStory()
    return run(
      () => api.retry(mission.id),
      (result) => {
        setMission(result)
        setView('incident')
        setStreamState('reconnecting')
        setStreamRevision((current) => current + 1)
      },
    )
  }
  const useTransparentSimulation = () => {
    if (!mission) return
    stopAutomaticStory()
    return run(
      () => api.simulate(mission.id),
      (result) => {
        setMission(result)
        setView('incident')
        setStreamState('reconnecting')
        setStreamRevision((current) => current + 1)
      },
    )
  }
  const reset = () => {
    stopAutomaticStory()
    eventStreamRef.current?.close()
    eventStreamRef.current = undefined
    setMission(undefined)
    setStreamState('idle')
    setView('nominal')
    setError(undefined)
    window.localStorage.removeItem('constellation:last-mission')
    window.history.replaceState({}, '', window.location.pathname)
    window.setTimeout(playAutomaticStory, 450)
  }

  const needsClarification = mission?.status === 'awaiting_clarification'
  const verified = mission?.status === 'verified'
  const candidateSpace = mission?.bundles.length && mission.bundles.length < 53
    ? 2 ** mission.bundles.length
    : undefined
  const activeStage = mission?.audit.at(-1)?.message ?? 'Ready. Press Start the recovery below.'
  const systemLive = health?.mode === 'cloud'
  const replayReady = mission?.artifacts.some((item) => item.name === 'mission-replay.zip') ?? false
  const coverReceipt = mission?.plan?.receipts.find((receipt) => receipt.command === 'cover')
  const enginePeakRssMb = typeof coverReceipt?.engine_peak_rss_kb === 'number'
    ? coverReceipt.engine_peak_rss_kb / 1024
    : undefined
  const engineElapsedMs = typeof coverReceipt?.engine_elapsed_ms === 'number'
    ? coverReceipt.engine_elapsed_ms
    : undefined
  const runtime = mission?.runtime_telemetry
  const liveRoundTripMs = mission?.execution_mode === 'live' && typeof coverReceipt?.latency_ms === 'number'
    ? coverReceipt.latency_ms
    : undefined
  const selectView = (nextView: MissionView) => {
    stopAutomaticStory()
    setView(nextView)
    setViewReplayKey((current) => current + 1)
  }

  return (
    <div className={`app-shell mission-${view}`}>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Constellation home">
          <span className="brand-mark"><span /><span /><i /></span>
          <span>CONSTELLATION</span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#problem"><span>01</span> The problem</a>
          <a href="#mission"><span>02</span> Live recovery</a>
          <a href="#verify"><span>03</span> Verify it</a>
          <a href="#evidence"><span>04</span> Download proof</a>
        </nav>
        <div className="system-state">
          <i className={systemLive ? 'live' : ''} />
          <span>{systemLive ? 'Google Cloud live' : 'Local demo'}</span>
          {mission && <b className={`stream-${streamState}`}>{streamState}</b>}
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <div className="announcement"><LockKeyhole size={14} /> AI may propose. Only evidence permits action.</div>
            <h1>Say the mission.<br /><span>Prove the plan.</span></h1>
            <p className="hero-lead">Describe the outcome in plain language. Gemini 3.5 Flash turns it into visible rules. Cortex searches the connected choices. Separate Python code tries to reject the result. The sandbox stays locked until the exact plan passes.</p>
            <div className="hero-actions">
              {!mission && <button className="primary-button hero-primary" onClick={startDemo} disabled={busy}>
                <Play size={17} fill="currentColor" />{busy ? 'Starting the recovery…' : 'Start the 90 second proof'}<ArrowRight size={17} />
              </button>}
              {mission && <a className="primary-button hero-primary" href="#live-map"><Radio size={17} />Return to the live mission<ArrowDown size={16} /></a>}
              <a className="secondary-button" href="#problem">First, see the problem</a>
            </div>
            <p className="cta-note"><CircleDot size={13} /> No account or setup needed in this local demonstration.</p>
          </div>
          <div className="hero-rule" aria-label="The Constellation action gate">
            <div className="hero-rule-top"><span>THE ACTION GATE</span><strong>{mission?.plan?.verification_report?.verified ? 'UNLOCKED' : 'LOCKED'}</strong></div>
            <div className="hero-rule-flow">
              <span><Sparkles size={18} /><b>Gemini</b><small>translates</small></span>
              <ArrowRight size={16} />
              <span><Activity size={18} /><b>Cortex</b><small>searches</small></span>
              <ArrowRight size={16} />
              <span><ShieldCheck size={18} /><b>Python</b><small>checks</small></span>
            </div>
            <p><LockKeyhole size={16} /> The sandbox accepts only the exact fingerprint that passed the independent check.</p>
          </div>
        </section>

        <section className="demo-section" id="mission">
          <div className="impact-brief" id="problem">
            <div className="impact-brief-copy">
              <span className="section-number">01 / THE PROBLEM</span>
              <h2>Three failures hit at once.<br /><span>One believable mistake breaks the mission.</span></h2>
              <p>A simulated debris impact isolates two compute nodes while a ground station goes dark and urgent work arrives. Writing a convincing response is easy. Proving that 24 jobs, 36 contact windows, energy, storage, deadlines, and failed hardware still fit together is the hard part.</p>
            </div>
            <div className="impact-brief-events" aria-label="Incident summary">
              <div><WifiOff size={17} /><span><small>GROUND</small><strong>Station offline</strong></span></div>
              <div><Satellite size={17} /><span><small>ORBIT</small><strong>Debris impact</strong></span></div>
              <div><Zap size={17} /><span><small>WORKLOAD</small><strong>Urgent deadline</strong></span></div>
            </div>
            <div className="impact-brief-rule"><TriangleAlert size={18} /><span><strong>A plausible answer is not enough.</strong> Every shared resource and every rule must still fit at the same time.</span></div>
          </div>
          <div className="demo-heading">
            <div>
              <span className="section-number">02 / THE RECOVERY</span>
              <h2>Watch one failure become a checked plan.</h2>
              <p>The failure begins automatically when this map enters the screen. Choose any view whenever you want.</p>
            </div>
            <div className="demo-actions">
              {!mission && <button className="primary-button start-button" onClick={launch} disabled={busy}><Play size={16} fill="currentColor" />{busy ? 'Starting…' : 'Start the recovery'}<ArrowRight size={16} /></button>}
              {mission && <button className="secondary-button reset-button" onClick={reset}><RotateCcw size={15} />Reset the sandbox</button>}
              <small>{mission ? statusLabels[mission.status] ?? mission.status : 'Click once. The failure starts automatically.'}</small>
            </div>
          </div>

          <div className="mission-grid">
            <div className="panel globe-panel" id="live-map">
              <div className="panel-heading globe-heading">
                <div><span className="eyebrow"><Radio size={12} /> Live mission map</span><h3>Failure, recovery, and changed routes</h3></div>
                <div className="view-toggle" aria-label="Mission view">
                  {(['nominal', 'incident', 'recovered', 'diff'] as MissionView[]).map((item) => (
                    <button
                      type="button"
                      className={view === item ? 'active' : ''}
                      aria-pressed={view === item}
                      disabled={['recovered', 'diff'].includes(item) && !mission?.plan?.verification_report?.verified}
                      title={['recovered', 'diff'].includes(item) && !mission?.plan?.verification_report?.verified ? 'Available after the independent check passes' : `Show ${viewLabels[item].toLowerCase()}`}
                      onClick={() => selectView(item)}
                      key={item}
                    >{viewLabels[item]}</button>
                  ))}
                </div>
              </div>
              <Suspense fallback={<div className="globe-fallback"><strong>Loading the orbital scene</strong><p>Mission data and verification remain available.</p></div>}>
                <OrbitalGlobe
                  mission={mission}
                  view={view}
                  replayKey={viewReplayKey}
                  automaticStoryActive={automaticStoryActive}
                  onReplay={playAutomaticStory}
                />
              </Suspense>
              <div className="live-stage"><span className={busy ? 'pulse-dot' : ''} />{activeStage}</div>
              <div className="globe-stats">
                <div><span>Satellites</span><strong>{mission?.snapshot.satellites.length ?? 12}</strong></div>
                <div><span>Ground stations</span><strong>{mission?.snapshot.ground_stations.length ?? 4}</strong></div>
                <div><span>Workloads</span><strong>{mission?.snapshot.jobs.length ?? 24}</strong></div>
                <div><span>Contact windows</span><strong>{mission?.snapshot.contact_windows.length ?? 36}</strong></div>
              </div>
              <div className="run-telemetry" aria-label="Measured execution telemetry">
                <div className="run-telemetry-heading">
                  <span><Activity size={12} /> This run, measured</span>
                  <small>Operational telemetry · not a benchmark</small>
                </div>
                <div className="run-telemetry-grid">
                  <div className={engineElapsedMs === undefined ? 'metric-unavailable' : ''}><span>Cortex engine time</span><strong>{engineElapsedMs !== undefined ? `${engineElapsedMs} ms` : 'Not returned'}</strong><small>Computation reported by Cortex</small><code>elapsed_ms · engine only</code></div>
                  <div className={enginePeakRssMb === undefined ? 'metric-unavailable' : ''}><span>Cortex peak RSS</span><strong>{enginePeakRssMb !== undefined ? `${enginePeakRssMb.toFixed(2)} MB` : 'Not returned'}</strong><small>Highest memory reported during that Cortex run</small><code>peak_rss_kb · engine only</code></div>
                  <div className={liveRoundTripMs === undefined ? 'metric-unavailable' : ''}><span>HTTPS round trip</span><strong>{liveRoundTripMs !== undefined ? `${liveRoundTripMs} ms` : 'Not returned'}</strong><small>Network, preflight and solve</small><code>live receipt only</code></div>
                  <div><span>Full planning run</span><strong>{runtime ? `${runtime.planning_wall_time_ms} ms` : 'Pending'}</strong><small>Complete Constellation workflow</small><code>application wall time</code></div>
                  <div><span>Independent checker</span><strong>{runtime?.verifier_wall_time_ms !== undefined ? `${runtime.verifier_wall_time_ms} ms` : 'Pending'}</strong><small>Separate Python timeline replay</small><code>verifier wall time</code></div>
                  <div><span>Worker peak RSS</span><strong>{runtime ? `${runtime.process_peak_rss_mb.toFixed(2)} MB` : 'Pending'}</strong><small>Application process peak since start</small><code>not Cortex memory</code></div>
                </div>
                <p>{engineElapsedMs === undefined ? 'Cortex engine time and memory are available only on a live Cortex receipt. This local run does not invent them.' : 'Live engine values are preserved exactly as returned. '} <a href="#evidence">Inspect the sanitized receipt in the Evidence Room.</a></p>
              </div>
            </div>

            <aside className={`panel console-panel ${needsClarification ? 'needs-action' : ''}`}>
              <div className="panel-heading"><div><span className="eyebrow"><Command size={12} /> Your mission request</span><h3>Words become rules the checker can test</h3></div><span className={`status-pill status-${mission?.status ?? 'idle'}`}>{statusLabels[mission?.status ?? 'idle']}</span></div>
              <div className="message operator-message"><span className="avatar">YOU</span><p>{intent}</p></div>
              {!mission && <>
                <textarea aria-label="Mission intent" value={intent} onChange={(event) => setIntent(event.target.value)} maxLength={8000} />
                <button className="primary-button console-start" onClick={launch} disabled={busy}><Play size={15} fill="currentColor" />Start with this request</button>
              </>}
              {mission?.intent && <div className="canonical-card">
                <div><Braces size={14} /><span>Meaning frozen as testable rules</span></div>
                <code>{mission.intent.canonical_digest}</code>
                <small>{mission.intent.hard_constraints.length} rules cannot be broken · {mission.intent.objective_order.length} priorities are checked in order · {mission.intent.live_interpretation ? 'Gemini interpreted this live' : 'committed fallback disclosed'}</small>
              </div>}
              {needsClarification && <div className="clarification"><span className="avatar agent">AI</span><div><span className="action-required">ONE DECISION NEEDED</span><strong>This answer changes which plan wins.</strong><p>If everything cannot fit, what must be protected first?</p><button onClick={() => clarifyAndPlan('urgent_deadline')} disabled={busy}>Protect the urgent deadline <ArrowRight size={14} /></button><button className="text-button" onClick={() => clarifyAndPlan('noncritical_downlinks')} disabled={busy}>Protect every lower priority download</button></div></div>}
              {mission?.plan && <div className={`result-card ${mission.plan.verification_report?.verified ? 'result-pass' : 'result-blocked'}`}><div className="result-icon">{mission.plan.verification_report?.verified ? <ShieldCheck size={22} /> : <TriangleAlert size={22} />}</div><div><span>{mission.plan.verification_report?.verified ? 'INDEPENDENT CHECK PASSED' : 'PLAN BLOCKED'}</span><strong>{mission.plan.selected_bundle_ids.length} schedule pieces fit together</strong><small>{mission.plan.postponed_jobs.length} lower priority jobs safely moved · {executionLabels[mission.execution_mode] ?? mission.execution_mode.replaceAll('_', ' ')}</small></div></div>}
              {mission?.status === 'contract_rejected' && <div className="error-banner" role="status"><TriangleAlert size={15} /><span><strong>The system stopped honestly.</strong> This scenario cannot prove that every lower priority output exists. No Cortex search ran and no plan can be applied.</span></div>}
              {mission?.status === 'cortex_unavailable' && <div className="cortex-fallback" role="status">
                <div><TriangleAlert size={17} /><span><strong>The live Cortex request stopped.</strong><small>No replacement answer was invented. Choose exactly what should happen next.</small></span></div>
                <button className="primary-button" onClick={retryLiveCortex} disabled={busy}><RotateCcw size={14} />Retry live Cortex</button>
                <button className="secondary-button" onClick={useTransparentSimulation} disabled={busy}><Play size={14} />Run transparent simulation</button>
                <p>The simulation uses the same mission contract and independent checker. It is labeled local deterministic and does not pretend to be a Cortex response.</p>
              </div>}
              {verified && <button className="primary-button apply-button" onClick={applyPlan} disabled={busy}><ShieldCheck size={16} />Apply this checked plan to the sandbox<ArrowRight size={15} /></button>}
              {mission?.status === 'applied' && <div className="applied-banner"><CheckCircle2 size={16} /> The sandbox now uses the exact plan that passed the check.</div>}
              {error && <div className="error-banner" role="alert"><TriangleAlert size={15} />{error}</div>}
            </aside>

            <Timeline mission={mission} view={view} />
            <DecisionTrace mission={mission} busy={busy} />
          </div>
        </section>

        <section className="verify-section" id="verify">
          <div className="section-heading verify-heading">
            <span className="section-number">03 / TEST IT YOURSELF</span>
            <h2>No system grades its own homework.</h2>
            <p>Three components have three separate jobs. The final component is deliberately unable to repair a bad answer; it can only pass it or show the exact failure.</p>
          </div>
          <ProofArchitecture
            languageModelName="Gemini 3.5 Flash"
            executionMode={mission?.execution_mode}
            candidateSpace={candidateSpace}
            candidateCount={mission?.bundles.length}
            passedRuleGroups={mission?.plan?.verification_report?.verified ? Object.keys(mission.plan.verification_report.checks).length : undefined}
          />
          <div className="learn-cortex">
            <div><BookOpen size={20} /><span><strong>Inspect the search platform instead of taking our word for it.</strong><small>Read the public contract and inspect the same CLI/client engineers use.</small></span></div>
            <div className="learn-cortex-actions">
              <a href={EXTERNAL_LINKS.cortexDocs} target="_blank" rel="noreferrer">Read the Cortex docs <ExternalLink size={13} /></a>
              <a href={EXTERNAL_LINKS.cortexClient} target="_blank" rel="noreferrer">Inspect the public CLI/client <Github size={13} /></a>
            </div>
          </div>
        </section>

        <section className="evidence-section" id="evidence">
          <div className="evidence-step-heading">
            <span className="section-number">04 / DOWNLOAD THE ORIGINALS</span>
            <h2>Recheck it here. Then download the chain of custody.</h2>
            <p>Run the independent Python checker again from this page, inspect its exact source, or download the request, frozen rules, candidate pieces, selected plan, receipts, report, event log, checksums, and AI audit guide. Offline replay checks the frozen evidence without calling Gemini or Cortex.</p>
            {replayReady && mission && <a className="primary-button evidence-download" href={api.bundleUrl(mission.id)} download><Download size={17} />Download the evidence and verify it</a>}
          </div>
          <EvidenceRoom mission={mission} languageModelName="Gemini 3.5 Flash" onMissionUpdate={setMission} />
        </section>
      </main>

      <footer>
        <div className="brand"><span className="brand-mark small"><span /><span /><i /></span><span>CONSTELLATION</span></div>
        <div className="founder-credit"><strong>Created by Brayon Pieske</strong><span>Founder, HexStellar</span><small>TrustCarbon is listed only as a professional founder link. It is not part of this application.</small></div>
        <p>A simulated research prototype. It checks this software mission, not real spacecraft. No affiliation with Google or Project Suncatcher.</p>
        <div className="footer-links">
          <a href={EXTERNAL_LINKS.hexstellar} target="_blank" rel="noreferrer">hexstellar.com</a>
          <a href={EXTERNAL_LINKS.trustCarbon} target="_blank" rel="noreferrer">trustcarbon.org</a>
          <a className="linkedin-button" href={EXTERNAL_LINKS.founderLinkedIn} target="_blank" rel="noreferrer">Connect on LinkedIn <ExternalLink size={12} /></a>
          <a href={EXTERNAL_LINKS.projectSource} target="_blank" rel="noreferrer">Project source</a>
        </div>
      </footer>
    </div>
  )
}
