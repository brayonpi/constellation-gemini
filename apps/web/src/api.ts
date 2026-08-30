import type { AuditEvent, Health, Mission } from './types'

const jsonHeaders = { 'Content-Type': 'application/json' }
const key = (prefix: string) => `${prefix}-${crypto.randomUUID()}`

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }))
    throw new Error(body.detail ?? `Request failed with HTTP ${response.status}`)
  }
  return response.json() as Promise<T>
}

function mutation(idempotencyKey: string, body: Record<string, unknown>): RequestInit {
  return {
    method: 'POST',
    headers: { ...jsonHeaders, 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ ...body, idempotency_key: idempotencyKey }),
  }
}

export const api = {
  health: () => request<Health>('/api/v1/health'),
  get: (missionId: string) => request<Mission>(`/api/v1/missions/${missionId}`),
  create: () => {
    const idempotencyKey = key('create')
    return request<Mission>('/api/v1/missions', mutation(idempotencyKey, {
      name: 'Orbital resilience mission', fixture: 'demo-12',
    }))
  },
  intent: (missionId: string, text: string) => {
    const idempotencyKey = key('intent')
    return request<Mission>(`/api/v1/missions/${missionId}/intent`, mutation(idempotencyKey, { text }))
  },
  event: (missionId: string) => {
    const idempotencyKey = key('event')
    return request<Mission>(`/api/v1/missions/${missionId}/events`, {
      method: 'POST',
      headers: { ...jsonHeaders, 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({
        event_id: `GROUND-OUTAGE-${missionId.slice(0, 8)}`,
        event_type: 'compound_orbital_compute_failure',
        affected_resources: ['GS-PACIFIC-02', 'COMPUTE-SAT-07', 'COMPUTE-SAT-08'],
        start_minute: 5,
        expected_duration_minutes: 42,
        confidence: 1,
        source: 'public-sandbox-demo',
      }),
    })
  },
  clarify: (missionId: string, answer: 'urgent_deadline' | 'noncritical_downlinks') => {
    const idempotencyKey = key('clarify')
    return request<Mission>(
      `/api/v1/missions/${missionId}/clarifications`,
      mutation(idempotencyKey, { answer }),
    )
  },
  plan: (missionId: string) => {
    const idempotencyKey = key('plan')
    return request<Mission>(`/api/v1/missions/${missionId}/plan`, mutation(idempotencyKey, {}))
  },
  verify: (missionId: string) => {
    const idempotencyKey = key('verify')
    return request<Mission>(`/api/v1/missions/${missionId}/verify`, mutation(idempotencyKey, {}))
  },
  apply: (missionId: string) => {
    const idempotencyKey = key('apply')
    return request<Mission>(`/api/v1/missions/${missionId}/apply-sandbox`, mutation(idempotencyKey, {}))
  },
  eventsUrl: (missionId: string) => `/api/v1/missions/${missionId}/events`,
  bundleUrl: (missionId: string) => `/api/v1/missions/${missionId}/bundle`,
  logsUrl: (missionId: string) => `/api/v1/missions/${missionId}/logs`,
  artifactUrl: (missionId: string, name: string) => (
    `/api/v1/missions/${missionId}/artifacts/${encodeURIComponent(name)}`
  ),
}

export function appendEvent(mission: Mission, event: AuditEvent): Mission {
  if (mission.audit.some((existing) => existing.event_id === event.event_id)) return mission
  return { ...mission, audit: [...mission.audit, event].sort((a, b) => a.sequence - b.sequence) }
}
