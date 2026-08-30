import { Check, Circle, Download, Filter, LoaderCircle, X } from 'lucide-react'
import { useState } from 'react'
import { api } from '../api'
import type { Mission } from '../types'

type FilterMode = 'all' | 'gemini' | 'cortex' | 'verifier'
const filterLabels: Record<FilterMode, string> = {
  all: 'All steps',
  gemini: 'Gemini',
  cortex: 'Cortex',
  verifier: 'Checker',
}
const componentLabels: Record<string, string> = {
  'mission-coordinator': 'Coordinator',
  'gemini-adk': 'Gemini',
  'event-ingress': 'Failure event',
  'mission-kernel': 'Schedule builder',
  'cortex-adapter': 'Cortex',
  'independent-verifier': 'Separate checker',
  'artifact-store': 'Evidence builder',
  'cloud-tasks': 'Durable worker',
  'sandbox-mutation': 'Sandbox',
}

export function DecisionTrace({ mission, busy }: { mission?: Mission; busy: boolean }) {
  const [filter, setFilter] = useState<FilterMode>('all')
  const events = (mission?.audit ?? []).filter((event) => {
    if (filter === 'all') return true
    if (filter === 'gemini') return event.component.includes('gemini')
    if (filter === 'cortex') return event.component.includes('cortex')
    return event.component.includes('verifier')
  })
  return (
    <section className="panel trace-panel" aria-labelledby="trace-title">
      <div className="panel-heading trace-heading">
        <div><span className="eyebrow">Live run log</span><h2 id="trace-title">Watch the system do the work</h2></div>
        {mission && <a className="trace-download" href={api.logsUrl(mission.id)} download aria-label="Download full event log">
          <Download size={14} /> Download log
        </a>}
      </div>
      <p className="trace-intro">These are observable steps, timings, and receipts—not private model thoughts.</p>
      <div className="trace-controls" aria-label="Filter evidence events">
        <Filter size={12} />
        {(['all', 'gemini', 'cortex', 'verifier'] as FilterMode[]).map((item) => (
          <button className={filter === item ? 'active' : ''} onClick={() => setFilter(item)} key={item}>{filterLabels[item]}</button>
        ))}
      </div>
      <div className="trace-list" aria-live="polite">
        {events.map((event, index, all) => {
          const failed = event.status === 'failed' || event.type.includes('impossible')
          const current = busy && index === all.length - 1 && event.status === 'started'
          return <article className="trace-item" key={event.event_id}>
            <span className={`trace-icon ${failed ? 'failed' : event.status === 'completed' ? 'done' : ''}`}>
              {failed ? <X size={13} /> : current ? <LoaderCircle size={13} className="spin" /> : <Check size={13} />}
            </span>
            <div className="trace-copy">
              <strong>{event.message}</strong>
              <small title={`Internal component: ${event.component}`}>{componentLabels[event.component] ?? event.component} · {new Date(event.at).toLocaleTimeString()}</small>
              <div className="trace-meta">
                <code>#{String(event.sequence).padStart(2, '0')}</code>
                {event.duration_ms !== undefined && <span>{event.duration_ms} ms</span>}
                {event.retry_count > 0 && <span>{event.retry_count} retries</span>}
                {event.certainty && <span>{event.certainty}</span>}
              </div>
            </div>
          </article>
        })}
        {!mission && <div className="trace-item"><span className="trace-icon"><Circle size={11} /></span><div className="trace-copy"><strong>Waiting for the recovery demo</strong><small>Each safe, public step will appear here as it happens.</small></div></div>}
      </div>
      {mission && <div className="correlation-strip"><span>Run ID for matching cloud logs</span><code>{mission.correlation_id}</code></div>}
    </section>
  )
}
