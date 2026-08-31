import { useState } from 'react'
import {
  BookOpen,
  Check,
  Code2,
  Download,
  ExternalLink,
  FileArchive,
  FileJson2,
  Fingerprint,
  Gauge,
  Github,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react'
import { api } from '../api'
import { EXTERNAL_LINKS } from '../links'
import type { Mission } from '../types'

const shorten = (value?: string) => value ? `${value.slice(0, 12)}…${value.slice(-8)}` : 'Pending'
const bytes = (size: number) => size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`
const checkLabels: Record<string, string> = {
  coverage: 'Every required task is scheduled',
  no_duplicate_jobs: 'No job runs twice',
  quarantine: 'Failed hardware stays unused',
  temporal: 'No time or station collision',
  resources: 'Energy, storage, and capacity fit',
  deadlines: 'Urgent work finishes on time',
  qap: 'Compute placement cost matches',
  provenance: 'Inputs and fingerprints match',
}

interface EvidenceRoomProps {
  mission?: Mission
  languageModelName: string
  onMissionUpdate?: (mission: Mission) => void
}

export function EvidenceRoom({ mission, languageModelName, onMissionUpdate }: EvidenceRoomProps) {
  const [recheckState, setRecheckState] = useState<'idle' | 'running' | 'passed' | 'failed'>('idle')
  const [recheckError, setRecheckError] = useState<string>()
  const [verifierSource, setVerifierSource] = useState<string>()
  const [sourceError, setSourceError] = useState<string>()
  const [sourceLoading, setSourceLoading] = useState(false)
  const report = mission?.plan?.verification_report
  const cover = mission?.plan?.receipts.find((receipt) => receipt.command === 'cover')
  const qap = mission?.plan?.receipts.find((receipt) => receipt.command === 'qap')
  const recheck = async () => {
    if (!mission?.plan) return
    setRecheckState('running')
    setRecheckError(undefined)
    try {
      const updated = await api.verify(mission.id)
      onMissionUpdate?.(updated)
      setRecheckState(updated.plan?.verification_report?.verified ? 'passed' : 'failed')
    } catch (error) {
      setRecheckState('failed')
      setRecheckError(error instanceof Error ? error.message : 'Independent recheck failed')
    }
  }
  const showVerifierSource = async () => {
    if (verifierSource) {
      setVerifierSource(undefined)
      return
    }
    setSourceLoading(true)
    setSourceError(undefined)
    try {
      setVerifierSource(await api.verifierSource())
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : 'Verifier source could not be loaded')
    } finally {
      setSourceLoading(false)
    }
  }
  return (
    <section className="panel evidence-panel" aria-labelledby="evidence-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Replay contents</span>
          <h2 id="evidence-title">What the judge receives</h2>
        </div>
        {mission?.artifacts.some((item) => item.name === 'mission-replay.zip') && (
          <a className="ghost-button" href={api.bundleUrl(mission.id)} download>
            <Download size={15} /> Replay ZIP
          </a>
        )}
      </div>
      <p className="evidence-intro">
        Every file below is checksummed. The replay ZIP lets a judge rerun the independent checker against the
        exact request, scenario, and selected plan without {languageModelName}, Cortex, or an internet connection.
        Here, independent means separate from the planner: this is inspectable project code, not a third-party audit.
      </p>
      <div className="live-recheck" aria-label="Independent verifier controls">
        <div className="live-recheck-copy">
          <span>RUN THE PROOF AGAIN</span>
          <strong>Do not trust the green badge. Ask the separate checker to recompute it now.</strong>
          <p>This action sends the already frozen mission files only to the Python verifier. It does not call {languageModelName}, does not call Cortex, and cannot repair the plan to make it pass.</p>
        </div>
        <div className="live-recheck-actions">
          <button type="button" onClick={recheck} disabled={!mission?.plan || recheckState === 'running'}><RefreshCw className={recheckState === 'running' ? 'spin' : ''} size={15} />{recheckState === 'running' ? 'Checking every rule' : 'Run independent check again'}</button>
          <button type="button" className="source-button" onClick={showVerifierSource} disabled={sourceLoading}><Code2 size={15} />{sourceLoading ? 'Loading source' : verifierSource ? 'Hide verifier source' : 'Show the exact Python code'}</button>
          <a href={EXTERNAL_LINKS.verifierSource} target="_blank" rel="noreferrer"><Github size={14} />Open source in the repository <ExternalLink size={12} /></a>
        </div>
        {recheckState === 'passed' && <div className="recheck-result pass" role="status"><Check size={16} /><span><strong>Fresh recheck passed</strong><small>The frozen plan still passes every declared software rule.</small></span></div>}
        {recheckState === 'failed' && <div className="recheck-result fail" role="alert"><TriangleAlert size={16} /><span><strong>Fresh recheck did not pass</strong><small>{recheckError ?? 'Open the counterexample below. The sandbox remains blocked.'}</small></span></div>}
      </div>
      {sourceError && <div className="source-error" role="alert"><TriangleAlert size={15} />{sourceError}</div>}
      {verifierSource && <section className="verifier-source-panel" aria-labelledby="verifier-source-title">
        <div><Code2 size={16} /><span><strong id="verifier-source-title">Exact verifier source from this deployment</strong><small>The replay ZIP also includes this file as <code>VERIFIER-SOURCE.py</code>.</small></span><a href={api.verifierSourceUrl()} download="constellation-verifier.py"><Download size={13} />Download source</a></div>
        <pre><code>{verifierSource}</code></pre>
      </section>}
      <div className="evidence-grid">
        <div className="evidence-card">
          <Fingerprint size={17} />
          <span>Request fingerprint</span>
          <code>{shorten(mission?.intent?.canonical_digest)}</code>
          <small>If the request meaning changes, this fingerprint changes.</small>
        </div>
        <div className="evidence-card">
          <FileJson2 size={17} />
          <span>Scenario fingerprint</span>
          <code>{shorten(mission?.snapshot.sha256)}</code>
          <small>Identifies the exact simulated data that was checked.</small>
        </div>
        <div className="evidence-card">
          <Gauge size={17} />
          <span>Cortex engine measurement</span>
          <strong>{typeof cover?.engine_elapsed_ms === 'number' ? `${cover.engine_elapsed_ms} ms · ${((cover.engine_peak_rss_kb ?? 0) / 1024).toFixed(2)} MB` : cover?.certainty ?? 'Not submitted'}</strong>
          <small>{typeof cover?.engine_elapsed_ms === 'number' ? 'Engine time and peak RSS from this response' : 'Live engine metrics are not fabricated in local mode'}</small>
        </div>
        <div className={`evidence-card ${report?.verified ? 'pass' : report ? 'fail' : ''}`}>
          {report?.verified ? <Check size={17} /> : <TriangleAlert size={17} />}
          <span>Separate plan check</span>
          <strong>{report?.verified ? 'EVERY RULE PASSED' : report ? 'PLAN BLOCKED' : 'NOT CHECKED YET'}</strong>
          <small>A failed check prevents the sandbox update.</small>
        </div>
      </div>
      {report && <div className="checks" aria-label="Independent verification checks">
        {Object.entries(report.checks).map(([name, passed]) => (
          <div key={name} className={passed ? 'check-pass' : 'check-fail'} title={`Internal rule: ${name}`}>
            <span>{passed ? '✓' : '×'}</span>{checkLabels[name] ?? name.replaceAll('_', ' ')}
          </div>
        ))}
      </div>}
      {mission?.intent && <div className="paraphrase-proof">
        <Check size={14} />
        <span><strong>Five ways of saying the same request</strong> produced the same testable rules in this committed scenario.</span>
      </div>}
      {qap && <div className="topology-note">
        <ShieldCheck size={15} />
        <span>Compute placement check (QAP): <strong>{qap.certainty}</strong> · cost recomputed before acceptance · {qap.latency_ms ?? 0} ms</span>
      </div>}
      {report?.issues.map((issue) => (
        <div className="counterexample" key={issue.code}>
          <TriangleAlert size={17} /><div><strong>{issue.code}</strong><p>{issue.message}</p><code>{JSON.stringify(issue.witness)}</code></div>
        </div>
      ))}
      {mission?.artifacts.length ? <div className="artifact-list">
        <div className="artifact-title"><FileArchive size={14} /><strong>Files a judge can inspect and replay</strong><span>{mission.artifacts.length} checksummed files</span></div>
        {mission.artifacts.map((artifact) => <a href={api.artifactUrl(mission.id, artifact.name)} download key={artifact.name}>
          <FileJson2 size={13} /><span>{artifact.name}<small>{shorten(artifact.sha256)}</small></span><em>{bytes(artifact.size)}</em><Download size={13} />
        </a>)}
      </div> : null}
      <div className="evidence-links" aria-label="Learn about HexStellar Cortex">
        <div>
          <strong>New to Cortex?</strong>
          <span>Read the plain language documentation, then inspect the public command line client used by engineers.</span>
        </div>
        <a href={EXTERNAL_LINKS.cortexDocs} target="_blank" rel="noreferrer">
          <BookOpen size={14} /> How Cortex works <ExternalLink size={12} />
        </a>
        <a href={EXTERNAL_LINKS.cortexClient} target="_blank" rel="noreferrer">
          <Github size={14} /> Public CLI/client <ExternalLink size={12} />
        </a>
      </div>
      <details>
        <summary>Technical evidence for engineers</summary>
        <pre>{JSON.stringify({
          execution_mode: mission?.execution_mode,
          runtime_telemetry: mission?.runtime_telemetry,
          intent: mission?.intent,
          receipts: mission?.plan?.receipts,
          verification: report,
          limitation: 'Verified only for the committed simulation domain contract. No physical spacecraft safety or global optimality claim.',
        }, null, 2)}</pre>
      </details>
    </section>
  )
}
