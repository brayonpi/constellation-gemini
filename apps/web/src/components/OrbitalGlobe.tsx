import { useEffect, useRef } from 'react'
import type { Mission } from '../types'

type View = 'nominal' | 'incident' | 'recovered' | 'diff'

export function OrbitalGlobe({ mission, view }: { mission?: Mission; view: View }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    let frame = 0
    let animation = 0
    const scale = window.devicePixelRatio || 1

    const draw = () => {
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      canvas.width = width * scale
      canvas.height = height * scale
      context.setTransform(scale, 0, 0, scale, 0, 0)
      context.clearRect(0, 0, width, height)
      const cx = width / 2
      const cy = height / 2 + 18
      const radius = Math.min(width, height) * 0.245

      const halo = context.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius * 1.65)
      halo.addColorStop(0, 'rgba(50, 112, 255, .17)')
      halo.addColorStop(0.55, 'rgba(74, 132, 255, .06)')
      halo.addColorStop(1, 'rgba(255,255,255,0)')
      context.fillStyle = halo
      context.beginPath()
      context.arc(cx, cy, radius * 1.7, 0, Math.PI * 2)
      context.fill()

      context.strokeStyle = 'rgba(69, 113, 184, .15)'
      context.lineWidth = 1
      for (const orbitScale of [1.38, 1.62, 1.88]) {
        context.save()
        context.translate(cx, cy)
        context.rotate(-0.18)
        context.scale(1, 0.36)
        context.beginPath()
        context.arc(0, 0, radius * orbitScale, 0, Math.PI * 2)
        context.stroke()
        context.restore()
      }

      const earth = context.createRadialGradient(cx - radius * .4, cy - radius * .5, radius * .1, cx, cy, radius)
      earth.addColorStop(0, '#edf8ff')
      earth.addColorStop(.58, '#bed9fb')
      earth.addColorStop(1, '#6e9cda')
      context.fillStyle = earth
      context.beginPath()
      context.arc(cx, cy, radius, 0, Math.PI * 2)
      context.fill()
      context.save()
      context.beginPath()
      context.arc(cx, cy, radius - 1, 0, Math.PI * 2)
      context.clip()
      context.strokeStyle = 'rgba(255,255,255,.55)'
      for (let offset = -2; offset <= 2; offset += 1) {
        context.beginPath()
        context.ellipse(cx, cy + offset * radius * .34, radius, radius * .16, 0, 0, Math.PI * 2)
        context.stroke()
      }
      context.fillStyle = 'rgba(255,255,255,.34)'
      context.beginPath()
      context.ellipse(cx - radius * .25, cy - radius * .05, radius * .28, radius * .13, -.35, 0, Math.PI * 2)
      context.ellipse(cx + radius * .28, cy + radius * .25, radius * .2, radius * .1, .45, 0, Math.PI * 2)
      context.fill()
      context.restore()

      const satellites = mission?.snapshot.satellites ?? Array.from({ length: 12 }, (_, index) => ({ id: `SAT-${String(index + 1).padStart(2, '0')}`, orbit_phase_deg: index * 30, isolated: false }))
      const selected = new Set(mission?.plan?.selected_bundle_ids.flatMap((id) => id.match(/SAT-\d\d/g) ?? []))
      satellites.forEach((satellite, index) => {
        const orbit = 1.38 + (index % 3) * .25
        const phase = satellite.orbit_phase_deg * Math.PI / 180 + frame * .0012
        const x = cx + Math.cos(phase) * radius * orbit
        const y = cy + Math.sin(phase) * radius * orbit * .36
        const isFailed = view !== 'nominal' && ['SAT-07', 'SAT-08'].includes(satellite.id)
        const isRecovered = (view === 'recovered' || view === 'diff') && selected.has(satellite.id)
        context.fillStyle = isFailed ? '#e34a4a' : isRecovered ? '#20a879' : '#2767f0'
        context.shadowColor = context.fillStyle
        context.shadowBlur = 10
        context.beginPath()
        context.arc(x, y, isRecovered ? 4.8 : 3.6, 0, Math.PI * 2)
        context.fill()
        context.shadowBlur = 0
        if (isFailed) {
          context.strokeStyle = 'rgba(227, 74, 74, .35)'
          context.beginPath()
          context.arc(x, y, 9, 0, Math.PI * 2)
          context.stroke()
        }
      })

      frame += 1
      animation = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(animation)
  }, [mission, view])

  return <canvas className="globe-canvas" ref={canvasRef} aria-label="Data-driven orbital mission visualization" />
}
