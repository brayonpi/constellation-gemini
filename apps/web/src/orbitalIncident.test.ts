import { describe, expect, it } from 'vitest'
import {
  AVOIDANCE_MAX_OFFSET,
  affectedComputeSatelliteIds,
  avoidanceManeuverOffset,
  classifySatelliteIncident,
  encounterFrame,
  incidentCameraMode,
  PRIMARY_IMPACT_SATELLITE_ID,
} from './orbitalIncident'

describe('orbital incident classification', () => {
  const affected = affectedComputeSatelliteIds([
    'GS-PACIFIC-02',
    'COMPUTE-SAT-07',
    'COMPUTE-SAT-08',
  ])

  it('marks only the declared impact target as struck', () => {
    expect(PRIMARY_IMPACT_SATELLITE_ID).toBe('SAT-07')
    expect(classifySatelliteIncident('SAT-07', affected)).toBe('impact')
  })

  it('keeps the secondary compute node stable and isolated', () => {
    expect(classifySatelliteIncident('SAT-08', affected)).toBe('isolated')
  })

  it('keeps unaffected satellites healthy', () => {
    expect(classifySatelliteIncident('SAT-03', affected)).toBe('healthy')
  })

  it('moves through one deterministic cinematic camera sequence', () => {
    expect(incidentCameraMode(0, true, false)).toBe('arming')
    expect(incidentCameraMode(0.8, true, true)).toBe('debris-pov')
    expect(incidentCameraMode(2.4, true, true)).toBe('impact')
    expect(incidentCameraMode(3.2, true, true)).toBe('impact')
    expect(incidentCameraMode(4.8, true, true)).toBe('returning')
    expect(incidentCameraMode(8.6, true, true)).toBe('returning')
    expect(incidentCameraMode(10.8, true, true)).toBe('overview')
    expect(incidentCameraMode(0.8, false, true)).toBe('overview')
  })

  it('moves gradually before the encounter and remains on the checked trajectory', () => {
    expect(avoidanceManeuverOffset(1)).toBe(0)
    expect(avoidanceManeuverOffset(1.2)).toBeGreaterThan(0)
    expect(avoidanceManeuverOffset(1.2)).toBeLessThan(avoidanceManeuverOffset(1.8))
    expect(avoidanceManeuverOffset(2.2)).toBe(AVOIDANCE_MAX_OFFSET)
    expect(avoidanceManeuverOffset(5)).toBe(AVOIDANCE_MAX_OFFSET)
    expect(avoidanceManeuverOffset(8.6)).toBe(AVOIDANCE_MAX_OFFSET)
  })

  it.each([
    [0, 'establish'],
    [0.55, 'pursuit'],
    [0.9, 'pursuit'],
    [1, 'decision'],
    [1.65, 'decision'],
    [2.4, 'encounter'],
    [3.8, 'encounter'],
    [5, 'aftermath'],
    [6.2, 'aftermath'],
    [8.6, 'return'],
    [10.8, 'overview'],
  ])('resolves %.2f seconds to the %s phase', (time, phase) => {
    expect(encounterFrame(time).phase).toBe(phase)
  })
})
