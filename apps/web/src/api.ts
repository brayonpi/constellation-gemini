import type { Mission } from './types'

const headers = { 'Content-Type': 'application/json' }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }))
    throw new Error(body.detail ?? `Request failed with HTTP ${response.status}`)
  }
  return response.json() as Promise<T>
}

const key = (prefix: string) => `${prefix}-${crypto.randomUUID()}`

export const api = {
  health: () => request<{ mode: string; gemini_live: boolean; cortex_live: boolean }>('/api/v1/health'),
  create: () => request<Mission>('/api/v1/missions', {
    method: 'POST', headers, body: JSON.stringify({ name: 'Orbital resilience mission', fixture: 'demo-12', idempotency_key: key('create') }),
  }),
  intent: (missionId: string, text: string) => request<Mission>(`/api/v1/missions/${missionId}/intent`, {
    method: 'POST', headers, body: JSON.stringify({ text, idempotency_key: key('intent') }),
  }),
  event: (missionId: string) => request<Mission>(`/api/v1/missions/${missionId}/events`, {
    method: 'POST',
    headers: { ...headers, 'Idempotency-Key': key('event') },
    body: JSON.stringify({
      event_id: `GROUND-OUTAGE-${missionId.slice(0, 8)}`,
      event_type: 'compound_orbital_compute_failure',
      affected_resources: ['GS-PACIFIC-02', 'COMPUTE-SAT-07', 'COMPUTE-SAT-08'],
      start_minute: 5,
      expected_duration_minutes: 42,
      confidence: 1,
      source: 'pubsub-demo-ingress',
    }),
  }),
  clarify: (missionId: string) => request<Mission>(`/api/v1/missions/${missionId}/clarifications`, {
    method: 'POST', headers, body: JSON.stringify({ answer: 'urgent_deadline', idempotency_key: key('clarify') }),
  }),
  plan: async (missionId: string) => {
    let mission = await request<Mission>(`/api/v1/missions/${missionId}/plan`, {
      method: 'POST', headers, body: JSON.stringify({ idempotency_key: key('plan') }),
    })
    for (let attempt = 0; mission.status === 'planning' && attempt < 120; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      mission = await request<Mission>(`/api/v1/missions/${missionId}`)
    }
    return mission
  },
  apply: (missionId: string) => request<Mission>(`/api/v1/missions/${missionId}/apply-sandbox`, {
    method: 'POST', headers, body: JSON.stringify({ idempotency_key: key('apply') }),
  }),
  bundleUrl: (missionId: string) => `/api/v1/missions/${missionId}/bundle`,
}
