import { Check, Circle, LoaderCircle, X } from 'lucide-react'
import type { Mission } from '../types'

export function DecisionTrace({ mission, busy }: { mission?: Mission; busy: boolean }) {
  return (
    <section className="panel trace-panel">
      <div className="panel-heading">
        <div><span className="eyebrow">Decision trace</span><h2>What happened — not hidden reasoning</h2></div>
      </div>
      <div className="trace-list">
        {(mission?.audit ?? []).map((event, index, all) => {
          const failed = event.type.includes('failed') || event.type.includes('impossible')
          const current = busy && index === all.length - 1
          return <div className="trace-item" key={event.sequence}>
            <span className={`trace-icon ${failed ? 'failed' : 'done'}`}>
              {failed ? <X size={13} /> : current ? <LoaderCircle size={13} className="spin" /> : <Check size={13} />}
            </span>
            <div><strong>{event.message}</strong><small>{event.type} · {new Date(event.at).toLocaleTimeString()}</small></div>
          </div>
        })}
        {!mission && <div className="trace-item"><span className="trace-icon"><Circle size={11} /></span><div><strong>Waiting for mission launch</strong><small>The audit trail will appear here.</small></div></div>}
      </div>
    </section>
  )
}
