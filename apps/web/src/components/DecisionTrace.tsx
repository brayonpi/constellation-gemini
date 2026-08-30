import { Check, Circle, Download, Filter, LoaderCircle, X } from 'lucide-react'
import { useState } from 'react'
import { api } from '../api'
import type { Mission } from '../types'

type FilterMode = 'all' | 'gemini' | 'cortex' | 'verifier'

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
        <div><span className="eyebrow">Evidence stream</span><h2 id="trace-title">Observable action — not hidden reasoning</h2></div>
        {mission && <a className="icon-button" href={api.logsUrl(mission.id)} download aria-label="Download event log">
          <Download size={14} />
        </a>}
      </div>
      <div className="trace-controls" aria-label="Filter evidence events">
        <Filter size={12} />
        {(['all', 'gemini', 'cortex', 'verifier'] as FilterMode[]).map((item) => (
          <button className={filter === item ? 'active' : ''} onClick={() => setFilter(item)} key={item}>{item}</button>
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
              <small>{event.component} · {new Date(event.at).toLocaleTimeString()}</small>
              <div className="trace-meta">
                <code>#{String(event.sequence).padStart(2, '0')}</code>
                {event.duration_ms !== undefined && <span>{event.duration_ms} ms</span>}
                {event.retry_count > 0 && <span>{event.retry_count} retries</span>}
                {event.certainty && <span>{event.certainty}</span>}
              </div>
            </div>
          </article>
        })}
        {!mission && <div className="trace-item"><span className="trace-icon"><Circle size={11} /></span><div className="trace-copy"><strong>Waiting for mission launch</strong><small>Sanitized state transitions will stream here.</small></div></div>}
      </div>
      {mission && <div className="correlation-strip"><span>Correlation</span><code>{mission.correlation_id}</code></div>}
    </section>
  )
}
