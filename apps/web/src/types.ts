export type Interval = { start: number; end: number }

export type Action = {
  id: string
  kind: 'compute' | 'downlink' | 'health' | 'transfer'
  satellite_id: string
  interval: Interval
  job_id?: string
  station_id?: string
  energy_delta: number
  storage_delta: number
}

export type Bundle = {
  id: string
  satellite_id: string
  actions: Action[]
  obligations_covered: string[]
  resources_used: string[]
  energy_trajectory: number[]
  storage_trajectory: number[]
  costs: { disruption: number; delay: number; migration: number }
  local_verification_digest: string
}

export type AuditEvent = {
  sequence: number
  event_id: string
  type: string
  message: string
  at: string
  mission_id?: string
  run_id?: string
  correlation_id?: string
  component: string
  status: 'started' | 'completed' | 'failed' | 'info'
  duration_ms?: number
  input_digest?: string
  output_digest?: string
  artifact_refs: string[]
  retry_count: number
  certainty?: string
  metadata: Record<string, unknown>
}

export type Artifact = {
  name: string
  content_type: string
  size: number
  sha256: string
  provenance: string
  storage_uri: string
}

export type Mission = {
  id: string
  name: string
  status: string
  version: number
  run_id: string
  correlation_id: string
  execution_mode: 'live' | 'local_deterministic' | 'offline_precomputed' | 'degraded_fixture'
  applied_plan_digest?: string
  snapshot: {
    sha256: string
    horizon_minutes: number
    satellites: Array<{
      id: string
      orbit_phase_deg: number
      isolated: boolean
      energy_capacity: number
      storage_capacity: number
    }>
    ground_stations: Array<{ id: string; latitude: number; longitude: number; offline_intervals: Interval[] }>
    links: Array<{ source: string; target: string; unavailable_intervals: Interval[] }>
    contact_windows: Array<{ id: string; satellite_id: string; station_id: string; interval: Interval }>
    jobs: Array<{ id: string; criticality: string; deadline: number }>
    existing_schedule: Action[]
    dataset_provenance: {
      name: string
      source_url: string
      license: string
      version: string
      derived_sha256: string
      transformation_manifest: string
    }
  }
  intent?: {
    canonical_digest: string
    hard_constraints: Array<{ kind: string; subject: string; value: unknown; source: string }>
    soft_preferences: Array<{ kind: string; subject: string; value: unknown; source: string }>
    objective_order: string[]
    unresolved_ambiguities: string[]
    live_interpretation: boolean
    gemini_model_id: string
    interaction_id?: string
    duration_ms?: number
    usage_metadata: Record<string, unknown>
    fallback_reason?: string
  }
  telemetry: Array<{ event_id: string; affected_resources: string[]; event_type: string }>
  bundles: Bundle[]
  plan?: {
    selected_bundle_ids: string[]
    compute_placement?: number[]
    postponed_jobs: string[]
    uncovered_obligations: string[]
    certainty: string
    apply_status: string
    objective_components: { disruption: number; delay: number; migration: number }
    receipts: Array<{
      request_id: string
      model: string
      certainty: string
      effort?: string
      command?: 'cover' | 'qap'
      request_digest?: string
      response_digest?: string
      latency_ms?: number
      retry_count: number
      receipt: Record<string, unknown>
    }>
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
  artifacts: Artifact[]
}

export type Health = {
  status: string
  mode: string
  role: string
  gemini_live: boolean
  cortex_live: boolean
  simulation: boolean
}

export type MissionView = 'nominal' | 'incident' | 'recovered' | 'diff'
