import { useEffect, useRef, useState } from 'react'
import { clock } from '../lib/format'

/** Graba del micrófono con medidor de nivel en vivo. */
export function Recorder({ onDone }: { onDone: (file: File) => void }) {
  const [state, setState] = useState<'idle' | 'rec' | 'denied'>('idle')
  const [seconds, setSeconds] = useState(0)
  const [level, setLevel] = useState(0)
  const rec = useRef<MediaRecorder | null>(null)
  const cleanup = useRef<() => void>(() => {})

  useEffect(() => () => cleanup.current(), [])

  async function start() {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch {
      setState('denied')
      return
    }
    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    ctx.createMediaStreamSource(stream).connect(analyser)
    const buf = new Float32Array(analyser.fftSize)
    let raf = 0
    const tick = () => {
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (const v of buf) sum += v * v
      setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 6))
      raf = requestAnimationFrame(tick)
    }
    tick()
    const t0 = Date.now()
    const timer = setInterval(() => setSeconds((Date.now() - t0) / 1000), 250)

    const chunks: Blob[] = []
    const mr = new MediaRecorder(stream)
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    mr.onstop = () => {
      cleanup.current()
      const type = mr.mimeType || 'audio/webm'
      const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'
      onDone(new File(chunks, `grabacion-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.${ext}`, { type }))
    }
    cleanup.current = () => {
      cancelAnimationFrame(raf)
      clearInterval(timer)
      stream.getTracks().forEach((t) => t.stop())
      void ctx.close()
      setLevel(0)
      setState('idle')
    }
    rec.current = mr
    mr.start(1000)
    setSeconds(0)
    setState('rec')
  }

  if (state === 'rec') {
    return (
      <button
        type="button"
        onClick={() => rec.current?.stop()}
        className="inline-flex items-center gap-3 rounded-full bg-red-500 px-5 py-2.5 font-mono text-xs uppercase tracking-wider text-white"
      >
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-white" />
        </span>
        Parar · {clock(seconds)}
        <span className="flex h-4 items-end gap-0.5" aria-hidden="true">
          {[0.5, 0.8, 1, 0.8, 0.5].map((k, i) => (
            <span key={i} className="w-1 rounded-sm bg-white transition-[height]" style={{ height: `${Math.max(15, level * k * 100)}%` }} />
          ))}
        </span>
      </button>
    )
  }
  return (
    <div className="inline-flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={start}
        className="inline-flex items-center gap-2 rounded-full border border-line px-5 py-2.5 font-mono text-xs uppercase tracking-wider text-soft transition-colors hover:border-acid hover:text-acid"
      >
        <span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Grabar con el micrófono
      </button>
      {state === 'denied' && <span className="text-xs text-red-300">Permiso de micrófono denegado.</span>}
    </div>
  )
}
