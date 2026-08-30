import {
  Check,
  Download,
  FileArchive,
  FileJson2,
  Fingerprint,
  Gauge,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react'
import { api } from '../api'
import type { Mission } from '../types'

const shorten = (value?: string) => value ? `${value.slice(0, 12)}…${value.slice(-8)}` : 'Pending'
const bytes = (size: number) => size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`

export function EvidenceRoom({ mission }: { mission?: Mission }) {
  const report = mission?.plan?.verification_report
  const cover = mission?.plan?.receipts.find((receipt) => receipt.command === 'cover')
  const qap = mission?.plan?.receipts.find((receipt) => receipt.command === 'qap')
  return (
    <section className="panel evidence-panel" aria-labelledby="evidence-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Evidence room</span>
          <h2 id="evidence-title">Trust is inspectable</h2>
        </div>
        {mission?.artifacts.some((item) => item.name === 'mission-replay.zip') && (
          <a className="ghost-button" href={api.bundleUrl(mission.id)} download>
            <Download size={15} /> Replay ZIP
          </a>
        )}
      </div>
      <div className="evidence-grid">
        <div className="evidence-card">
          <Fingerprint size={17} />
          <span>Canonical intent</span>
          <code>{shorten(mission?.intent?.canonical_digest)}</code>
          <small>{mission?.intent?.live_interpretation ? 'Gemini live' : 'Explicit fixture fallback'}</small>
        </div>
        <div className="evidence-card">
          <FileJson2 size={17} />
          <span>Fixture integrity</span>
          <code>{shorten(mission?.snapshot.sha256)}</code>
          <small>{mission?.snapshot.dataset_provenance.license ?? 'Awaiting mission'}</small>
        </div>
        <div className="evidence-card">
          <Gauge size={17} />
          <span>Cortex cover</span>
          <strong>{cover?.certainty ?? 'Not submitted'}</strong>
          <small>{cover?.latency_ms !== undefined ? `${cover.latency_ms} ms · ${cover.effort}` : 'Operational telemetry only'}</small>
        </div>
        <div className={`evidence-card ${report?.verified ? 'pass' : report ? 'fail' : ''}`}>
          {report?.verified ? <Check size={17} /> : <TriangleAlert size={17} />}
          <span>Independent replay</span>
          <strong>{report?.verified ? 'VERIFIED' : report ? 'REJECTED' : 'PENDING'}</strong>
          <small>{mission?.execution_mode?.replaceAll('_', ' ') ?? 'No run'}</small>
        </div>
      </div>
      {report && <div className="checks" aria-label="Independent verification checks">
        {Object.entries(report.checks).map(([name, passed]) => (
          <div key={name} className={passed ? 'check-pass' : 'check-fail'}>
            <span>{passed ? '✓' : '×'}</span>{name.replaceAll('_', ' ')}
          </div>
        ))}
      </div>}
      {mission?.intent && <div className="paraphrase-proof">
        <Check size={14} />
        <span><strong>Five committed paraphrases</strong> converge for this golden mission fixture. This is not a universal language claim.</span>
      </div>}
      {qap && <div className="topology-note">
        <ShieldCheck size={15} />
        <span>QAP refinement: <strong>{qap.certainty}</strong> · recomputed before admission · {qap.latency_ms ?? 0} ms</span>
      </div>}
      {report?.issues.map((issue) => (
        <div className="counterexample" key={issue.code}>
          <TriangleAlert size={17} /><div><strong>{issue.code}</strong><p>{issue.message}</p><code>{JSON.stringify(issue.witness)}</code></div>
        </div>
      ))}
      {mission?.artifacts.length ? <div className="artifact-list">
        <div className="artifact-title"><FileArchive size={14} /><strong>Replay artifacts</strong><span>{mission.artifacts.length} immutable files</span></div>
        {mission.artifacts.map((artifact) => <a href={api.artifactUrl(mission.id, artifact.name)} download key={artifact.name}>
          <FileJson2 size={13} /><span>{artifact.name}<small>{shorten(artifact.sha256)}</small></span><em>{bytes(artifact.size)}</em><Download size={13} />
        </a>)}
      </div> : null}
      <details>
        <summary>Raw evidence and declared boundary</summary>
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
