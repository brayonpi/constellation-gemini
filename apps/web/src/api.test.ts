import { describe, expect, it } from 'vitest'
import { appendEvent } from './api'
import { testMission } from './testMission'

describe('appendEvent', () => {
  it('deduplicates by event id and preserves monotonic display order', () => {
    const mission = testMission()
    const duplicate = mission.audit[0]
    expect(appendEvent(mission, duplicate)).toBe(mission)

    const appended = appendEvent(mission, {
      ...duplicate,
      event_id: 'event-zero',
      sequence: 0,
      message: 'Earlier durable event',
    })
    expect(appended.audit.map((event) => event.sequence)).toEqual([0, 1, 2])
    expect(appended.audit[0].message).toBe('Earlier durable event')
  })
})
