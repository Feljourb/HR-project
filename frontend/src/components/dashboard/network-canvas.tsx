'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

/* Ambient artwork for the leadership video: the SBD distribution network, with deliveries
   travelling from the Casablanca and Tangier hubs. Cities sit at their real coordinates
   (equirectangular, lon scaled by cos 32°). Static when reduced motion is requested,
   paused off-screen, in a background tab, or while the theater is open. */

const CITIES = [
  { id: 'tng', label: 'Tangier', lat: 35.77, lon: -5.8, hub: true, labelAt: 'left' },
  { id: 'tet', label: 'Tétouan', lat: 35.57, lon: -5.37 },
  { id: 'ouj', label: 'Oujda', lat: 34.68, lon: -1.91, labelAt: 'above' },
  { id: 'fes', label: 'Fès', lat: 34.03, lon: -5.0, labelAt: 'right' },
  { id: 'mek', label: 'Meknès', lat: 33.89, lon: -5.55 },
  { id: 'rab', label: 'Rabat', lat: 34.02, lon: -6.84 },
  { id: 'cas', label: 'Casablanca', lat: 33.57, lon: -7.59, hub: true, labelAt: 'left' },
  { id: 'bml', label: 'Béni Mellal', lat: 32.34, lon: -6.36 },
  { id: 'rak', label: 'Marrakech', lat: 31.63, lon: -8.01, labelAt: 'left' },
  { id: 'aga', label: 'Agadir', lat: 30.42, lon: -9.6, labelAt: 'left' },
  { id: 'lay', label: 'Laâyoune', lat: 27.15, lon: -13.2, labelAt: 'right' },
] as const

type CityId = (typeof CITIES)[number]['id']

const ROUTES: [CityId, CityId][] = [
  ['cas', 'rab'], ['cas', 'rak'], ['cas', 'bml'], ['rak', 'aga'], ['aga', 'lay'], ['rab', 'mek'],
  ['mek', 'fes'], ['fes', 'ouj'], ['tng', 'tet'], ['tng', 'rab'], ['tng', 'fes'], ['bml', 'fes'],
]

const BOUNDS = { lonMin: -13.8, lonMax: -1.4, latMin: 26.6, latMax: 36.2, k: 0.85 }

type Point = { x: number; y: number }

export function NetworkCanvas({ className, paused = false }: { className?: string; paused?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pausedRef = useRef(paused)
  const syncRef = useRef<() => void>(() => {})

  useEffect(() => {
    pausedRef.current = paused
    syncRef.current()
  }, [paused])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const mono = getComputedStyle(document.documentElement).getPropertyValue('--font-plex-mono').trim() || 'ui-monospace, monospace'
    let width = 0
    let height = 0
    let points = {} as Record<CityId, Point>
    let visible = true
    let frame = 0
    let running = false

    const layout = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = rect.width
      height = rect.height
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      /* The map occupies the right side and the left stays clear for the title. On narrow
         posters the title spans the full width, so the map moves to the band above it. */
      const area = width < 560
        ? { x: width * 0.22, y: 46, w: width * 0.72, h: Math.max(80, height - 320) }
        : { x: width * 0.42, y: height * 0.09, w: width * 0.53, h: height * 0.8 }
      const lonSpan = (BOUNDS.lonMax - BOUNDS.lonMin) * BOUNDS.k
      const latSpan = BOUNDS.latMax - BOUNDS.latMin
      const scale = Math.min(area.w / lonSpan, area.h / latSpan)
      const ox = area.x + area.w - lonSpan * scale
      const oy = area.y + (area.h - latSpan * scale) / 2
      points = Object.fromEntries(CITIES.map((c) => [c.id, { x: ox + (c.lon - BOUNDS.lonMin) * BOUNDS.k * scale, y: oy + (BOUNDS.latMax - c.lat) * scale }])) as Record<CityId, Point>
    }

    const control = (p: Point, q: Point): Point => {
      const mx = (p.x + q.x) / 2
      const my = (p.y + q.y) / 2
      return { x: mx - (q.y - p.y) * 0.18, y: my + (q.x - p.x) * 0.18 }
    }

    const along = (p: Point, c: Point, q: Point, u: number): Point => {
      const a = (1 - u) * (1 - u)
      const b = 2 * (1 - u) * u
      const d = u * u
      return { x: a * p.x + b * c.x + d * q.x, y: a * p.y + b * c.y + d * q.y }
    }

    const draw = (t: number) => {
      ctx.clearRect(0, 0, width, height)

      ctx.lineWidth = 1
      ctx.strokeStyle = 'rgba(233, 213, 192, 0.16)'
      for (const [a, b] of ROUTES) {
        const p = points[a]
        const q = points[b]
        const c = control(p, q)
        ctx.beginPath()
        ctx.moveTo(p.x, p.y)
        ctx.quadraticCurveTo(c.x, c.y, q.x, q.y)
        ctx.stroke()
      }

      ROUTES.forEach(([a, b], i) => {
        const p = points[a]
        const q = points[b]
        const c = control(p, q)
        for (let k = 0; k < 2; k++) {
          const speed = 0.06 + (i % 4) * 0.014
          const raw = (t * speed + i * 0.37 + k * 0.5) % 1
          const u = k === 0 ? raw : 1 - raw
          const fade = Math.sin(raw * Math.PI)
          for (let j = 0; j < 6; j++) {
            const uj = k === 0 ? u - j * 0.013 : u + j * 0.013
            if (uj < 0 || uj > 1) continue
            const pt = along(p, c, q, uj)
            ctx.fillStyle = `rgba(242, 201, 143, ${(0.9 * fade * (1 - j / 6)).toFixed(3)})`
            ctx.beginPath()
            ctx.arc(pt.x, pt.y, Math.max(0.6, 1.9 - j * 0.22), 0, Math.PI * 2)
            ctx.fill()
          }
        }
      })

      ctx.font = `500 9px ${mono}`
      ctx.textBaseline = 'middle'
      for (const city of CITIES) {
        const { x, y } = points[city.id]
        if ('hub' in city) {
          const phase = (t % 2.4) / 2.4
          ctx.strokeStyle = `rgba(242, 201, 143, ${(0.45 * (1 - phase)).toFixed(3)})`
          ctx.beginPath()
          ctx.arc(x, y, 4 + phase * 13, 0, Math.PI * 2)
          ctx.stroke()
          ctx.fillStyle = '#F2C98F'
          ctx.beginPath()
          ctx.arc(x, y, 3.4, 0, Math.PI * 2)
          ctx.fill()
        } else {
          ctx.fillStyle = 'rgba(233, 213, 192, 0.85)'
          ctx.beginPath()
          ctx.arc(x, y, 2.1, 0, Math.PI * 2)
          ctx.fill()
        }
        if ('labelAt' in city) {
          ctx.fillStyle = 'hub' in city ? 'rgba(242, 222, 196, 0.85)' : 'rgba(233, 213, 192, 0.5)'
          const text = city.label.toUpperCase()
          if (city.labelAt === 'left') { ctx.textAlign = 'right'; ctx.fillText(text, x - 8, y) }
          else if (city.labelAt === 'right') { ctx.textAlign = 'left'; ctx.fillText(text, x + 8, y) }
          else { ctx.textAlign = 'center'; ctx.fillText(text, x, y - 10) }
        }
      }
    }

    const tick = (ms: number) => {
      draw(ms / 1000)
      frame = requestAnimationFrame(tick)
    }

    const sync = () => {
      const shouldRun = !reduced && visible && !pausedRef.current && !document.hidden
      if (shouldRun && !running) { running = true; frame = requestAnimationFrame(tick) }
      if (!shouldRun && running) { running = false; cancelAnimationFrame(frame) }
    }
    syncRef.current = sync

    const resize = new ResizeObserver(() => { layout(); draw(performance.now() / 1000) })
    resize.observe(canvas)
    const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync() })
    intersection.observe(canvas)
    document.addEventListener('visibilitychange', sync)

    layout()
    draw(reduced ? 4 : performance.now() / 1000)
    sync()

    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      intersection.disconnect()
      document.removeEventListener('visibilitychange', sync)
      syncRef.current = () => {}
    }
  }, [])

  return <canvas ref={canvasRef} aria-hidden className={cn('pointer-events-none', className)} />
}
