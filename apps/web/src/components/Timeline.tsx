import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { BatteryCharging, Database, RadioTower } from 'lucide-react'
import type { Action, Mission, MissionView } from '../types'

const colors: Record<Action['kind'], string> = {
  compute: '#5b8cff',
  downlink: '#a584ff',
  health: '#53d6a5',
  transfer: '#f6b957',
}
const actionLabels: Record<Action['kind'], string> = {
  compute: 'run job',
  downlink: 'send data',
  health: 'health check',
  transfer: 'move data',
}
const viewLabels: Record<MissionView, string> = {
  nominal: 'before failure',
  incident: 'failure impact',
  recovered: 'new plan',
  diff: 'what changed',
}

type TimelineAction = Action & { source: 'nominal' | 'recovered' }

export function Timeline({ mission, view }: { mission?: Mission; view: MissionView }) {
  const [focused, setFocused] = useState<TimelineAction>()
  const selected = new Set(mission?.plan?.selected_bundle_ids ?? [])
  const nominal: TimelineAction[] = (mission?.snapshot.existing_schedule ?? []).map((action) => ({
    ...action, source: 'nominal',
  }))
  const recovered: TimelineAction[] = (
    mission?.bundles.filter((bundle) => selected.has(bundle.id)).flatMap((bundle) => bundle.actions) ?? []
  ).map((action) => ({ ...action, source: 'recovered' }))
  const shown = view === 'nominal' || view === 'incident'
    ? nominal
    : view === 'diff'
      ? [...nominal, ...recovered]
      : recovered.length ? recovered : nominal
  const horizon = mission?.snapshot.horizon_minutes ?? 180
  const ticks = useMemo(() => Array.from({ length: 5 }, (_, index) => Math.round((horizon / 4) * index)), [horizon])
  const satelliteRows = Array.from(new Set(shown.map((action) => action.satellite_id))).sort()
  const stationRows = Array.from(new Set(shown.flatMap((action) => action.station_id ? [action.station_id] : []))).sort()
  const rows = [
    ...satelliteRows.map((id) => ({ id, label: id, type: 'satellite' as const })),
    ...stationRows.map((id) => ({ id: `station:${id}`, label: id, type: 'station' as const })),
  ]
  const rowActions = (row: (typeof rows)[number]) => shown.filter((action) => (
    row.type === 'satellite' ? action.satellite_id === row.id : action.station_id === row.label
  ))
  const selectedBundles = mission?.bundles.filter((bundle) => selected.has(bundle.id)) ?? []
  const finalEnergy = selectedBundles.length
    ? Math.min(...selectedBundles.map((bundle) => bundle.energy_trajectory.at(-1) ?? 0))
    : undefined
  const peakStorage = selectedBundles.length
    ? Math.max(...selectedBundles.flatMap((bundle) => bundle.storage_trajectory))
    : undefined

  return (
    <section className="panel timeline-panel" aria-labelledby="timeline-title">
      <div className="panel-heading timeline-heading">
        <div>
          <span className="eyebrow">Minute by minute checked schedule · {viewLabels[view]}</span>
          <h2 id="timeline-title">{view === 'diff' ? 'Before and after: every changed reservation' : `The ${viewLabels[view]} schedule`}</h2>
        </div>
        <div className="timeline-metrics" aria-label="Selected plan resource summary">
          <span><BatteryCharging size={13} /> Lowest energy left <strong>{finalEnergy ?? 'Not available'}</strong></span>
          <span><Database size={13} /> Most storage used <strong>{peakStorage ?? 'Not available'}</strong></span>
          <span><RadioTower size={13} /> Stations used <strong>{stationRows.length}</strong></span>
        </div>
      </div>
      <p className="timeline-explainer">Each bar reserves time on one satellite or station. Two incompatible bars on the same resource would block the plan.</p>
      <div className="timeline-legend">
        {(Object.entries(colors) as Array<[Action['kind'], string]>).map(([kind, color]) => (
          <span key={kind}><i style={{ background: color }} />{actionLabels[kind]}</span>
        ))}
        {view === 'diff' && <>
          <span><i className="outline-key" />before failure</span><span><i className="solid-key" />new plan</span>
        </>}
      </div>
      <div className="timeline-scale" style={{ marginLeft: 116 }}>
        {ticks.map((tick) => <span key={tick}>+{tick}m</span>)}
      </div>
      <div className="timeline-grid">
        {rows.length === 0 && <div className="timeline-empty">Launch the mission to construct the schedule.</div>}
        {rows.map((row) => (
          <div className="timeline-row" key={row.id}>
            <strong>{row.label}<small>{row.type}</small></strong>
            <div className="timeline-track">
              {rowActions(row).map((action) => (
                <button
                  className={`timeline-action source-${action.source}`}
                  key={`${action.source}-${action.id}-${row.id}`}
                  aria-label={`${actionLabels[action.kind]} on ${row.label}, minute ${action.interval.start} to ${action.interval.end}`}
                  onClick={() => setFocused(action)}
                  style={{
                    left: `${(action.interval.start / horizon) * 100}%`,
                    width: `${Math.max(2.4, ((action.interval.end - action.interval.start) / horizon) * 100)}%`,
                    '--action-color': colors[action.kind],
                  } as CSSProperties}
                ><span>{action.kind.slice(0, 1).toUpperCase()}</span></button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {focused && <div className="timeline-inspector" role="status">
        <div><span>Schedule item</span><strong>{focused.id}</strong></div>
        <div><span>Reserved minutes</span><strong>{focused.interval.start} to {focused.interval.end} min</strong></div>
        <div><span>Resource</span><strong>{focused.station_id ?? focused.satellite_id}</strong></div>
        <div><span>Resource change</span><strong>{focused.energy_delta} energy · {focused.storage_delta} MB storage</strong></div>
        <button onClick={() => setFocused(undefined)}>Close</button>
      </div>}
    </section>
  )
}
