import { useEffect, useMemo, useRef, useState } from 'react'
import { computePeaks } from '../lib/audio'
import { clock, type Segment } from '../lib/format'

interface Props {
  samples: Float32Array
  duration: number
  currentTime: number
  segments: Segment[]
  activeIndex: number
  /** Hasta dónde ha llegado la transcripción (segundos), para pintar el avance. */
  transcribedUntil?: number
  onSeek: (t: number) => void
}

const BAR = 3
const GAP = 2

export function Waveform({ samples, duration, currentTime, segments, activeIndex, transcribedUntil, onSeek }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(800)
  const [hover, setHover] = useState<number | null>(null)
  const height = 96

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, Math.floor(e!.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const peaks = useMemo(() => computePeaks(samples, Math.floor(width / (BAR + GAP))), [samples, width])

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    c.width = width * dpr
    c.height = height * dpr
    const ctx = c.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, height)
    const css = getComputedStyle(c)
    const acid = css.getPropertyValue('--color-acid').trim() || '#c8ff00'
    const played = duration ? currentTime / duration : 0
    const done = duration && transcribedUntil !== undefined ? transcribedUntil / duration : 1

    // Frase activa resaltada de fondo.
    const act = segments[activeIndex]
    if (act && duration) {
      ctx.fillStyle = 'rgba(200,255,0,0.08)'
      ctx.fillRect((act.start / duration) * width, 0, ((act.end - act.start) / duration) * width, height)
    }
    for (let i = 0; i < peaks.length; i++) {
      const x = i * (BAR + GAP)
      const frac = x / width
      const h = Math.max(2, peaks[i]! * (height - 16))
      ctx.fillStyle = frac <= played ? acid : frac <= done ? 'rgba(233,236,239,0.55)' : 'rgba(233,236,239,0.18)'
      ctx.beginPath()
      ctx.roundRect(x, (height - h) / 2, BAR, h, 1.5)
      ctx.fill()
    }
    // Marcas de inicio de cada frase.
    if (duration) {
      ctx.fillStyle = 'rgba(200,255,0,0.35)'
      for (const s of segments) ctx.fillRect(Math.round((s.start / duration) * width), height - 4, 1, 4)
    }
  }, [peaks, width, currentTime, duration, segments, activeIndex, transcribedUntil])

  const timeAt = (clientX: number) => {
    const r = wrap.current!.getBoundingClientRect()
    return Math.min(duration, Math.max(0, ((clientX - r.left) / r.width) * duration))
  }

  return (
    <div
      ref={wrap}
      className="relative cursor-pointer select-none"
      role="slider"
      tabIndex={0}
      aria-label="Posición del audio"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(currentTime)}
      aria-valuetext={clock(currentTime)}
      onClick={(e) => onSeek(timeAt(e.clientX))}
      onMouseMove={(e) => setHover(timeAt(e.clientX))}
      onMouseLeave={() => setHover(null)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') onSeek(Math.min(duration, currentTime + 5))
        if (e.key === 'ArrowLeft') onSeek(Math.max(0, currentTime - 5))
      }}
    >
      <canvas ref={canvas} style={{ width: '100%', height }} />
      {hover !== null && (
        <>
          <div className="pointer-events-none absolute inset-y-0 w-px bg-white/40" style={{ left: `${(hover / duration) * 100}%` }} />
          <div
            className="pointer-events-none absolute -top-7 -translate-x-1/2 rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-ink"
            style={{ left: `${(hover / duration) * 100}%` }}
          >
            {clock(hover)}
          </div>
        </>
      )}
    </div>
  )
}
