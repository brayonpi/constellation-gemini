import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import {
  affectedComputeSatelliteIds,
  avoidanceManeuverOffset,
  classifySatelliteIncident,
  encounterFrame,
  IMPACT_AT_SECONDS,
  IMPACT_CAMERA_RETURN_UNTIL_SECONDS,
  IMPACT_HOLD_UNTIL_SECONDS,
  incidentCameraMode,
  PRIMARY_IMPACT_SATELLITE_ID,
  PURSUIT_UNTIL_SECONDS,
} from '../orbitalIncident'
import type { RenderQuality } from '../orbitalIncident'
import type { Mission, MissionView } from '../types'

const fallbackSatellites = Array.from({ length: 12 }, (_, index) => ({
  id: `SAT-${String(index + 1).padStart(2, '0')}`,
  orbit_phase_deg: index * 30,
  isolated: false,
  energy_capacity: 100,
  storage_capacity: 100,
}))

const fallbackLinks = [
  ['SAT-01', 'SAT-03'],
  ['SAT-03', 'SAT-05'],
  ['SAT-05', 'SAT-07'],
  ['SAT-07', 'SAT-09'],
  ['SAT-09', 'SAT-11'],
  ['SAT-11', 'SAT-01'],
].map(([source, target]) => ({ source, target, unavailable_intervals: [] }))

const runningStatuses = new Set(['planning', 'generating_bundles', 'cortex_cover', 'cortex_qap', 'verifying'])
const origin = new THREE.Vector3(0, 0, 0)
const incidentCycleSeconds = 11.6

interface GlobeCameraCommand {
  revision: number
  action: 'reset' | 'zoom-in' | 'zoom-out'
}

interface ImpactCameraState {
  hasSample: boolean
  sequenceTime: number
  projectile: THREE.Vector3
  target: THREE.Vector3
  velocity: THREE.Vector3
}

function satellitePosition(phaseDegrees: number, index: number, elapsed = 0): THREE.Vector3 {
  const shell = index % 3
  const radius = 2.08 + shell * 0.29
  const speed = 0.04 + shell * 0.008
  const phase = THREE.MathUtils.degToRad(phaseDegrees) + elapsed * speed
  const inclination = [-0.34, 0.12, 0.42][shell]
  const point = new THREE.Vector3(
    Math.cos(phase) * radius,
    Math.sin(phase) * radius * 0.36,
    Math.sin(phase) * radius * 0.78,
  )
  point.applyAxisAngle(new THREE.Vector3(0, 0, 1), inclination)
  return point
}

function avoidedSatellitePosition(
  phaseDegrees: number,
  index: number,
  elapsed: number,
  sequenceTime: number,
): THREE.Vector3 {
  const point = satellitePosition(phaseDegrees, index, elapsed)
  const offset = avoidanceManeuverOffset(sequenceTime)
  if (offset <= 0) return point
  const tangent = satellitePosition(phaseDegrees, index, elapsed + 0.14).sub(point).normalize()
  const radial = point.clone().normalize()
  const avoidanceDirection = new THREE.Vector3().crossVectors(radial, tangent).normalize()
  return point.addScaledVector(avoidanceDirection, offset)
}

function globePosition(latitude: number, longitude: number, radius = 1.32): THREE.Vector3 {
  const phi = THREE.MathUtils.degToRad(90 - latitude)
  const theta = THREE.MathUtils.degToRad(longitude + 180)
  return new THREE.Vector3(
    -(radius * Math.sin(phi) * Math.cos(theta)),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  )
}

function deterministicPoints(count: number, minRadius: number, maxRadius: number, seed = 17): Float32Array {
  let value = seed >>> 0
  const random = () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 4294967296
  }
  const result = new Float32Array(count * 3)
  for (let index = 0; index < count; index += 1) {
    const radius = minRadius + random() * (maxRadius - minRadius)
    const theta = random() * Math.PI * 2
    const phi = Math.acos(2 * random() - 1)
    result[index * 3] = radius * Math.sin(phi) * Math.cos(theta)
    result[index * 3 + 1] = radius * Math.cos(phi)
    result[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta)
  }
  return result
}

function StarField({ reducedMotion, quality }: { reducedMotion: boolean; quality: RenderQuality }) {
  const near = useRef<THREE.Points>(null)
  const far = useRef<THREE.Points>(null)
  const nearPoints = useMemo(() => deterministicPoints(quality === 'safe' ? 90 : quality === 'balanced' ? 130 : 170, 6.5, 12, 311), [quality])
  const farPoints = useMemo(() => deterministicPoints(quality === 'safe' ? 150 : quality === 'balanced' ? 215 : 280, 13, 24, 977), [quality])
  useFrame((state, delta) => {
    if (reducedMotion) return
    if (near.current) near.current.rotation.y += delta * 0.004
    if (far.current) far.current.rotation.y -= delta * 0.0015
    if (near.current) near.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.035) * 0.025
  })
  return <group>
    <points ref={far}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[farPoints, 3]} /></bufferGeometry>
      <pointsMaterial color="#7892bd" size={0.022} transparent opacity={0.38} sizeAttenuation depthWrite={false} />
    </points>
    <points ref={near}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[nearPoints, 3]} /></bufferGeometry>
      <pointsMaterial color="#d7e7ff" size={0.034} transparent opacity={0.62} sizeAttenuation depthWrite={false} />
    </points>
  </group>
}

function Atmosphere({ color, incident, quality }: { color: string; incident: boolean; quality: RenderQuality }) {
  return <>
    <mesh scale={1.08}>
      <sphereGeometry args={[1.28, quality === 'safe' ? 36 : 64, quality === 'safe' ? 36 : 64]} />
      <meshBasicMaterial color={color} transparent opacity={incident ? 0.07 : 0.11} side={THREE.BackSide} blending={THREE.AdditiveBlending} depthWrite={false} />
    </mesh>
    {quality !== 'safe' && <mesh scale={1.18}>
      <sphereGeometry args={[1.28, 48, 48]} />
      <meshBasicMaterial color={color} transparent opacity={incident ? 0.024 : 0.04} side={THREE.BackSide} blending={THREE.AdditiveBlending} depthWrite={false} />
    </mesh>}
  </>
}

function Earth({ view, reducedMotion, quality }: { view: MissionView; reducedMotion: boolean; quality: RenderQuality }) {
  const clouds = useRef<THREE.Mesh>(null)
  const { gl } = useThree()
  const [surfaceMap, cloudAlphaMap] = useLoader(THREE.TextureLoader, [
    '/earth/nasa-blue-marble-surface.png',
    '/earth/nasa-blue-marble-clouds.jpg',
  ])
  const incident = view === 'incident'
  const cityPoints = useMemo(() => [
    [38, -122], [40, -74], [51, 0], [48, 2], [35, 139], [-23, -46], [-33, 18], [19, 72], [1, 103], [-34, 151],
    [31, 121], [25, 55], [37, 127], [52, 13], [41, 12], [59, 18], [43, -79], [-12, -77], [30, 31], [6, 3],
  ].map(([latitude, longitude]) => globePosition(latitude, longitude, 1.292)), [])
  useEffect(() => {
    const anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy())
    surfaceMap.colorSpace = THREE.SRGBColorSpace
    surfaceMap.anisotropy = anisotropy
    cloudAlphaMap.colorSpace = THREE.NoColorSpace
    cloudAlphaMap.anisotropy = anisotropy
    surfaceMap.needsUpdate = true
    cloudAlphaMap.needsUpdate = true
  }, [cloudAlphaMap, gl, surfaceMap])
  useFrame((_, delta) => {
    if (clouds.current && !reducedMotion) clouds.current.rotation.y += delta * 0.002
  })
  return <group>
    <mesh>
      <sphereGeometry args={[1.28, quality === 'safe' ? 56 : quality === 'balanced' ? 72 : 96, quality === 'safe' ? 56 : quality === 'balanced' ? 72 : 96]} />
      <meshPhysicalMaterial
        map={surfaceMap}
        bumpMap={surfaceMap}
        bumpScale={0.012}
        color={incident ? '#edf6ff' : '#f4f9ff'}
        roughness={0.62}
        metalness={0.02}
        clearcoat={0.28}
        clearcoatRoughness={0.32}
        emissive={incident ? '#247eae' : '#218fc4'}
        emissiveIntensity={incident ? 0.45 : 0.48}
      />
    </mesh>
    <mesh ref={clouds} rotation={[0, 0.04, 0]}>
      <sphereGeometry args={[1.302, quality === 'safe' ? 40 : quality === 'balanced' ? 56 : 80, quality === 'safe' ? 40 : quality === 'balanced' ? 56 : 80]} />
      <meshPhysicalMaterial
        alphaMap={cloudAlphaMap}
        color={incident ? '#aebbd2' : '#ffffff'}
        transparent
        opacity={quality === 'safe' ? 0.27 : incident ? 0.32 : 0.48}
        alphaTest={0.025}
        depthWrite={false}
        roughness={0.92}
        metalness={0}
      />
    </mesh>
    <group>
      {cityPoints.map((position, index) => <mesh key={index} position={position}>
        <sphereGeometry args={[index % 4 === 0 ? 0.018 : 0.012, 6, 6]} />
        <meshBasicMaterial color={incident ? '#5a79a9' : '#9ed4ff'} transparent opacity={0.72} />
      </mesh>)}
    </group>
    <Atmosphere color={incident ? '#68aef4' : '#83d2ff'} incident={incident} quality={quality} />
  </group>
}

function OrbitRings({ view }: { view: MissionView }) {
  const incident = view === 'incident'
  const recovered = view === 'recovered' || view === 'diff'
  return <group>
    {[2.08, 2.37, 2.66].map((radius, index) => (
      <mesh key={radius} rotation={[Math.PI / 2 + [-0.34, 0.12, 0.42][index], 0.08, -0.12 + index * 0.13]}>
        <torusGeometry args={[radius, index === 0 ? 0.0045 : 0.002, 5, 192]} />
        <meshBasicMaterial
          color={incident ? '#50698f' : recovered ? '#58b89a' : '#6689b7'}
          transparent
          opacity={index === 0 ? incident ? 0.16 : recovered ? 0.19 : 0.16 : incident ? 0.03 : recovered ? 0.045 : 0.065}
          depthWrite={false}
        />
      </mesh>
    ))}
  </group>
}

function SatelliteFleet({ mission, view, reducedMotion, sequenceEpochMs }: {
  mission?: Mission
  view: MissionView
  reducedMotion: boolean
  sequenceEpochMs: number
}) {
  const refs = useRef<Array<THREE.Group | null>>([])
  const thrusterRefs = useRef<Array<THREE.Group | null>>([])
  const satellites = mission?.snapshot.satellites ?? fallbackSatellites
  const selectedBundles = new Set(mission?.plan?.selected_bundle_ids ?? [])
  const recoveredSatellites = new Set(
    mission?.bundles.filter((bundle) => selectedBundles.has(bundle.id)).map((bundle) => bundle.satellite_id) ?? [],
  )
  const affectedComputeSatellites = affectedComputeSatelliteIds(
    mission?.telemetry.flatMap((event) => event.affected_resources)
      ?? ['COMPUTE-SAT-07', 'COMPUTE-SAT-08'],
  )

  useFrame((state) => {
    state.gl.domElement.dataset.maneuverThrusters = 'off'
    const encounterActive = view === 'incident' || view === 'recovered'
    const sequenceTime = reducedMotion
      ? IMPACT_CAMERA_RETURN_UNTIL_SECONDS
      : Math.max(0, (performance.now() - sequenceEpochMs) / 1000)
    const elapsed = reducedMotion ? 0 : encounterActive ? sequenceTime : state.clock.elapsedTime
    satellites.forEach((satellite, index) => {
      const group = refs.current[index]
      if (!group) return
      const position = view === 'recovered' && satellite.id === PRIMARY_IMPACT_SATELLITE_ID
        ? avoidedSatellitePosition(satellite.orbit_phase_deg, index, elapsed, sequenceTime)
        : satellitePosition(satellite.orbit_phase_deg, index, elapsed)
      group.position.copy(position)
      group.lookAt(origin)
      const incidentRole = view === 'nominal'
        ? 'healthy'
        : classifySatelliteIncident(satellite.id, affectedComputeSatellites)
      const isImpactTarget = incidentRole === 'impact'
      const isIsolated = incidentRole === 'isolated'
      const isAvoidingTarget = view === 'recovered' && satellite.id === PRIMARY_IMPACT_SATELLITE_ID
      const isRecovered = ['recovered', 'diff'].includes(view) && recoveredSatellites.has(satellite.id)
      const cinematicFocusActive = encounterActive
        && sequenceTime >= PURSUIT_UNTIL_SECONDS
        && sequenceTime <= IMPACT_HOLD_UNTIL_SECONDS
      const isPrimaryEncounterSatellite = satellite.id === PRIMARY_IMPACT_SATELLITE_ID
      group.visible = !(isImpactTarget && view === 'incident' && sequenceTime >= IMPACT_AT_SECONDS + 0.16)
        && !(cinematicFocusActive && !isPrimaryEncounterSatellite)
      if (isImpactTarget && view === 'incident') {
        const incidentTime = Math.min(sequenceTime, incidentCycleSeconds)
        const damage = THREE.MathUtils.smoothstep(incidentTime, IMPACT_AT_SECONDS, IMPACT_AT_SECONDS + 0.8)
        group.rotateX(damage * (elapsed * 1.7 + index * 0.3))
        group.rotateZ(damage * Math.sin(elapsed * 2.8 + index) * 0.9)
      }
      const pulse = isRecovered && !reducedMotion ? 1 + Math.sin(elapsed * 3.2 + index) * 0.08 : 1
      group.scale.setScalar((isImpactTarget && view === 'incident' ? 1.16 : isAvoidingTarget ? 1.1 : isIsolated ? 1.04 : 1) * pulse)
      const thruster = thrusterRefs.current[index]
      if (thruster) {
        const active = isAvoidingTarget
          && sequenceTime >= PURSUIT_UNTIL_SECONDS
          && sequenceTime <= IMPACT_AT_SECONDS + 0.08
        state.gl.domElement.dataset.maneuverThrusters = active ? 'firing' : 'standby'
        thruster.visible = active
        if (active && !reducedMotion) {
          const ignition = THREE.MathUtils.smoothstep(sequenceTime, PURSUIT_UNTIL_SECONDS, PURSUIT_UNTIL_SECONDS + 0.18)
          const plumePulse = 0.82 + Math.sin(elapsed * 37) * 0.1 + Math.sin(elapsed * 13.7) * 0.06
          thruster.scale.set(0.92 + plumePulse * 0.05, Math.max(0.08, plumePulse * ignition), 0.92 + plumePulse * 0.05)
        }
      }
    })
  })

  return <group>
    {satellites.map((satellite, index) => {
      const incidentRole = view === 'nominal'
        ? 'healthy'
        : classifySatelliteIncident(satellite.id, affectedComputeSatellites)
      const isImpactTarget = incidentRole === 'impact' && view === 'incident'
      const isAvoidingTarget = incidentRole === 'impact' && (view === 'recovered' || view === 'diff')
      const isIsolated = incidentRole === 'isolated'
      const isRecovered = ['recovered', 'diff'].includes(view) && recoveredSatellites.has(satellite.id)
      const color = isImpactTarget ? '#ff5b6e' : isAvoidingTarget ? '#55e3ae' : isIsolated ? '#f4ad4f' : isRecovered ? '#55e3ae' : '#73a7ff'
      const panelColor = isImpactTarget ? '#6d2730' : isAvoidingTarget ? '#235f52' : isIsolated ? '#62491f' : '#21458d'
      return <group
        key={satellite.id}
        name={`satellite-${satellite.id}-${incidentRole}`}
        ref={(value) => { refs.current[index] = value }}
        position={satellitePosition(satellite.orbit_phase_deg, index)}
      >
        <mesh castShadow>
          <boxGeometry args={[0.15, 0.115, 0.18]} />
          <meshPhysicalMaterial color={color} roughness={0.3} metalness={0.78} clearcoat={0.34} clearcoatRoughness={0.26} emissive={color} emissiveIntensity={0.19} />
        </mesh>
        <mesh position={[0, 0.061, 0.012]}>
          <boxGeometry args={[0.105, 0.008, 0.105]} />
          <meshStandardMaterial color="#d4dae3" roughness={0.36} metalness={0.82} />
        </mesh>
        {[-0.19, 0.19].map((panelX) => <group key={panelX} position={[panelX, 0, 0]}>
          <mesh>
            <boxGeometry args={[0.22, 0.012, 0.105]} />
            <meshPhysicalMaterial color={panelColor} roughness={0.34} metalness={0.55} clearcoat={0.3} emissive={color} emissiveIntensity={0.08} />
          </mesh>
          {[-0.05, 0, 0.05].map((z) => <mesh key={z} position={[0, 0.008, z]}>
            <boxGeometry args={[0.205, 0.003, 0.003]} />
            <meshBasicMaterial color="#7598d3" transparent opacity={0.62} />
          </mesh>)}
          <mesh position={[0, 0.008, 0]}>
            <boxGeometry args={[0.003, 0.003, 0.098]} />
            <meshBasicMaterial color="#7598d3" transparent opacity={0.62} />
          </mesh>
        </group>)}
        <mesh position={[0, 0.105, -0.015]} rotation={[0.2, 0, 0]}>
          <cylinderGeometry args={[0.028, 0.042, 0.035, 16]} />
          <meshStandardMaterial color="#e9edf4" roughness={0.34} metalness={0.68} />
        </mesh>
        <mesh position={[0, 0.15, -0.008]}>
          <cylinderGeometry args={[0.004, 0.004, 0.07, 8]} />
          <meshStandardMaterial color="#c7d2df" roughness={0.4} metalness={0.7} />
        </mesh>
        <mesh position={[0, 0, -0.115]}>
          <coneGeometry args={[0.045, 0.1, 12]} />
          <meshStandardMaterial color="#cbd8ec" roughness={0.42} metalness={0.55} />
        </mesh>
        {isAvoidingTarget && <>
          {[-0.036, 0.036].map((engineX) => <group key={engineX} position={[engineX, -0.083, 0.075]}>
            <mesh>
              <cylinderGeometry args={[0.015, 0.021, 0.035, 12]} />
              <meshStandardMaterial color="#738298" roughness={0.31} metalness={0.92} />
            </mesh>
            <mesh position={[0, -0.019, 0]}>
              <torusGeometry args={[0.016, 0.004, 6, 16]} />
              <meshStandardMaterial color="#9fb2c9" roughness={0.24} metalness={0.9} />
            </mesh>
          </group>)}
          <group ref={(value) => { thrusterRefs.current[index] = value }} name="avoidance-thruster-plume" visible={false}>
            {[-0.036, 0.036].map((engineX) => <group key={engineX} position={[engineX, -0.215, 0.075]}>
              <mesh>
                <coneGeometry args={[0.042, 0.24, 14, 1, true]} />
                <meshBasicMaterial color="#477dff" transparent opacity={0.28} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
              </mesh>
              <mesh position={[0, 0.035, 0]}>
                <coneGeometry args={[0.023, 0.16, 12]} />
                <meshBasicMaterial color="#8cc8ff" transparent opacity={0.62} blending={THREE.AdditiveBlending} depthWrite={false} />
              </mesh>
              <mesh position={[0, 0.074, 0]}>
                <coneGeometry args={[0.009, 0.065, 10]} />
                <meshBasicMaterial color="#e0f7ff" transparent opacity={0.92} blending={THREE.AdditiveBlending} depthWrite={false} />
              </mesh>
              {[0, 1, 2].map((particle) => <mesh key={particle} position={[(particle - 1) * 0.008, -0.095 - particle * 0.045, 0]}>
                <sphereGeometry args={[0.007 - particle * 0.0012, 7, 7]} />
                <meshBasicMaterial color={particle === 0 ? '#c9edff' : '#6198ff'} transparent opacity={0.58 - particle * 0.13} blending={THREE.AdditiveBlending} depthWrite={false} />
              </mesh>)}
            </group>)}
            <pointLight position={[0, -0.1, 0.075]} color="#73b9ff" intensity={1.8} distance={0.72} decay={2} />
          </group>
        </>}
      </group>
    })}
  </group>
}

function GroundStation({ stationId, position, failed, recovered, reducedMotion }: {
  stationId: string
  position: THREE.Vector3
  failed: boolean
  recovered: boolean
  reducedMotion: boolean
}) {
  const group = useRef<THREE.Group>(null)
  const signal = useRef<THREE.Group>(null)
  const beacon = useRef<THREE.Mesh>(null)
  const beaconLight = useRef<THREE.PointLight>(null)
  const offlineMarker = useRef<THREE.Group>(null)
  const failureAge = useRef(0)
  const direction = useMemo(() => position.clone().normalize(), [position])
  const rotation = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction), [direction])
  const color = failed ? '#ff5b6e' : recovered ? '#58e2b0' : '#7ce2ff'
  useEffect(() => { failureAge.current = 0 }, [failed])
  useFrame((state, delta) => {
    if (failed) failureAge.current += delta
    const signalPhase = reducedMotion ? 0.2 : (state.clock.elapsedTime * 0.48) % 1
    const lossProgress = failed ? THREE.MathUtils.clamp(failureAge.current / 1.25, 0, 1) : 0
    if (signal.current) {
      signal.current.visible = !failed || lossProgress < 1
      signal.current.scale.setScalar(1 + signalPhase * 1.65 + lossProgress * 0.7)
      signal.current.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return
        const material = child.material as THREE.MeshBasicMaterial
        material.opacity = (0.34 - signalPhase * 0.25) * (1 - lossProgress)
      })
    }
    const alertPulse = reducedMotion ? 1 : 0.88 + Math.sin(state.clock.elapsedTime * 7.4) * 0.12
    if (beacon.current) beacon.current.scale.setScalar(failed ? alertPulse : 1)
    if (beaconLight.current) beaconLight.current.intensity = failed ? 0.82 * alertPulse : 0.42
    if (offlineMarker.current) {
      offlineMarker.current.visible = failed && lossProgress > 0.45
      offlineMarker.current.scale.setScalar(reducedMotion ? 1 : 0.94 + Math.sin(state.clock.elapsedTime * 4.2) * 0.06)
    }
    if (stationId === 'GS-PACIFIC-02') {
      state.gl.domElement.dataset.groundStationState = failed ? 'offline' : 'online'
      state.gl.domElement.dataset.groundStationId = stationId
    }
  })
  return <group ref={group} name={`ground-station-${stationId}-${failed ? 'offline' : 'online'}`} position={position} quaternion={rotation}>
    <group scale={0.64}>
    <mesh position={[0, 0.014, 0]}>
      <cylinderGeometry args={[0.06, 0.075, 0.028, 16]} />
      <meshStandardMaterial color={failed ? '#7d3038' : '#60748a'} roughness={0.5} metalness={0.65} />
    </mesh>
    <mesh position={[0, 0.09, 0]}>
      <cylinderGeometry args={[0.012, 0.025, 0.14, 10]} />
      <meshStandardMaterial color="#a8b3c1" roughness={0.38} metalness={0.82} />
    </mesh>
    {[-1, 1].map((side) => <mesh key={side} position={[side * 0.026, 0.078, 0]} rotation={[0, 0, side * -0.31]}>
      <boxGeometry args={[0.006, 0.13, 0.006]} />
      <meshStandardMaterial color="#76879b" roughness={0.44} metalness={0.75} />
    </mesh>)}
    <group position={[0, 0.175, 0]} rotation={[0.08, 0, -0.48]}>
      <mesh scale={[1, 0.28, 1]}>
        <sphereGeometry args={[0.085, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={failed ? '#c5a2a5' : '#dce6ef'} roughness={0.32} metalness={0.68} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.052, 0]}>
        <cylinderGeometry args={[0.004, 0.004, 0.095, 8]} />
        <meshStandardMaterial color="#aab8c8" roughness={0.35} metalness={0.8} />
      </mesh>
      <mesh position={[0, 0.101, 0]}>
        <sphereGeometry args={[0.012, 10, 10]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
    <mesh ref={beacon} position={[0, 0.265, 0]}>
      <sphereGeometry args={[0.018, 12, 12]} />
      <meshBasicMaterial color={color} />
    </mesh>
    <pointLight ref={beaconLight} position={[0, 0.265, 0]} color={color} intensity={failed ? 1.4 : 0.42} distance={0.55} decay={2} />
    <group ref={signal} position={[0, 0.285, 0]} rotation={[Math.PI / 2, 0, 0]}>
      {[0.06, 0.1, 0.145].map((radius, index) => <mesh key={radius}>
        <torusGeometry args={[radius, 0.005 - index * 0.0007, 6, 34]} />
        <meshBasicMaterial color={color} transparent opacity={0.3 - index * 0.05} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>)}
    </group>
    <group ref={offlineMarker} name="offline-station-marker" position={[0, 0.42, 0]} visible={failed}>
      <mesh>
        <torusGeometry args={[0.13, 0.007, 7, 36]} />
        <meshBasicMaterial color="#ff5b6e" transparent opacity={0.66} depthTest={false} />
      </mesh>
      <mesh rotation={[0, 0, Math.PI / 4]}>
        <boxGeometry args={[0.22, 0.015, 0.012]} />
        <meshBasicMaterial color="#ff5b6e" transparent opacity={0.96} depthTest={false} />
      </mesh>
      <mesh rotation={[0, 0, -Math.PI / 4]}>
        <boxGeometry args={[0.22, 0.015, 0.012]} />
        <meshBasicMaterial color="#ff5b6e" transparent opacity={0.96} depthTest={false} />
      </mesh>
    </group>
    </group>
  </group>
}

function GroundStations({ mission, view, reducedMotion }: { mission?: Mission; view: MissionView; reducedMotion: boolean }) {
  const stations = mission?.snapshot.ground_stations ?? []
  return <group>
    {stations.map((station) => <GroundStation
      key={station.id}
      stationId={station.id}
      position={globePosition(station.latitude, station.longitude)}
      failed={view !== 'nominal' && station.id === 'GS-PACIFIC-02'}
      recovered={['recovered', 'diff'].includes(view) && station.id !== 'GS-PACIFIC-02'}
      reducedMotion={reducedMotion}
    />)}
  </group>
}

function MovingLink({ source, target, sourceIndex, targetIndex, satellites, degraded, recovered, muted, reducedMotion }: {
  source: string
  target: string
  sourceIndex: number
  targetIndex: number
  satellites: typeof fallbackSatellites
  degraded: boolean
  recovered: boolean
  muted: boolean
  reducedMotion: boolean
}) {
  const pulse = useRef<THREE.Mesh>(null)
  const positions = useMemo(() => new Float32Array(6), [])
  const geometry = useMemo(() => new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(positions, 3)), [positions])
  const color = degraded ? '#ff5b6e' : recovered ? '#55e3ae' : muted ? '#56667e' : '#58adff'
  useFrame((state) => {
    const elapsed = reducedMotion ? 0 : state.clock.elapsedTime
    const start = satellitePosition(satellites[sourceIndex].orbit_phase_deg, sourceIndex, elapsed)
    const end = satellitePosition(satellites[targetIndex].orbit_phase_deg, targetIndex, elapsed)
    const attribute = geometry.getAttribute('position') as THREE.BufferAttribute
    attribute.setXYZ(0, start.x, start.y, start.z)
    attribute.setXYZ(1, end.x, end.y, end.z)
    attribute.needsUpdate = true
    if (pulse.current) {
      const phase = reducedMotion ? 0.45 : (state.clock.elapsedTime * 0.27 + sourceIndex * 0.17) % 1
      pulse.current.position.lerpVectors(start, end, phase)
    }
  })
  return <group name={`${source}-${target}`}>
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={color} transparent opacity={degraded ? 0.16 : recovered ? 0.63 : muted ? 0.12 : 0.38} depthWrite={false} />
    </lineSegments>
    {!degraded && !muted && <mesh ref={pulse}>
      <sphereGeometry args={[0.025, 8, 8]} />
      <meshBasicMaterial color={color} transparent opacity={0.95} blending={THREE.AdditiveBlending} depthWrite={false} />
    </mesh>}
  </group>
}

function OpticalNetwork({ mission, view, reducedMotion }: { mission?: Mission; view: MissionView; reducedMotion: boolean }) {
  const satellites = mission?.snapshot.satellites ?? fallbackSatellites
  const links = mission?.snapshot.links.length ? mission.snapshot.links : fallbackLinks
  const byId = new Map(satellites.map((satellite, index) => [satellite.id, index]))
  const failed = new Set(
    mission?.telemetry
      .flatMap((event) => event.affected_resources)
      .filter((resource) => resource.startsWith('SAT-') || resource.startsWith('COMPUTE-SAT-'))
      .map((resource) => resource.replace('COMPUTE-', ''))
      ?? ['SAT-07', 'SAT-08'],
  )
  const recoveryView = view === 'recovered' || view === 'diff'
  const selectedBundles = new Set(mission?.plan?.selected_bundle_ids ?? [])
  const recoverySatellites = new Set(
    mission?.bundles.filter((bundle) => selectedBundles.has(bundle.id)).map((bundle) => bundle.satellite_id) ?? [],
  )
  return <group>
    {links.map((link) => {
      const sourceIndex = byId.get(link.source)
      const targetIndex = byId.get(link.target)
      if (sourceIndex === undefined || targetIndex === undefined) return null
      const degraded = view !== 'nominal' && (failed.has(link.source) || failed.has(link.target) || link.unavailable_intervals.length > 0)
      const recovered = recoveryView && !degraded && (recoverySatellites.has(link.source) || recoverySatellites.has(link.target))
      const muted = recoveryView && !degraded && !recovered
      return <MovingLink
        key={`${link.source}-${link.target}`}
        source={link.source}
        target={link.target}
        sourceIndex={sourceIndex}
        targetIndex={targetIndex}
        satellites={satellites}
        degraded={degraded}
        recovered={recovered}
        muted={muted}
        reducedMotion={reducedMotion}
      />
    })}
  </group>
}

function WorkloadPulses({ mission, view, reducedMotion }: { mission?: Mission; view: MissionView; reducedMotion: boolean }) {
  const satellites = mission?.snapshot.satellites ?? fallbackSatellites
  const refs = useRef<Array<THREE.Mesh | null>>([])
  const recovered = view === 'recovered' || view === 'diff'
  const incident = view === 'incident'
  useFrame((state) => {
    const elapsed = reducedMotion ? 0 : state.clock.elapsedTime
    refs.current.forEach((mesh, pulseIndex) => {
      if (!mesh) return
      const satelliteIndex = [0, 3, 5, 9][pulseIndex]
      const satellite = satellites[satelliteIndex % satellites.length]
      const start = satellitePosition(satellite.orbit_phase_deg, satelliteIndex, elapsed)
      const end = globePosition([38, -23, 59, 1][pulseIndex], [-122, -68, 18, 103][pulseIndex], 1.36)
      let phase = reducedMotion ? 0.42 : (elapsed * (recovered ? 0.32 : 0.2) + pulseIndex * 0.23) % 1
      if (incident && pulseIndex === 1) phase = 0.36
      mesh.position.lerpVectors(start, end, phase)
      const arc = start.clone().lerp(end, phase).normalize().multiplyScalar(Math.sin(Math.PI * phase) * 0.55)
      mesh.position.add(arc)
      mesh.scale.setScalar(incident && pulseIndex === 1 ? 0.65 : 1 + Math.sin(elapsed * 5 + pulseIndex) * 0.12)
    })
  })
  return <group>
    {[0, 1, 2, 3].map((index) => <mesh key={index} ref={(value) => { refs.current[index] = value }}>
      <sphereGeometry args={[index === 1 ? 0.042 : 0.032, 10, 10]} />
      <meshBasicMaterial
        color={incident && index === 1 ? '#ffb13b' : recovered ? '#63f0bd' : '#c4e7ff'}
        transparent
        opacity={incident && index === 1 ? 0.55 : 0.88}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </mesh>)}
  </group>
}

type EncounterOutcome = 'collision' | 'avoided'

function OrbitalEncounter({ mission, reducedMotion, cameraState, outcome, sequenceEpochMs, quality }: {
  mission?: Mission
  reducedMotion: boolean
  cameraState: { current: ImpactCameraState }
  outcome: EncounterOutcome
  sequenceEpochMs: number
  quality: RenderQuality
}) {
  const { camera, gl } = useThree()
  const satellites = mission?.snapshot.satellites ?? fallbackSatellites
  const impactedIndex = Math.max(0, satellites.findIndex((satellite) => satellite.id === PRIMARY_IMPACT_SATELLITE_ID))
  const impacted = satellites[impactedIndex]
  const projectile = useRef<THREE.Group>(null)
  const burst = useRef<THREE.Group>(null)
  const flash = useRef<THREE.Mesh>(null)
  const shockwave = useRef<THREE.Mesh>(null)
  const impactLight = useRef<THREE.PointLight>(null)
  const nearMiss = useRef<THREE.Group>(null)
  const trailSegments = 28
  const trajectorySegments = 44
  const flybySegments = 34
  const flybyDurationSeconds = 3.35
  const trailGeometry = useMemo(() => new THREE.BufferGeometry().setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(trailSegments * 2 * 3), 3),
  ), [])
  const trajectoryGeometry = useMemo(() => new THREE.BufferGeometry().setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(trajectorySegments * 2 * 3), 3),
  ), [])
  const flybyGeometry = useMemo(() => new THREE.BufferGeometry().setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(flybySegments * 2 * 3), 3),
  ), [])
  const avoidanceVectorGeometry = useMemo(() => new THREE.BufferGeometry().setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(6), 3),
  ), [])
  const fragments = useMemo(() => Array.from({ length: 42 }, (_, index) => {
    const azimuth = index * 2.399963229728653
    const elevation = ((index * 7) % 19) / 19 - 0.5
    const horizontal = Math.sqrt(Math.max(0.05, 1 - elevation * elevation))
    return new THREE.Vector3(
      Math.cos(azimuth) * horizontal,
      elevation * 1.35,
      Math.sin(azimuth) * horizontal,
    ).normalize().multiplyScalar(0.85 + (index % 5) * 0.15)
  }), [])
  const fragmentRefs = useRef<Array<THREE.Mesh | null>>([])
  const wreckageRefs = useRef<Array<THREE.Group | null>>([])
  const wreckageDirections = useMemo(() => [
    new THREE.Vector3(-1.1, 0.38, 0.24),
    new THREE.Vector3(1.05, -0.18, 0.34),
    new THREE.Vector3(-0.38, -0.72, -0.42),
    new THREE.Vector3(0.48, 0.68, -0.28),
    new THREE.Vector3(0.14, 0.88, 0.52),
    new THREE.Vector3(-0.2, -0.42, 0.94),
  ].map((direction) => direction.normalize()), [])
  const radial = useMemo(() => new THREE.Vector3(), [])
  const tangent = useMemo(() => new THREE.Vector3(), [])
  const orbitNormal = useMemo(() => new THREE.Vector3(), [])
  const pathStart = useMemo(() => new THREE.Vector3(), [])
  const controlA = useMemo(() => new THREE.Vector3(), [])
  const controlB = useMemo(() => new THREE.Vector3(), [])
  const flybyControlA = useMemo(() => new THREE.Vector3(), [])
  const flybyControlB = useMemo(() => new THREE.Vector3(), [])
  const flybyEnd = useMemo(() => new THREE.Vector3(), [])
  const nextTarget = useMemo(() => new THREE.Vector3(), [])
  const nextProjectilePosition = useMemo(() => new THREE.Vector3(), [])
  const avoidedPosition = useMemo(() => new THREE.Vector3(), [])
  const path = useMemo(() => new THREE.CubicBezierCurve3(
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ), [])
  const flybyPath = useMemo(() => new THREE.CubicBezierCurve3(
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ), [])
  const worldProjectile = useMemo(() => new THREE.Vector3(), [])
  const worldTarget = useMemo(() => new THREE.Vector3(), [])
  const previousWorldProjectile = useMemo(() => new THREE.Vector3(), [])
  const projectedProjectile = useMemo(() => new THREE.Vector3(), [])
  const frameCounter = useRef(0)
  const hasPreviousProjectile = useRef(false)

  useFrame(() => {
    const sequenceTime = reducedMotion
      ? IMPACT_CAMERA_RETURN_UNTIL_SECONDS
      : Math.max(0, (performance.now() - sequenceEpochMs) / 1000)
    const elapsed = reducedMotion ? IMPACT_AT_SECONDS + 0.75 : sequenceTime
    const cycle = reducedMotion
      ? IMPACT_AT_SECONDS + 0.75
      : Math.min(sequenceTime, incidentCycleSeconds)
    const target = satellitePosition(impacted.orbit_phase_deg, impactedIndex, elapsed)
    if (outcome === 'avoided') {
      avoidedPosition.copy(avoidedSatellitePosition(impacted.orbit_phase_deg, impactedIndex, elapsed, sequenceTime))
    }
    nextTarget.copy(satellitePosition(impacted.orbit_phase_deg, impactedIndex, elapsed + 0.18))
    tangent.copy(nextTarget).sub(target).normalize()
    radial.copy(target).normalize()
    orbitNormal.crossVectors(radial, tangent).normalize()
    pathStart.copy(target)
      .addScaledVector(tangent, -2)
      .addScaledVector(radial, 0.82)
      .addScaledVector(orbitNormal, 0.62)
    controlA.copy(pathStart)
      .addScaledVector(tangent, 0.62)
      .addScaledVector(radial, 0.42)
      .addScaledVector(orbitNormal, 0.1)
    controlB.copy(target)
      .addScaledVector(tangent, -0.55)
      .addScaledVector(orbitNormal, 0.38)
      .addScaledVector(radial, 0.16)
    path.v0.copy(pathStart)
    path.v1.copy(controlA)
    path.v2.copy(controlB)
    path.v3.copy(target)
    flybyControlA.copy(target)
      .addScaledVector(tangent, 0.72)
      .addScaledVector(orbitNormal, 0.11)
      .addScaledVector(radial, 0.04)
    flybyControlB.copy(target)
      .addScaledVector(tangent, 1.32)
      .addScaledVector(orbitNormal, 0.26)
      .addScaledVector(radial, 0.12)
    flybyEnd.copy(target)
      .addScaledVector(tangent, 2.08)
      .addScaledVector(orbitNormal, 0.42)
      .addScaledVector(radial, 0.2)
    flybyPath.v0.copy(target)
    flybyPath.v1.copy(flybyControlA)
    flybyPath.v2.copy(flybyControlB)
    flybyPath.v3.copy(flybyEnd)
    const approach = encounterFrame(cycle).debrisProgress
    const sinceImpact = Math.max(0, cycle - IMPACT_AT_SECONDS)
    const flybyLinear = THREE.MathUtils.clamp(sinceImpact / flybyDurationSeconds, 0, 1)
    const flybyProgress = flybyLinear * flybyLinear * (3 - 2 * flybyLinear)
    const projectilePosition = outcome === 'avoided' && cycle >= IMPACT_AT_SECONDS
      ? flybyPath.getPoint(flybyProgress)
      : path.getPoint(approach)
    if (outcome === 'avoided' && cycle >= IMPACT_AT_SECONDS) {
      flybyPath.getPoint(Math.min(1, flybyProgress + 0.025), nextProjectilePosition)
    } else {
      path.getPoint(Math.min(1, approach + 0.025), nextProjectilePosition)
    }

    if (projectile.current) {
      projectile.current.visible = outcome === 'avoided'
        ? sinceImpact < flybyDurationSeconds
        : cycle < IMPACT_AT_SECONDS
      projectile.current.position.copy(projectilePosition)
      projectile.current.lookAt(nextProjectilePosition)
      projectile.current.getWorldPosition(worldProjectile)
      worldTarget.copy(outcome === 'avoided' ? avoidedPosition : target)
      projectile.current.parent?.localToWorld(worldTarget)
      if (hasPreviousProjectile.current && cycle <= IMPACT_AT_SECONDS + 0.06) {
        cameraState.current.velocity.copy(worldProjectile).sub(previousWorldProjectile)
      } else {
        cameraState.current.velocity.copy(worldTarget).sub(worldProjectile)
        hasPreviousProjectile.current = true
      }
      if (cameraState.current.velocity.lengthSq() < 0.000001) {
        cameraState.current.velocity.copy(worldTarget).sub(worldProjectile)
      }
      previousWorldProjectile.copy(worldProjectile)
      cameraState.current.hasSample = true
      cameraState.current.sequenceTime = sequenceTime
      cameraState.current.projectile.copy(worldProjectile)
      cameraState.current.target.copy(worldTarget)
    }
    const trail = trailGeometry.getAttribute('position') as THREE.BufferAttribute
    const trailStartTime = Math.max(0, cycle - 0.7)
    const pointAtTime = (time: number): THREE.Vector3 => {
      if (outcome === 'avoided' && time >= IMPACT_AT_SECONDS) {
        const linear = THREE.MathUtils.clamp((time - IMPACT_AT_SECONDS) / flybyDurationSeconds, 0, 1)
        return flybyPath.getPoint(linear * linear * (3 - 2 * linear))
      }
      const linear = THREE.MathUtils.clamp(time / IMPACT_AT_SECONDS, 0, 1)
      return path.getPoint(linear * linear * (3 - 2 * linear))
    }
    for (let index = 0; index < trailSegments; index += 1) {
      const startT = THREE.MathUtils.lerp(trailStartTime, cycle, index / trailSegments)
      const endT = THREE.MathUtils.lerp(trailStartTime, cycle, (index + 1) / trailSegments)
      const start = pointAtTime(startT)
      const end = pointAtTime(endT)
      trail.setXYZ(index * 2, start.x, start.y, start.z)
      trail.setXYZ(index * 2 + 1, end.x, end.y, end.z)
    }
    trail.needsUpdate = true
    const trajectory = trajectoryGeometry.getAttribute('position') as THREE.BufferAttribute
    for (let index = 0; index < trajectorySegments; index += 1) {
      const start = path.getPoint(index / trajectorySegments)
      const end = path.getPoint((index + 1) / trajectorySegments)
      trajectory.setXYZ(index * 2, start.x, start.y, start.z)
      trajectory.setXYZ(index * 2 + 1, end.x, end.y, end.z)
    }
    trajectory.needsUpdate = true
    if (outcome === 'avoided') {
      const flyby = flybyGeometry.getAttribute('position') as THREE.BufferAttribute
      for (let index = 0; index < flybySegments; index += 1) {
        const start = flybyPath.getPoint(index / flybySegments)
        const end = flybyPath.getPoint((index + 1) / flybySegments)
        flyby.setXYZ(index * 2, start.x, start.y, start.z)
        flyby.setXYZ(index * 2 + 1, end.x, end.y, end.z)
      }
      flyby.needsUpdate = true
      const avoidanceVector = avoidanceVectorGeometry.getAttribute('position') as THREE.BufferAttribute
      avoidanceVector.setXYZ(0, target.x, target.y, target.z)
      avoidanceVector.setXYZ(1, avoidedPosition.x, avoidedPosition.y, avoidedPosition.z)
      avoidanceVector.needsUpdate = true
    }

    if (burst.current) {
      burst.current.visible = outcome === 'collision' && cycle >= IMPACT_AT_SECONDS && cycle < IMPACT_AT_SECONDS + 3.35
      burst.current.position.copy(target)
    }
    fragmentRefs.current.forEach((fragment, index) => {
      if (!fragment) return
      const travel = Math.min(sinceImpact, 2.8)
      fragment.position.copy(fragments[index]).multiplyScalar(travel * 0.43)
      fragment.position.y -= travel * travel * 0.035
      fragment.rotation.set(elapsed * (1.1 + index % 3), elapsed * (0.8 + index % 4), index)
      fragment.scale.setScalar(Math.max(0.12, 1 - travel * 0.23))
    })
    wreckageRefs.current.forEach((piece, index) => {
      if (!piece) return
      const travel = Math.min(sinceImpact, 3.1)
      piece.position.copy(wreckageDirections[index]).multiplyScalar(0.08 + travel * (0.2 + index * 0.018))
      piece.position.y -= travel * travel * 0.012
      piece.rotation.set(
        travel * (0.8 + index * 0.17),
        travel * (1.15 + index * 0.13),
        travel * (0.62 + index * 0.21),
      )
    })
    if (flash.current) {
      const intensity = outcome === 'collision' && cycle >= IMPACT_AT_SECONDS ? Math.max(0, 1 - sinceImpact * 3.8) : 0
      flash.current.visible = intensity > 0.01
      flash.current.scale.setScalar(0.3 + (1 - intensity) * 0.9)
      ;(flash.current.material as THREE.MeshBasicMaterial).opacity = intensity * 0.58
    }
    if (shockwave.current) {
      const wave = outcome === 'collision' && cycle >= IMPACT_AT_SECONDS ? Math.min(sinceImpact, 0.72) : 0
      shockwave.current.visible = wave > 0 && wave < 0.72
      shockwave.current.scale.setScalar(0.42 + wave * 1.8)
      ;(shockwave.current.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.42 - wave * 0.58)
    }
    if (impactLight.current) impactLight.current.intensity = outcome === 'collision' && cycle >= IMPACT_AT_SECONDS
      ? Math.max(0, 5.2 - sinceImpact * 2.4)
      : 0
    if (nearMiss.current) {
      nearMiss.current.visible = outcome === 'avoided' && cycle >= IMPACT_AT_SECONDS && sinceImpact < 2.25
      nearMiss.current.position.copy(target)
    }
    frameCounter.current += 1
    if (projectile.current && frameCounter.current % 6 === 0) {
      projectile.current.getWorldPosition(worldProjectile)
      projectedProjectile.copy(worldProjectile).project(camera)
      gl.domElement.dataset.impactPhase = cycle.toFixed(3)
      gl.domElement.dataset.impactNdc = `${projectedProjectile.x.toFixed(3)},${projectedProjectile.y.toFixed(3)}`
      gl.domElement.dataset.impactState = cycle < IMPACT_AT_SECONDS
        ? 'approaching'
        : outcome === 'collision'
          ? sinceImpact < 0.55 ? 'collision' : 'debris'
          : sinceImpact < 0.45 ? 'safe-miss' : sinceImpact < flybyDurationSeconds ? 'clearing' : 'cleared'
      gl.domElement.dataset.encounterOutcome = outcome
      gl.domElement.dataset.encounterSequence = sequenceTime.toFixed(3)
      gl.domElement.dataset.cinematicPhase = encounterFrame(sequenceTime).phase
      if (outcome === 'avoided') {
        gl.domElement.dataset.encounterSeparation = projectilePosition.distanceTo(avoidedPosition).toFixed(3)
      } else {
        delete gl.domElement.dataset.encounterSeparation
      }
    }
  })

  return <group name={`simulated-debris-${outcome}`}>
    <lineSegments geometry={trajectoryGeometry}>
      <lineBasicMaterial color="#f6c94f" transparent opacity={0.23} blending={THREE.AdditiveBlending} depthWrite={false} />
    </lineSegments>
    <lineSegments geometry={trailGeometry}>
      <lineBasicMaterial color={outcome === 'avoided' ? '#ff9f43' : '#ffd45b'} transparent opacity={0.86} blending={THREE.AdditiveBlending} depthWrite={false} />
    </lineSegments>
    {outcome === 'avoided' && <>
      <lineSegments geometry={flybyGeometry}>
        <lineBasicMaterial color="#ffbd45" transparent opacity={0.42} blending={THREE.AdditiveBlending} depthWrite={false} />
      </lineSegments>
      <lineSegments geometry={avoidanceVectorGeometry}>
        <lineBasicMaterial color="#55e3ae" transparent opacity={0.92} blending={THREE.AdditiveBlending} depthWrite={false} />
      </lineSegments>
    </>}
    <group ref={projectile}>
      <mesh rotation={[0.38, 0.72, 0.18]} scale={[1.18, 0.76, 0.92]}>
        <icosahedronGeometry args={[0.071, quality === 'cinematic' ? 1 : 0]} />
        <meshPhysicalMaterial color="#c98b28" emissive="#ffb42e" emissiveIntensity={0.82} roughness={0.76} metalness={0.52} clearcoat={0.12} />
      </mesh>
      {[0.08, 0.16, 0.24].map((distance, index) => <mesh key={distance} position={[0, 0, distance]} scale={1 - index * 0.22}>
        <octahedronGeometry args={[0.021, 0]} />
        <meshBasicMaterial color="#ffd45b" transparent opacity={0.56 - index * 0.11} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>)}
      <pointLight color="#ffbf3e" intensity={0.76} distance={0.72} decay={2} />
    </group>
    {outcome === 'avoided' && <group ref={nearMiss} name="safe-miss-marker">
      <pointLight color="#8fdcff" intensity={1.1} distance={1.2} />
    </group>}
    <group ref={burst}>
      <pointLight ref={impactLight} color="#ff735b" intensity={0} distance={3.2} decay={2} />
      <mesh ref={flash}>
        <icosahedronGeometry args={[0.18, 1]} />
        <meshBasicMaterial color="#fff0b8" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh ref={shockwave} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.2, 0.024, 8, 64]} />
        <meshBasicMaterial color="#ff6575" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {wreckageDirections.map((_, index) => <group key={`wreckage-${index}`} ref={(value) => { wreckageRefs.current[index] = value }}>
        {index < 2 ? <mesh>
          <boxGeometry args={[0.24, 0.014, 0.11]} />
          <meshPhysicalMaterial color="#244a91" emissive="#255fae" emissiveIntensity={0.18} roughness={0.42} metalness={0.58} clearcoat={0.18} />
        </mesh> : index < 4 ? <mesh scale={[1, 0.78, 1]}>
          <boxGeometry args={[0.105, 0.09, 0.13]} />
          <meshStandardMaterial color={index === 2 ? '#c95a44' : '#c6d0dc'} emissive={index === 2 ? '#8f251b' : '#454d59'} emissiveIntensity={0.24} roughness={0.46} metalness={0.72} />
        </mesh> : index === 4 ? <mesh rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.047, 0.12, 12]} />
          <meshStandardMaterial color="#d9e1eb" roughness={0.4} metalness={0.68} />
        </mesh> : <mesh>
          <cylinderGeometry args={[0.011, 0.016, 0.16, 10]} />
          <meshStandardMaterial color="#b8c5d4" roughness={0.44} metalness={0.74} />
        </mesh>}
      </group>)}
      {fragments.slice(0, quality === 'safe' ? 18 : quality === 'balanced' ? 30 : 42).map((_, index) => <mesh key={index} ref={(value) => { fragmentRefs.current[index] = value }}>
        <icosahedronGeometry args={[0.026 + (index % 4) * 0.009, 0]} />
        <meshStandardMaterial
          color={index % 4 === 0 ? '#e7c773' : index % 3 === 0 ? '#c77d23' : '#d8a33d'}
          emissive={index % 4 === 0 ? '#d88920' : '#8f4708'}
          emissiveIntensity={index % 4 === 0 ? 0.62 : 0.34}
          roughness={0.55}
          metalness={0.66}
        />
      </mesh>)}
    </group>
  </group>
}

function RecoveryArcs({ mission, view, reducedMotion }: { mission?: Mission; view: MissionView; reducedMotion: boolean }) {
  const visible = runningStatuses.has(mission?.status ?? '') || view === 'recovered' || view === 'diff'
  const group = useRef<THREE.Group>(null)
  const arcs = useMemo(() => [
    new THREE.QuadraticBezierCurve3(new THREE.Vector3(-2.4, .8, .2), new THREE.Vector3(0, 2.9, .7), new THREE.Vector3(2.1, -.3, 1.2)),
    new THREE.QuadraticBezierCurve3(new THREE.Vector3(-1.9, -1.2, 1), new THREE.Vector3(.2, 2.3, 1.8), new THREE.Vector3(2.35, .75, -.2)),
    new THREE.QuadraticBezierCurve3(new THREE.Vector3(-2.1, .25, -1), new THREE.Vector3(-.1, -2.4, 1.5), new THREE.Vector3(2.2, 1.1, .35)),
  ], [])
  useFrame((state) => {
    if (!reducedMotion && group.current) group.current.rotation.y = Math.sin(state.clock.elapsedTime * .15) * .035
  })
  if (!visible) return null
  const selected = view === 'recovered' || view === 'diff'
  return <group ref={group}>
    {arcs.map((curve, index) => <mesh key={index}>
      <tubeGeometry args={[curve, 72, selected && index === 1 ? 0.009 : 0.005, 5, false]} />
      <meshBasicMaterial
        color={selected && index === 1 ? '#5af0b8' : '#739df4'}
        transparent
        opacity={selected ? (index === 1 ? 0.56 : 0.08) : 0.11}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </mesh>)}
  </group>
}

function InteractiveCamera({ view, resetKey, manualControl, focusTarget, impactCamera, interactionElement, cameraCommand, compact = false }: {
  view: MissionView
  resetKey: number
  manualControl: { current: boolean }
  focusTarget: { current: THREE.Vector3 }
  impactCamera: { current: ImpactCameraState }
  interactionElement?: { current: HTMLDivElement | null }
  cameraCommand: GlobeCameraCommand
  compact?: boolean
}) {
  const { camera, gl } = useThree()
  const canvas = gl.domElement
  const controls = useRef<OrbitControls | null>(null)
  const settling = useRef(true)
  const desiredPosition = useMemo(() => new THREE.Vector3(), [])
  const desiredTarget = useMemo(() => new THREE.Vector3(), [])
  const chasePosition = useMemo(() => new THREE.Vector3(), [])
  const chaseTarget = useMemo(() => new THREE.Vector3(), [])
  const flightDirection = useMemo(() => new THREE.Vector3(), [])
  const radialDirection = useMemo(() => new THREE.Vector3(), [])
  const lateralDirection = useMemo(() => new THREE.Vector3(), [])
  const lockedFlightDirection = useMemo(() => new THREE.Vector3(), [])
  const lockedRadialDirection = useMemo(() => new THREE.Vector3(), [])
  const lockedLateralDirection = useMemo(() => new THREE.Vector3(), [])
  const cinematicBasisReady = useRef(false)

  useEffect(() => {
    const controlSurface = interactionElement?.current ?? canvas
    const orbit = new OrbitControls(camera, controlSurface)
    orbit.enableDamping = true
    orbit.dampingFactor = 0.065
    orbit.enablePan = false
    orbit.enableZoom = true
    orbit.enableRotate = true
    orbit.minDistance = view === 'incident' || view === 'recovered' ? 1.25 : compact ? 4.6 : 4.35
    orbit.maxDistance = compact ? 8.1 : 8.8
    orbit.minPolarAngle = Math.PI * 0.16
    orbit.maxPolarAngle = Math.PI * 0.84
    orbit.rotateSpeed = 0.58
    orbit.zoomSpeed = 0.62
    orbit.zoomToCursor = false
    const stopSettling = () => {
      settling.current = false
      manualControl.current = true
      orbit.minDistance = compact ? 4.6 : 4.35
      orbit.target.copy(origin)
      orbit.update()
      canvas.dataset.focusMode = 'manual'
      canvas.dataset.interactionMode = 'manual'
      canvas.dataset.orbitTarget = 'earth'
    }
    orbit.addEventListener('start', stopSettling)
    controls.current = orbit
    return () => {
      orbit.removeEventListener('start', stopSettling)
      orbit.dispose()
    }
  }, [camera, canvas, compact, interactionElement, manualControl, view])

  useEffect(() => {
    const incident = view === 'incident'
    const recovered = view === 'recovered'
    const encounter = incident || recovered
    const distance = compact ? 6.75 : encounter ? 5.8 : 6.25
    desiredPosition.set(encounter ? 0.42 : 0.08, compact ? 0.2 : 0.3, distance)
    desiredTarget.set(encounter ? 0.18 : 0, encounter ? 0.08 : 0.03, 0)
    manualControl.current = false
    impactCamera.current.hasSample = false
    impactCamera.current.sequenceTime = 0
    cinematicBasisReady.current = false
    canvas.dataset.focusMode = 'automatic'
    canvas.dataset.interactionMode = 'automatic'
    canvas.dataset.orbitTarget = 'satellite'
    canvas.dataset.cameraSequence = encounter ? 'arming' : 'overview'
    camera.position.copy(desiredPosition)
    if (controls.current) {
      controls.current.target.copy(desiredTarget)
      controls.current.update()
    }
    settling.current = true
  }, [camera, canvas, cinematicBasisReady, compact, desiredPosition, desiredTarget, impactCamera, manualControl, resetKey, view])

  useEffect(() => {
    const orbit = controls.current
    if (!orbit || cameraCommand.revision === 0) return
    if (cameraCommand.action === 'reset') {
      manualControl.current = false
      settling.current = true
      camera.position.copy(desiredPosition)
      orbit.target.copy(desiredTarget)
      canvas.dataset.focusMode = 'automatic'
      canvas.dataset.interactionMode = 'automatic'
      canvas.dataset.orbitTarget = 'satellite'
    } else {
      manualControl.current = true
      settling.current = false
      orbit.target.copy(origin)
      const scale = cameraCommand.action === 'zoom-in' ? 0.86 : 1.16
      camera.position.sub(orbit.target).multiplyScalar(scale).add(orbit.target)
      canvas.dataset.focusMode = 'manual'
      canvas.dataset.interactionMode = 'manual'
      canvas.dataset.orbitTarget = 'earth'
    }
    orbit.update()
  }, [camera, cameraCommand, canvas, desiredPosition, desiredTarget, manualControl])

  useFrame((state, delta) => {
    const orbit = controls.current
    if (!orbit) return
    if (!manualControl.current) {
      orbit.minDistance = view === 'incident' || view === 'recovered' ? 1.25 : compact ? 4.6 : 4.35
      const impact = impactCamera.current
      const cameraMode = incidentCameraMode(
        impact.sequenceTime,
        view === 'incident' || view === 'recovered',
        impact.hasSample,
      )
      const cinematic = encounterFrame(impact.sequenceTime)
      if ((cameraMode === 'debris-pov' || cameraMode === 'impact') && cinematic.phase !== 'establish') {
        if (!cinematicBasisReady.current) {
          lockedFlightDirection.copy(impact.velocity).normalize()
          lockedRadialDirection.copy(impact.projectile).normalize()
          lockedLateralDirection.crossVectors(lockedFlightDirection, lockedRadialDirection)
          if (lockedLateralDirection.lengthSq() < 0.0001) lockedLateralDirection.set(1, 0, 0)
          else lockedLateralDirection.normalize()
          cinematicBasisReady.current = true
        }
        flightDirection.copy(lockedFlightDirection)
        radialDirection.copy(lockedRadialDirection)
        lateralDirection.copy(lockedLateralDirection)
        const impactAge = Math.max(0, impact.sequenceTime - IMPACT_AT_SECONDS)
        const maneuverClose = view === 'recovered' && cinematic.phase === 'decision'
        const approaching = cameraMode === 'debris-pov' && !maneuverClose
        const collisionClose = view === 'incident' && !approaching
        const subject = approaching ? impact.projectile : impact.target
        chasePosition.copy(subject)
          .addScaledVector(flightDirection, approaching ? -0.62 : collisionClose ? -2.05 : -1.62)
          .addScaledVector(radialDirection, approaching ? 0.14 : collisionClose ? 0.48 : 0.38)
          .addScaledVector(lateralDirection, approaching ? 0.04 : collisionClose ? -1.24 : -1)
        if (!approaching && view === 'incident') {
          const shake = 0.012 * Math.exp(-impactAge * 3.4)
          chasePosition.x += Math.sin(state.clock.elapsedTime * 73) * shake
          chasePosition.y += Math.cos(state.clock.elapsedTime * 61) * shake * 0.72
        }
        chaseTarget.copy(approaching ? impact.projectile : impact.target)
          .addScaledVector(flightDirection, approaching ? 0.34 : 0.035)
        const pursuitRate = impact.sequenceTime < 0.34 ? 3.8 : approaching ? 8.2 : 2.8
        camera.position.lerp(chasePosition, 1 - Math.exp(-delta * pursuitRate))
        orbit.target.lerp(chaseTarget, 1 - Math.exp(-delta * (approaching ? 9.5 : 3.4)))
        canvas.dataset.cameraSequence = maneuverClose ? 'maneuver-close' : cameraMode
      } else {
        const establishing = cinematic.phase === 'establish'
        const returning = cameraMode === 'returning'
        // Hold on the consequence, then make a restrained dolly back. A slower
        // target transition prevents the wreckage from seeming to rush away.
        const positionRate = returning ? 0.32 : 4.7
        const targetRate = returning ? 0.4 : 6.3
        camera.position.lerp(desiredPosition, 1 - Math.exp(-delta * positionRate))
        orbit.target.lerp(
          focusTarget.current.lengthSq() > 0.01 ? focusTarget.current : desiredTarget,
          1 - Math.exp(-delta * targetRate),
        )
        canvas.dataset.cameraSequence = establishing ? 'establish' : returning ? 'returning' : 'overview'
      }
      if (camera.position.distanceTo(desiredPosition) < 0.025) settling.current = false
    } else {
      orbit.minDistance = compact ? 4.6 : 4.35
      canvas.dataset.cameraSequence = 'manual'
      canvas.dataset.interactionMode = 'manual'
    }
    canvas.dataset.cameraDistance = camera.position.distanceTo(origin).toFixed(3)
    orbit.update()
  })
  return null
}

function OrbitalScene({ mission, view, reducedMotion, manualControl, focusTarget, impactCamera, cinematicEncounter, sequenceEpochMs, animationKey, quality }: {
  mission?: Mission
  view: MissionView
  reducedMotion: boolean
  manualControl: { current: boolean }
  focusTarget: { current: THREE.Vector3 }
  impactCamera: { current: ImpactCameraState }
  cinematicEncounter: boolean
  sequenceEpochMs: number
  animationKey: number
  quality: RenderQuality
}) {
  const missionRoot = useRef<THREE.Group>(null)
  const { camera, gl } = useThree()
  const satellites = mission?.snapshot.satellites ?? fallbackSatellites
  const trackedIndex = Math.max(0, satellites.findIndex((satellite) => satellite.id === PRIMARY_IMPACT_SATELLITE_ID))
  const tracked = satellites[trackedIndex]
  const localDirection = useMemo(() => new THREE.Vector3(), [])
  const cameraDirection = useMemo(() => new THREE.Vector3(), [])
  const focusRotation = useMemo(() => new THREE.Quaternion(), [])
  const trackedWorld = useMemo(() => new THREE.Vector3(), [])
  const projectedTracked = useMemo(() => new THREE.Vector3(), [])
  const frameCounter = useRef(0)
  const incident = view === 'incident'
  const recovered = view === 'recovered' || view === 'diff'

  useFrame((state, delta) => {
    if (!missionRoot.current) return
    const sequenceTime = reducedMotion
      ? IMPACT_CAMERA_RETURN_UNTIL_SECONDS
      : Math.max(0, (performance.now() - sequenceEpochMs) / 1000)
    const elapsed = reducedMotion ? 0 : incident || view === 'recovered' ? sequenceTime : state.clock.elapsedTime
    localDirection.copy(satellitePosition(tracked.orbit_phase_deg, trackedIndex, elapsed)).normalize()
    const cameraMode = incidentCameraMode(
      impactCamera.current.sequenceTime,
      cinematicEncounter && (incident || view === 'recovered'),
      impactCamera.current.hasSample,
    )
    const cameraSequenceActive = cameraMode === 'debris-pov' || cameraMode === 'impact' || cameraMode === 'returning'
    if (!manualControl.current && !cameraSequenceActive) {
      cameraDirection.copy(camera.position).normalize()
      focusRotation.setFromUnitVectors(localDirection, cameraDirection)
      if (reducedMotion) missionRoot.current.quaternion.copy(focusRotation)
      else missionRoot.current.quaternion.slerp(focusRotation, 1 - Math.exp(-delta * 1.35))
    }
    trackedWorld.copy(view === 'recovered'
      ? avoidedSatellitePosition(tracked.orbit_phase_deg, trackedIndex, elapsed, impactCamera.current.sequenceTime)
      : satellitePosition(tracked.orbit_phase_deg, trackedIndex, elapsed))
      .applyQuaternion(missionRoot.current.quaternion)
    if (!manualControl.current) focusTarget.current.copy(trackedWorld)
    frameCounter.current += 1
    if (frameCounter.current % 10 === 0) {
      projectedTracked.copy(trackedWorld).project(camera)
      gl.domElement.dataset.focusNdc = `${projectedTracked.x.toFixed(3)},${projectedTracked.y.toFixed(3)}`
      gl.domElement.dataset.focusMode = manualControl.current ? 'manual' : 'automatic'
      gl.domElement.dataset.focusSatellite = tracked.id
      gl.domElement.dataset.cinematicPhase = encounterFrame(sequenceTime).phase
    }
  })

  return <>
    <color attach="background" args={['#111216']} />
    <fog attach="fog" args={['#111216', 8, 23]} />
    <ambientLight intensity={incident ? 0.7 : 0.76} />
    <hemisphereLight color="#eaf7ff" groundColor="#154f83" intensity={incident ? 0.96 : 1.08} />
    <directionalLight position={[4.5, 4, 5]} intensity={incident ? 1.95 : 2.3} color="#f2f8ff" />
    <pointLight position={[-4, -2, 3]} intensity={incident ? 3.1 : recovered ? 2.25 : 1.8} color={incident ? '#365be0' : '#46a9ff'} distance={13} />
    <pointLight position={[3.2, 1.2, -2]} intensity={incident ? 1.8 : 1.1} color={incident ? '#ff5265' : '#7a5cff'} distance={10} />
    <StarField reducedMotion={reducedMotion} quality={quality} />
    <group rotation={[0.08, 0, -0.08]}>
      <Earth view={view} reducedMotion={reducedMotion} quality={quality} />
      <GroundStations mission={mission} view={view} reducedMotion={reducedMotion} />
    </group>
    <group ref={missionRoot}>
      <OrbitRings view={view} />
      <OpticalNetwork mission={mission} view={view} reducedMotion={reducedMotion} />
      <SatelliteFleet key={`fleet-${animationKey}`} mission={mission} view={view} reducedMotion={reducedMotion} sequenceEpochMs={sequenceEpochMs} />
      <WorkloadPulses mission={mission} view={view} reducedMotion={reducedMotion} />
      {(view === 'incident' || view === 'recovered') && <OrbitalEncounter
        key={`encounter-${view}-${animationKey}`}
        mission={mission}
        reducedMotion={reducedMotion}
        cameraState={impactCamera}
        outcome={view === 'incident' ? 'collision' : 'avoided'}
        sequenceEpochMs={sequenceEpochMs}
        quality={quality}
      />}
      <RecoveryArcs mission={mission} view={view} reducedMotion={reducedMotion} />
    </group>
  </>
}

class GlobeErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

function AccessibleFallback({ mission, view, onRetry }: { mission?: Mission; view: MissionView; onRetry?: () => void }) {
  const affected = mission?.telemetry.flatMap((event) => event.affected_resources) ?? []
  const labels: Record<MissionView, string> = {
    nominal: 'Network before failure',
    incident: 'Network during the failure',
    recovered: 'Network using the checked plan',
    diff: 'What the checked plan changed',
  }
  return <div className="globe-fallback" role="img" aria-label="Textual orbital mission state">
    <strong>{labels[view]}</strong>
    <p>{mission?.snapshot.satellites.length ?? 12} simulated satellites · {affected.length} affected resources</p>
    {affected.length > 0 && <code>{affected.join(' · ')}</code>}
    {onRetry && <button type="button" onClick={onRetry}>Retry 3D view</button>}
  </div>
}

const stageCopy: Record<MissionView, { kicker: string; title: string; detail: string }> = {
  nominal: { kicker: 'NOMINAL GRID', title: 'All required work has a route', detail: 'Blue pulses are compute output moving toward ground contact.' },
  incident: { kicker: 'SIMULATED IMPACT', title: 'Debris severs a route in real time', detail: 'The struck node tumbles, fragments spread, links fail, and queued work stalls.' },
  recovered: { kicker: 'CHECKED RESPONSE', title: 'Same threat. SAT-07 moves clear.', detail: 'The safe miss is an illustrative sandbox view. The schedule and every mission obligation are independently checked.' },
  diff: { kicker: 'SAME CLOCK / TWO OUTCOMES', title: 'Collision on the left. Safe miss on the right.', detail: 'Both sides use the same debris path, encounter point, camera, and timing.' },
}

function AdaptiveQuality({ compact, onQuality }: { compact: boolean; onQuality: (quality: RenderQuality) => void }) {
  const { gl, setDpr } = useThree()
  const quality = useRef<RenderQuality>('cinematic')
  const elapsed = useRef(0)
  const totalDelta = useRef(0)
  const frames = useRef(0)
  const stableWindows = useRef(0)
  useEffect(() => {
    const targetDpr = compact ? 1.2 : 1.5
    setDpr(Math.min(window.devicePixelRatio || 1, targetDpr))
    gl.domElement.dataset.renderQuality = quality.current
  }, [compact, gl, setDpr])
  useFrame((_, delta) => {
    elapsed.current += delta
    totalDelta.current += Math.min(delta, 0.2)
    frames.current += 1
    if (elapsed.current < 2) return
    const averageMs = (totalDelta.current / Math.max(1, frames.current)) * 1000
    gl.domElement.dataset.frameMeanMs = averageMs.toFixed(2)
    gl.domElement.dataset.frameRate = (1000 / Math.max(averageMs, 0.01)).toFixed(1)
    let next = quality.current
    if (averageMs > 27) {
      next = quality.current === 'cinematic' ? 'balanced' : 'safe'
      stableWindows.current = 0
    } else if (averageMs < 18) {
      stableWindows.current += 1
      if (stableWindows.current >= 3) next = quality.current === 'safe' ? 'balanced' : 'cinematic'
    } else {
      stableWindows.current = 0
    }
    if (next !== quality.current) {
      quality.current = next
      const cap = next === 'cinematic' ? (compact ? 1.2 : 1.5) : next === 'balanced' ? 1.25 : 1
      setDpr(Math.min(window.devicePixelRatio || 1, cap))
      gl.domElement.dataset.renderQuality = next
      onQuality(next)
    }
    elapsed.current = 0
    totalDelta.current = 0
    frames.current = 0
  })
  return null
}

function WebGLContextObserver({ onContextState }: {
  onContextState?: (state: 'ready' | 'lost' | 'restored') => void
}) {
  const { gl } = useThree()
  useEffect(() => {
    const canvas = gl.domElement
    let active = true
    const handleLost = (event: Event) => {
      event.preventDefault()
      if (!canvas.isConnected) return
      canvas.dataset.contextStatus = 'lost'
      if (active) onContextState?.('lost')
    }
    const handleRestored = () => {
      if (active) onContextState?.('restored')
      canvas.dataset.contextStatus = 'restored'
    }
    canvas.addEventListener('webglcontextlost', handleLost)
    canvas.addEventListener('webglcontextrestored', handleRestored)
    canvas.dataset.contextStatus = 'ready'
    onContextState?.('ready')
    return () => {
      active = false
      canvas.removeEventListener('webglcontextlost', handleLost)
      canvas.removeEventListener('webglcontextrestored', handleRestored)
    }
  }, [gl, onContextState])
  return null
}

function SceneCanvas({ mission, view, reducedMotion, resetKey, sequenceEpochMs, interactionElement, cameraCommand, compact = false, onContextState }: {
  mission?: Mission
  view: MissionView
  reducedMotion: boolean
  resetKey: number
  sequenceEpochMs: number
  interactionElement?: { current: HTMLDivElement | null }
  cameraCommand: GlobeCameraCommand
  compact?: boolean
  onContextState?: (state: 'ready' | 'lost' | 'restored') => void
}) {
  const [quality, setQuality] = useState<RenderQuality>('cinematic')
  const manualControl = useRef(false)
  const focusTarget = useRef(new THREE.Vector3())
  const impactCamera = useRef<ImpactCameraState>({
    hasSample: false,
    sequenceTime: 0,
    projectile: new THREE.Vector3(),
    target: new THREE.Vector3(),
    velocity: new THREE.Vector3(0, 0, -1),
  })
  return <Canvas
    dpr={compact ? [1, 1.3] : [1, 1.55]}
    camera={{ position: [0, 0.28, compact ? 6.75 : 6.25], fov: compact ? 44 : 41, near: 0.1, far: 80 }}
    gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
    onCreated={({ gl }) => {
      gl.toneMapping = THREE.ACESFilmicToneMapping
      gl.toneMappingExposure = 1.15
      gl.outputColorSpace = THREE.SRGBColorSpace
      gl.domElement.dataset.zoomEnabled = 'true'
      gl.domElement.dataset.interactionActive = 'false'
    }}
  >
    <WebGLContextObserver onContextState={onContextState} />
    <AdaptiveQuality compact={compact} onQuality={setQuality} />
    <OrbitalScene
      key={`scene-${view}-${resetKey}`}
      mission={mission}
      view={view}
      reducedMotion={reducedMotion}
      manualControl={manualControl}
      focusTarget={focusTarget}
      impactCamera={impactCamera}
      cinematicEncounter={!reducedMotion}
      sequenceEpochMs={sequenceEpochMs}
      animationKey={resetKey}
      quality={quality}
    />
    <InteractiveCamera
      view={view}
      resetKey={resetKey}
      manualControl={manualControl}
      focusTarget={focusTarget}
      impactCamera={impactCamera}
      interactionElement={interactionElement}
      cameraCommand={cameraCommand}
      compact={compact}
    />
  </Canvas>
}

export function OrbitalGlobe({ mission, view, replayKey = 0, automaticStoryActive = false, onReplay }: {
  mission?: Mission
  view: MissionView
  replayKey?: number
  automaticStoryActive?: boolean
  onReplay?: () => void
}) {
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  const webgl = typeof window.WebGL2RenderingContext !== 'undefined' || typeof window.WebGLRenderingContext !== 'undefined'
  const [resetKey, setResetKey] = useState(0)
  const [rendererKey, setRendererKey] = useState(0)
  const [contextState, setContextState] = useState<'ready' | 'lost' | 'restored'>('ready')
  const interactionElement = useRef<HTMLDivElement>(null)
  const [cameraCommand, setCameraCommand] = useState<GlobeCameraCommand>({ revision: 0, action: 'reset' })
  const [comparisonSplit, setComparisonSplit] = useState(50)
  const lossRecoveryTimer = useRef<number | undefined>(undefined)
  const stableRecoveryTimer = useRef<number | undefined>(undefined)
  const automaticRecoveryAttempted = useRef(false)
  useEffect(() => () => {
    if (lossRecoveryTimer.current !== undefined) window.clearTimeout(lossRecoveryTimer.current)
    if (stableRecoveryTimer.current !== undefined) window.clearTimeout(stableRecoveryTimer.current)
  }, [])
  const handleContextState = useCallback((nextState: 'ready' | 'lost' | 'restored') => {
    if (nextState === 'restored' || nextState === 'ready') {
      if (lossRecoveryTimer.current !== undefined) window.clearTimeout(lossRecoveryTimer.current)
      lossRecoveryTimer.current = undefined
      setContextState(nextState)
      if (stableRecoveryTimer.current !== undefined) window.clearTimeout(stableRecoveryTimer.current)
      stableRecoveryTimer.current = window.setTimeout(() => {
        automaticRecoveryAttempted.current = false
        stableRecoveryTimer.current = undefined
      }, 10000)
    } else {
      setContextState('lost')
      if (lossRecoveryTimer.current !== undefined) return
      lossRecoveryTimer.current = window.setTimeout(() => {
        lossRecoveryTimer.current = undefined
        if (!automaticRecoveryAttempted.current) {
          automaticRecoveryAttempted.current = true
          setContextState('ready')
          setRendererKey((current) => current + 1)
        }
      }, 700)
    }
  }, [])
  const retryRenderer = () => {
    if (lossRecoveryTimer.current !== undefined) window.clearTimeout(lossRecoveryTimer.current)
    lossRecoveryTimer.current = undefined
    automaticRecoveryAttempted.current = true
    setContextState('ready')
    setRendererKey((current) => current + 1)
  }
  const issueCameraCommand = (action: GlobeCameraCommand['action']) => {
    if (action === 'reset') setResetKey((current) => current + 1)
    setCameraCommand((current) => ({ revision: current.revision + 1, action }))
  }
  const setInteractionActive = (active: boolean) => {
    interactionElement.current?.parentElement?.querySelectorAll('canvas').forEach((canvas) => {
      canvas.dataset.interactionActive = String(active)
    })
  }
  const fallback = <AccessibleFallback mission={mission} view={view} onRetry={retryRenderer} />
  const copy = stageCopy[view]
  const sequenceClock = useMemo(() => ({
    epochMs: performance.now(),
    revision: `${view}:${resetKey}:${replayKey}`,
  }), [replayKey, resetKey, view])
  const sequenceEpochMs = sequenceClock.epochMs
  const animationRevision = resetKey * 1000000 + replayKey
  if (!webgl) return fallback
  return <div
    className={`globe-stage ${view === 'diff' ? 'globe-stage-comparison' : ''}`}
    data-view={view}
    data-status={mission?.status ?? 'ready'}
  >
    <GlobeErrorBoundary key={rendererKey} fallback={fallback}>
      {view === 'diff' ? <div className="globe-comparison" aria-label="Interactive before and after mission comparison" style={{ gridTemplateColumns: `${comparisonSplit}% ${100 - comparisonSplit}%` }}>
        <div className="comparison-half comparison-before">
          <div className="comparison-label"><span>WITHOUT RESPONSE</span><strong>SAT-07 remains in the collision path</strong><small>Impact · fragments · routes severed</small></div>
          <SceneCanvas mission={mission} view="incident" reducedMotion={reducedMotion} resetKey={animationRevision} sequenceEpochMs={sequenceEpochMs} interactionElement={interactionElement} cameraCommand={cameraCommand} compact onContextState={handleContextState} />
        </div>
        <div className="comparison-divider" style={{ left: `${comparisonSplit}%` }} aria-hidden="true"><span>→</span></div>
        <div className="comparison-half comparison-after">
          <div className="comparison-label"><span>CHECKED RESPONSE</span><strong>SAT-07 moves clear before the same encounter</strong><small>Safe miss · mandatory work preserved</small></div>
          <SceneCanvas mission={mission} view="recovered" reducedMotion={reducedMotion} resetKey={animationRevision} sequenceEpochMs={sequenceEpochMs} interactionElement={interactionElement} cameraCommand={cameraCommand} compact onContextState={handleContextState} />
        </div>
      </div> : <SceneCanvas mission={mission} view={view} reducedMotion={reducedMotion} resetKey={animationRevision} sequenceEpochMs={sequenceEpochMs} interactionElement={interactionElement} cameraCommand={cameraCommand} onContextState={handleContextState} />}
    </GlobeErrorBoundary>
    {contextState === 'lost' && <div className="webgl-recovery" role="status">
      <strong>Restoring the 3D view</strong>
      <small>The mission data and checker remain available.</small>
      <button type="button" onClick={retryRenderer}>Retry 3D view</button>
    </div>}
    <div className="globe-cinematic-hud" aria-hidden="true">
      {view !== 'diff' && <div className={`globe-focus-chip focus-${view}`}>
        <span>CAMERA FOCUS</span>
        <strong>SAT-07</strong>
        <small>{view === 'nominal' ? 'Predicted impact target' : view === 'incident' ? 'Impact and debris field' : 'Illustrative safe miss · checked schedule'}</small>
      </div>}
      <div className={`globe-state-card state-${view}`}>
        <span>{copy.kicker}</span>
        <strong>{copy.title}</strong>
        <small>{copy.detail}</small>
      </div>
      <div className="globe-legend">
        <span><i className="legend-active" />Available</span>
        <span><i className="legend-failed" />Impact</span>
        <span><i className="legend-isolated" />Isolated</span>
        <span><i className="legend-verified" />Checked recovery</span>
      </div>
    </div>
    {(view === 'incident' || view === 'recovered') && <div className={`ground-station-alert ${view === 'recovered' ? 'bypassed' : ''}`} role="status">
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M7 26h18M12 26l3-11h2l3 11M10 10a9 9 0 0 1 12-3l-7 8a7 7 0 0 1-5-5Z" />
        <path d="M21 13c2 1 3 3 3 5M23 9c4 2 6 5 6 9" />
        {view === 'incident' && <path className="station-slash" d="M5 5l22 22" />}
      </svg>
      <span>
        <small>{view === 'incident' ? 'GROUND STATION OFFLINE' : 'OUTAGE ISOLATED'}</small>
        <strong>GS-PACIFIC-02</strong>
        <em>{view === 'incident' ? 'Contact signal lost · window unavailable' : 'Station remains offline · traffic rerouted'}</em>
      </span>
    </div>}
    {view === 'incident' && <div className="impact-sequence" key={`impact-sequence-${resetKey}-${replayKey}`} aria-hidden="true">
      <span><i />01 · DEBRIS DETECTED</span>
      <span><i />02 · NODE IMPACT</span>
      <span><i />03 · ROUTES SEVERED</span>
    </div>}
    {view === 'recovered' && <div className="impact-sequence avoidance-sequence" key={`avoidance-sequence-${resetKey}-${replayKey}`} aria-hidden="true">
      <span><i />01 · SAME DEBRIS</span>
      <span><i />02 · SAT-07 MOVES CLEAR</span>
      <span><i />03 · SAFE MISS</span>
      <span><i />04 · DEBRIS CONTINUES CLEAR</span>
    </div>}
    {(view === 'incident' || view === 'recovered') && !reducedMotion && <div className={`debris-pov-label ${view === 'recovered' ? 'safe' : ''}`} key={`debris-pov-${view}-${resetKey}-${replayKey}`} aria-hidden="true">
      <span>{view === 'incident' ? 'DEBRIS POV' : 'SAME DEBRIS POV'}</span>
      <strong>{view === 'incident' ? 'Closing on SAT-07' : 'SAT-07 begins the checked response'}</strong>
      <small>{view === 'incident' ? 'Camera returns to mission control after impact' : 'Blue control thruster plume marks the illustrative impulse'}</small>
    </div>}
    {view === 'diff' && <div className="comparison-change-summary" aria-hidden="true">
      <span>WHAT CHANGED</span>
      <strong>Same debris. Same clock. Left collides. Right moves clear while mandatory work stays scheduled.</strong>
      <small>Orbital motion is illustrative. Schedule verification remains authoritative.</small>
    </div>}
    {view === 'diff' && <div className="comparison-controls" aria-label="Before and after comparison controls">
      <button type="button" onClick={() => setComparisonSplit(96)}>Show collision</button>
      <button type="button" onClick={() => setComparisonSplit(50)}>Split view</button>
      <button type="button" onClick={() => setComparisonSplit(4)}>Show checked plan</button>
      <label><span>Comparison divider</span><input aria-label="Comparison divider" type="range" min="0" max="100" value={comparisonSplit} onChange={(event) => setComparisonSplit(Number(event.target.value))} /></label>
    </div>}
    <div
      ref={interactionElement}
      className="globe-interaction-surface"
      role="application"
      tabIndex={0}
      aria-label="Interactive globe area. Drag to rotate and scroll to zoom."
      onPointerEnter={() => setInteractionActive(true)}
      onPointerLeave={() => setInteractionActive(false)}
      onFocus={() => setInteractionActive(true)}
      onBlur={() => setInteractionActive(false)}
      onDoubleClick={() => issueCameraCommand('reset')}
    ><span>Drag here to rotate · Scroll here to zoom</span></div>
    <div className="globe-interaction-help">
      <span><b>DRAG</b> rotate · <b>SCROLL</b> zoom in the center</span>
      {onReplay && <button
        type="button"
        className={`incident-replay-button ${automaticStoryActive ? 'playing' : ''}`}
        onClick={onReplay}
        aria-live="polite"
      >{automaticStoryActive ? '● Story playing' : '▶ Replay full sequence'}</button>}
      <button type="button" onClick={() => issueCameraCommand('zoom-in')} aria-label="Zoom globe in">＋</button>
      <button type="button" onClick={() => issueCameraCommand('zoom-out')} aria-label="Zoom globe out">−</button>
      <button type="button" onClick={() => issueCameraCommand('reset')} aria-label="Reset globe camera">↺ Reset view</button>
    </div>
    <div className="globe-status-rail" aria-hidden="true">
      <span className={view !== 'nominal' ? 'lit alert' : 'lit'} />
      <i />
      <span className={['recovered', 'diff'].includes(view) ? 'lit recovered' : ''} />
    </div>
    <span className="sr-only">
      {view === 'nominal'
        ? 'Simulated network before the failure.'
        : `Simulated network view: ${view}. Affected resources are ${mission?.telemetry.flatMap((event) => event.affected_resources).join(', ') || 'pending'}.`}
    </span>
  </div>
}
