import { Canvas, useFrame } from '@react-three/fiber'
import { Component, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import * as THREE from 'three'
import type { Mission, MissionView } from '../types'

const fallbackSatellites = Array.from({ length: 12 }, (_, index) => ({
  id: `SAT-${String(index + 1).padStart(2, '0')}`,
  orbit_phase_deg: index * 30,
  isolated: false,
  energy_capacity: 100,
  storage_capacity: 100,
}))

function satellitePosition(phaseDegrees: number, index: number, elapsed = 0): THREE.Vector3 {
  const radius = 2.05 + (index % 3) * 0.28
  const phase = THREE.MathUtils.degToRad(phaseDegrees) + elapsed * (0.035 + (index % 3) * 0.008)
  return new THREE.Vector3(
    Math.cos(phase) * radius,
    Math.sin(phase * 0.94) * 0.62 + ((index % 3) - 1) * 0.18,
    Math.sin(phase) * radius * 0.72,
  )
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

function InstancedSatellites({ mission, view, reducedMotion }: {
  mission?: Mission
  view: MissionView
  reducedMotion: boolean
}) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const satellites = mission?.snapshot.satellites ?? fallbackSatellites
  const selectedBundles = new Set(mission?.plan?.selected_bundle_ids ?? [])
  const recoveredSatellites = new Set(
    mission?.bundles.filter((bundle) => selectedBundles.has(bundle.id)).map((bundle) => bundle.satellite_id) ?? [],
  )
  const failed = new Set(
    mission?.telemetry.flatMap((event) => event.affected_resources)
      .filter((resource) => resource.startsWith('COMPUTE-'))
      .map((resource) => resource.replace('COMPUTE-', '')) ?? ['SAT-07', 'SAT-08'],
  )
  const helper = useMemo(() => new THREE.Object3D(), [])
  const colors = useMemo(() => ({
    nominal: new THREE.Color('#67a1ff'),
    failed: new THREE.Color('#ff5b6e'),
    recovered: new THREE.Color('#59e2b0'),
  }), [])

  useFrame((state) => {
    const mesh = ref.current
    if (!mesh) return
    const elapsed = reducedMotion ? 0 : state.clock.elapsedTime
    satellites.forEach((satellite, index) => {
      helper.position.copy(satellitePosition(satellite.orbit_phase_deg, index, elapsed))
      const isFailed = view !== 'nominal' && failed.has(satellite.id)
      const isRecovered = ['recovered', 'diff'].includes(view) && recoveredSatellites.has(satellite.id)
      const pulse = isRecovered && !reducedMotion ? 1 + Math.sin(elapsed * 3 + index) * 0.12 : 1
      helper.scale.setScalar((isFailed ? 1.22 : 1) * pulse)
      helper.updateMatrix()
      mesh.setMatrixAt(index, helper.matrix)
      mesh.setColorAt(index, isFailed ? colors.failed : isRecovered ? colors.recovered : colors.nominal)
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, satellites.length]} frustumCulled={false}>
      <icosahedronGeometry args={[0.075, 1]} />
      <meshStandardMaterial roughness={0.28} metalness={0.55} emissive="#1a4fbe" emissiveIntensity={0.28} />
    </instancedMesh>
  )
}

function OrbitRings({ incident }: { incident: boolean }) {
  return <group rotation={[Math.PI / 2.8, 0.08, -0.22]}>
    {[2.05, 2.33, 2.61].map((radius) => (
      <mesh key={radius} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[radius, 0.006, 6, 160]} />
        <meshBasicMaterial color={incident ? '#334b79' : '#8eb4ef'} transparent opacity={0.34} />
      </mesh>
    ))}
  </group>
}

function GroundStations({ mission, view }: { mission?: Mission; view: MissionView }) {
  const stations = mission?.snapshot.ground_stations ?? []
  const failed = view !== 'nominal' ? 'GS-PACIFIC-02' : undefined
  return <group>
    {stations.map((station) => {
      const position = globePosition(station.latitude, station.longitude)
      const direction = position.clone().normalize()
      const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction)
      const isFailed = station.id === failed
      return <group key={station.id} position={position} quaternion={rotation}>
        <mesh>
          <sphereGeometry args={[0.045, 12, 12]} />
          <meshBasicMaterial color={isFailed ? '#ff5b6e' : '#7ce2ff'} />
        </mesh>
        <mesh position={[0, 0.17, 0]}>
          <coneGeometry args={[0.13, 0.34, 20, 1, true]} />
          <meshBasicMaterial
            color={isFailed ? '#ff5b6e' : '#6bd8ff'}
            transparent
            opacity={isFailed ? 0.1 : 0.12}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>
    })}
  </group>
}

function OpticalLinks({ mission, view }: { mission?: Mission; view: MissionView }) {
  const geometry = useMemo(() => {
    const satellites = mission?.snapshot.satellites ?? fallbackSatellites
    const byId = new Map(satellites.map((satellite, index) => [
      satellite.id,
      satellitePosition(satellite.orbit_phase_deg, index),
    ]))
    const points = (mission?.snapshot.links ?? []).flatMap((link) => {
      const source = byId.get(link.source)
      const target = byId.get(link.target)
      return source && target ? [source, target] : []
    })
    return new THREE.BufferGeometry().setFromPoints(points)
  }, [mission])
  return <lineSegments geometry={geometry}>
    <lineBasicMaterial
      color={view === 'incident' ? '#677a9f' : view === 'nominal' ? '#6abfff' : '#5ce1b0'}
      transparent
      opacity={view === 'incident' ? 0.26 : 0.62}
    />
  </lineSegments>
}

function OrbitalScene({ mission, view, reducedMotion }: {
  mission?: Mission
  view: MissionView
  reducedMotion: boolean
}) {
  const group = useRef<THREE.Group>(null)
  const incident = view === 'incident'
  useFrame((state, delta) => {
    if (group.current && !reducedMotion) {
      group.current.rotation.y += delta * (incident ? 0.018 : 0.038)
      group.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.14) * 0.035
    }
  })
  return <>
    <ambientLight intensity={incident ? 0.42 : 0.92} />
    <directionalLight position={[4, 4, 5]} intensity={incident ? 1.1 : 1.8} color="#dcecff" />
    <pointLight position={[-4, -2, 3]} intensity={incident ? 2 : 1} color={incident ? '#365be0' : '#53c9ff'} />
    <group ref={group} rotation={[0.12, -0.15, 0]}>
      <mesh>
        <sphereGeometry args={[1.28, 64, 64]} />
        <meshStandardMaterial
          color={incident ? '#142449' : '#b9dcff'}
          roughness={0.72}
          metalness={0.04}
          emissive={incident ? '#07142d' : '#2b6dad'}
          emissiveIntensity={incident ? 0.32 : 0.12}
        />
      </mesh>
      <mesh scale={1.035}>
        <sphereGeometry args={[1.28, 48, 48]} />
        <meshBasicMaterial color="#76d7ff" transparent opacity={incident ? 0.055 : 0.11} side={THREE.BackSide} />
      </mesh>
      <OrbitRings incident={incident} />
      <OpticalLinks mission={mission} view={view} />
      <GroundStations mission={mission} view={view} />
      <InstancedSatellites mission={mission} view={view} reducedMotion={reducedMotion} />
    </group>
  </>
}

class GlobeErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

function AccessibleFallback({ mission, view }: { mission?: Mission; view: MissionView }) {
  const affected = mission?.telemetry.flatMap((event) => event.affected_resources) ?? []
  return <div className="globe-fallback" role="img" aria-label="Textual orbital mission state">
    <strong>{view === 'nominal' ? 'Nominal constellation' : `${view} mission state`}</strong>
    <p>{mission?.snapshot.satellites.length ?? 12} simulated satellites · {affected.length} affected resources</p>
    {affected.length > 0 && <code>{affected.join(' · ')}</code>}
  </div>
}

export function OrbitalGlobe({ mission, view }: { mission?: Mission; view: MissionView }) {
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  const webgl = Boolean(document.createElement('canvas').getContext('webgl2'))
  const fallback = <AccessibleFallback mission={mission} view={view} />
  if (!webgl) return fallback
  return <div className="globe-stage" data-view={view}>
    <GlobeErrorBoundary fallback={fallback}>
      <Canvas
        dpr={[1, 1.65]}
        camera={{ position: [0, 0.4, 6.4], fov: 43, near: 0.1, far: 100 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        fallback={fallback}
      >
        <OrbitalScene mission={mission} view={view} reducedMotion={reducedMotion} />
      </Canvas>
    </GlobeErrorBoundary>
    <div className="globe-status-rail" aria-hidden="true">
      <span className={view !== 'nominal' ? 'lit alert' : 'lit'} />
      <i />
      <span className={['recovered', 'diff'].includes(view) ? 'lit recovered' : ''} />
    </div>
    <span className="sr-only">
      {view === 'nominal'
        ? 'Nominal simulated constellation.'
        : `Mission ${view}. Affected resources are ${mission?.telemetry.flatMap((event) => event.affected_resources).join(', ') || 'pending'}.`}
    </span>
  </div>
}
