import {
  BookOpen,
  Check,
  Download,
  ExternalLink,
  FileArchive,
  FileJson2,
  Fingerprint,
  Gauge,
  Github,
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

export function EvidenceRoom({ mission }: { mission?: Mission }) {
  const report = mission?.plan?.verification_report
  const cover = mission?.plan?.receipts.find((receipt) => receipt.command === 'cover')
  const qap = mission?.plan?.receipts.find((receipt) => receipt.command === 'qap')
  return (
    <section className="panel evidence-panel" aria-labelledby="evidence-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Evidence room</span>
          <h2 id="evidence-title">Download the proof, not just the pitch</h2>
        </div>
        {mission?.artifacts.some((item) => item.name === 'mission-replay.zip') && (
          <a className="ghost-button" href={api.bundleUrl(mission.id)} download>
            <Download size={15} /> Replay ZIP
          </a>
        )}
      </div>
      <p className="evidence-intro">
        A fingerprint identifies the exact request and scenario that were checked. The replay ZIP lets a judge
        rerun the independent checker without Gemini, Cortex, or an internet connection.
      </p>
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
          <span>Cortex search result</span>
          <strong>{cover?.certainty ?? 'Not submitted'}</strong>
          <small>{cover?.latency_ms !== undefined ? `${cover.latency_ms} ms in this run · ${cover.effort}` : 'Waiting for a run'}</small>
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
          <span>Read the plain-language documentation, then inspect the public CLI/client used by engineers.</span>
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
          intent: mission?.intent,
          receipts: mission?.plan?.receipts,
          verification: report,
          limitation: 'Verified only for the committed simulation-domain contract; no physical spacecraft safety or global optimality claim.',
        }, null, 2)}</pre>
      </details>
    </section>
  )
}
