export type SatelliteIncidentRole = 'impact' | 'isolated' | 'healthy'
export type IncidentCameraMode = 'arming' | 'debris-pov' | 'impact' | 'returning' | 'overview'
export type CinematicPhase = 'establish' | 'pursuit' | 'decision' | 'encounter' | 'aftermath' | 'return' | 'overview'
export type RenderQuality = 'cinematic' | 'balanced' | 'safe'

export interface EncounterFrame {
  sequenceTime: number
  phase: CinematicPhase
  cameraProgress: number
  debrisProgress: number
  maneuverProgress: number
  aftermathProgress: number
}

export interface GlobeInteractionState {
  mode: 'automatic' | 'manual'
  zoomEnabled: boolean
  interactionActive: boolean
}

export const PRIMARY_IMPACT_SATELLITE_ID = 'SAT-07'
export const ESTABLISH_UNTIL_SECONDS = 0.55
export const PURSUIT_UNTIL_SECONDS = 1
export const IMPACT_AT_SECONDS = 2.2
export const IMPACT_HOLD_UNTIL_SECONDS = 4.6
export const AFTERMATH_UNTIL_SECONDS = 6.4
export const IMPACT_CAMERA_RETURN_UNTIL_SECONDS = 10.8
export const AVOIDANCE_MAX_OFFSET = 0.38

export function affectedComputeSatelliteIds(resources: string[]): Set<string> {
  return new Set(
    resources
      .filter((resource) => resource.startsWith('COMPUTE-'))
      .map((resource) => resource.replace('COMPUTE-', '')),
  )
}

export function classifySatelliteIncident(
  satelliteId: string,
  affectedSatelliteIds: ReadonlySet<string>,
): SatelliteIncidentRole {
  if (!affectedSatelliteIds.has(satelliteId)) return 'healthy'
  return satelliteId === PRIMARY_IMPACT_SATELLITE_ID ? 'impact' : 'isolated'
}

export function incidentCameraMode(
  sequenceTime: number,
  enabled: boolean,
  hasSample: boolean,
): IncidentCameraMode {
  if (!enabled) return 'overview'
  if (!hasSample) return 'arming'
  if (sequenceTime < IMPACT_AT_SECONDS) return 'debris-pov'
  if (sequenceTime < IMPACT_HOLD_UNTIL_SECONDS) return 'impact'
  if (sequenceTime < IMPACT_CAMERA_RETURN_UNTIL_SECONDS) return 'returning'
  return 'overview'
}

function smootherStep01(value: number): number {
  const clamped = Math.min(1, Math.max(0, value))
  return clamped * clamped * clamped * (clamped * (clamped * 6 - 15) + 10)
}

export function encounterFrame(sequenceTime: number): EncounterFrame {
  const time = Math.max(0, sequenceTime)
  const phase: CinematicPhase = time < ESTABLISH_UNTIL_SECONDS
    ? 'establish'
    : time < PURSUIT_UNTIL_SECONDS
      ? 'pursuit'
      : time < IMPACT_AT_SECONDS
        ? 'decision'
        : time < IMPACT_HOLD_UNTIL_SECONDS
          ? 'encounter'
          : time < AFTERMATH_UNTIL_SECONDS
            ? 'aftermath'
            : time < IMPACT_CAMERA_RETURN_UNTIL_SECONDS
              ? 'return'
              : 'overview'
  return {
    sequenceTime: time,
    phase,
    cameraProgress: smootherStep01(time / IMPACT_CAMERA_RETURN_UNTIL_SECONDS),
    debrisProgress: smootherStep01(time / IMPACT_AT_SECONDS),
    maneuverProgress: smootherStep01((time - PURSUIT_UNTIL_SECONDS) / (IMPACT_AT_SECONDS - PURSUIT_UNTIL_SECONDS)),
    aftermathProgress: smootherStep01((time - IMPACT_HOLD_UNTIL_SECONDS) / (AFTERMATH_UNTIL_SECONDS - IMPACT_HOLD_UNTIL_SECONDS)),
  }
}

export function avoidanceManeuverOffset(sequenceTime: number): number {
  if (sequenceTime <= PURSUIT_UNTIL_SECONDS) return 0
  if (sequenceTime < IMPACT_AT_SECONDS) {
    return AVOIDANCE_MAX_OFFSET * smootherStep01((sequenceTime - PURSUIT_UNTIL_SECONDS) / (IMPACT_AT_SECONDS - PURSUIT_UNTIL_SECONDS))
  }
  // The maneuver changes the checked trajectory. Keeping the displacement avoids
  // suggesting that the spacecraft snaps back onto the collision path after the pass.
  return AVOIDANCE_MAX_OFFSET
}
