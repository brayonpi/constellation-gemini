export type Interval = { start: number; end: number }

export type Action = {
  id: string
  kind: 'compute' | 'downlink' | 'health' | 'transfer'
  satellite_id: string
  interval: Interval
  job_id?: string
  station_id?: string
}

export type Bundle = {
  id: string
  satellite_id: string
  actions: Action[]
  obligations_covered: string[]
  costs: { disruption: number; delay: number; migration: number }
  local_verification_digest: string
}

export type AuditEvent = {
  sequence: number
  type: string
  message: string
  at: string
  metadata: Record<string, unknown>
}

export type Mission = {
  id: string
  name: string
  status: string
  snapshot: {
    sha256: string
    horizon_minutes: number
    satellites: Array<{ id: string; orbit_phase_deg: number; isolated: boolean }>
    ground_stations: Array<{ id: string; latitude: number; longitude: number }>
    links: Array<{ source: string; target: string }>
    existing_schedule: Action[]
    dataset_provenance: {
      name: string
      license: string
      derived_sha256: string
    }
  }
  intent?: {
    canonical_digest: string
    hard_constraints: Array<{ kind: string; subject: string; value: unknown }>
    objective_order: string[]
    unresolved_ambiguities: string[]
    live_interpretation: boolean
    gemini_model_id: string
  }
  telemetry: Array<{ event_id: string; affected_resources: string[] }>
  bundles: Bundle[]
  plan?: {
    selected_bundle_ids: string[]
    postponed_jobs: string[]
    uncovered_obligations: string[]
    certainty: string
    apply_status: string
    receipts: Array<{ request_id: string; model: string; certainty: string; receipt: Record<string, unknown> }>
    verification_report?: {
      verified: boolean
      assurance: string
      checks: Record<string, boolean>
      issues: Array<{ code: string; message: string; witness: Record<string, unknown> }>
      plan_digest: string
      input_digest: string
    }
  }
  audit: AuditEvent[]
}
