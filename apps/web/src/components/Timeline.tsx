import type { Mission } from '../types'

const colors: Record<string, string> = {
  compute: '#2f6df4',
  downlink: '#7558e8',
  health: '#1ba97f',
  transfer: '#e7a42b',
}

export function Timeline({ mission }: { mission?: Mission }) {
  const selected = new Set(mission?.plan?.selected_bundle_ids ?? [])
  const actions = mission?.bundles.filter((bundle) => selected.has(bundle.id)).flatMap((bundle) => bundle.actions) ?? []
  const fallback = mission?.snapshot.existing_schedule ?? []
  const shown = actions.length ? actions : fallback
  const horizon = mission?.snapshot.horizon_minutes ?? 180
  const rows = Array.from(new Set(shown.map((action) => action.satellite_id))).sort()

  return (
    <section className="panel timeline-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Mission timeline</span>
          <h2>{actions.length ? 'Recovered schedule' : 'Nominal schedule'}</h2>
        </div>
        <div className="legend">
          {Object.entries(colors).slice(0, 3).map(([kind, color]) => <span key={kind}><i style={{ background: color }} />{kind}</span>)}
        </div>
      </div>
      <div className="timeline-scale"><span>00:00</span><span>+60m</span><span>+120m</span><span>+180m</span></div>
      <div className="timeline-grid">
        {rows.length === 0 && <div className="timeline-empty">Launch the mission to construct a schedule.</div>}
        {rows.map((row) => (
          <div className="timeline-row" key={row}>
            <strong>{row}</strong>
            <div className="timeline-track">
              {shown.filter((action) => action.satellite_id === row).map((action) => (
                <div
                  className="timeline-action"
                  key={action.id}
                  title={`${action.kind}: ${action.interval.start}–${action.interval.end} min`}
                  style={{
                    left: `${(action.interval.start / horizon) * 100}%`,
                    width: `${Math.max(2.6, ((action.interval.end - action.interval.start) / horizon) * 100)}%`,
                    background: colors[action.kind],
                  }}
                ><span>{action.kind[0].toUpperCase()}</span></div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
