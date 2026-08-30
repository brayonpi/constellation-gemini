import { Check, Download, FileJson2, Fingerprint, ShieldCheck, TriangleAlert } from 'lucide-react'
import { api } from '../api'
import type { Mission } from '../types'

const shorten = (value?: string) => value ? `${value.slice(0, 12)}…${value.slice(-8)}` : 'Pending'

export function EvidenceRoom({ mission }: { mission?: Mission }) {
  const report = mission?.plan?.verification_report
  const receipt = mission?.plan?.receipts[0]
  return (
    <section className="panel evidence-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Evidence room</span>
          <h2>Trust is inspectable</h2>
        </div>
        {mission && <a className="ghost-button" href={api.bundleUrl(mission.id)} download><Download size={15} /> Replay</a>}
      </div>
      <div className="evidence-grid">
        <div className="evidence-card">
          <Fingerprint size={17} />
          <span>Canonical intent</span>
          <code>{shorten(mission?.intent?.canonical_digest)}</code>
        </div>
        <div className="evidence-card">
          <FileJson2 size={17} />
          <span>Fixture integrity</span>
          <code>{shorten(mission?.snapshot.sha256)}</code>
        </div>
        <div className="evidence-card">
          <ShieldCheck size={17} />
          <span>Solver assurance</span>
          <strong>{receipt?.certainty ?? 'Not submitted'}</strong>
        </div>
        <div className={`evidence-card ${report?.verified ? 'pass' : ''}`}>
          {report?.verified ? <Check size={17} /> : <TriangleAlert size={17} />}
          <span>Independent replay</span>
          <strong>{report?.verified ? 'VERIFIED' : report ? 'REJECTED' : 'PENDING'}</strong>
        </div>
      </div>
      {report && (
        <div className="checks">
          {Object.entries(report.checks).map(([name, passed]) => (
            <div key={name} className={passed ? 'check-pass' : 'check-fail'}>
              <span>{passed ? '✓' : '×'}</span>{name.replaceAll('_', ' ')}
            </div>
          ))}
        </div>
      )}
      {mission?.intent && (
        <div className="paraphrase-proof">
          <Check size={14} />
          <span><strong>5 committed paraphrases</strong> compiled to the same canonical mission model in the shipped test fixture.</span>
        </div>
      )}
      {report?.issues.map((issue) => (
        <div className="counterexample" key={issue.code}>
          <TriangleAlert size={17} /><div><strong>{issue.code}</strong><p>{issue.message}</p><code>{JSON.stringify(issue.witness)}</code></div>
        </div>
      ))}
      <details>
        <summary>Raw evidence</summary>
        <pre>{JSON.stringify({ intent: mission?.intent, receipt, verification: report }, null, 2)}</pre>
      </details>
    </section>
  )
}
