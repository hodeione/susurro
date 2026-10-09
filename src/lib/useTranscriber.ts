import { useCallback, useEffect, useRef, useState } from 'react'
import { splitOnSilence, type Window } from './audio'
import { tidy, type Segment } from './format'
import type { Device } from './models'

export type Phase = 'idle' | 'loading' | 'transcribing' | 'done' | 'error'

export interface Download {
  file: string
  loaded: number
  total: number
}

export function useTranscriber() {
  const worker = useRef<Worker | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [downloads, setDownloads] = useState<Record<string, Download>>({})
  const [segments, setSegments] = useState<Segment[]>([])
  const [live, setLive] = useState<{ index: number; text: string } | null>(null)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [error, setError] = useState('')
  const [stats, setStats] = useState<{ device?: Device; loadMs?: number; elapsedMs?: number }>({})
  const raw = useRef<Segment[]>([])
  const pending = useRef<{ audio: Float32Array; windows: Window[]; language: string; task: 'transcribe' | 'translate' } | null>(null)

  const getWorker = () => {
    if (worker.current) return worker.current
    const w = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent) => {
      const m = e.data
      switch (m.type) {
        case 'progress':
          setDownloads((d) => ({ ...d, [m.file]: { file: m.file, loaded: m.done ? (d[m.file]?.total ?? 1) : m.loaded, total: m.done ? (d[m.file]?.total ?? 1) : m.total } }))
          break
        case 'ready': {
          setStats((s) => ({ ...s, device: m.device, ...(m.ms ? { loadMs: m.ms } : {}) }))
          const job = pending.current
          pending.current = null
          if (job) {
            setPhase('transcribing')
            w.postMessage({ type: 'run', ...job }, [job.audio.buffer])
          }
          break
        }
        case 'partial':
          setLive({ index: m.index, text: m.text })
          break
        case 'window':
          raw.current = [...raw.current, ...m.segments]
          setSegments(tidy(raw.current))
          setLive(null)
          setProgress({ done: m.index + 1, total: m.total })
          setStats((s) => ({ ...s, elapsedMs: m.elapsedMs }))
          break
        case 'done':
          setStats((s) => ({ ...s, elapsedMs: m.elapsedMs }))
          setPhase('done')
          break
        case 'cancelled':
          setLive(null)
          setPhase(raw.current.length ? 'done' : 'idle')
          break
        case 'error':
          setError(friendly(m.message, m.stage))
          setPhase('error')
          break
      }
    }
    w.onerror = (e) => {
      setError(friendly(e.message || 'Error inesperado.', 'run'))
      setPhase('error')
    }
    worker.current = w
    return w
  }

  /** Carga el modelo (si hace falta) y transcribe. El audio se transfiere al hilo sin copiarlo. */
  const transcribe = useCallback(
    (audio: Float32Array, opts: { modelId: string; device: Device; shaderF16: boolean; language: string; task: 'transcribe' | 'translate' }) => {
      raw.current = []
      setSegments([])
      setLive(null)
      setError('')
      setDownloads({})
      const windows = splitOnSilence(audio)
      setProgress({ done: 0, total: windows.length })
      // Se envía una copia: el original se queda en la página para la onda y la reproducción.
      pending.current = { audio: audio.slice(), windows, language: opts.language, task: opts.task }
      setPhase('loading')
      getWorker().postMessage({ type: 'load', modelId: opts.modelId, device: opts.device, shaderF16: opts.shaderF16 })
    },
    [],
  )

  const cancel = useCallback(() => worker.current?.postMessage({ type: 'cancel' }), [])

  const reset = useCallback(() => {
    raw.current = []
    setSegments([])
    setLive(null)
    setPhase('idle')
    setError('')
    setProgress({ done: 0, total: 0 })
  }, [])

  const editSegment = useCallback((i: number, text: string) => {
    setSegments((s) => s.map((x, j) => (j === i ? { ...x, text } : x)))
  }, [])

  useEffect(() => () => worker.current?.terminate(), [])

  return { phase, downloads, segments, live, progress, error, stats, transcribe, cancel, reset, editSegment }
}

function friendly(msg: string, stage: string): string {
  if (/fetch|network|Failed to fetch|load/i.test(msg) && stage === 'load') {
    return 'No se pudo descargar el modelo. Revisa tu conexión: solo hace falta la primera vez.'
  }
  if (/memory|allocation|OOM|out of/i.test(msg)) {
    return 'Tu dispositivo se ha quedado sin memoria con este modelo. Prueba con uno más ligero.'
  }
  if (/webgpu|adapter|device lost/i.test(msg)) {
    return 'La tarjeta gráfica ha fallado. Desactiva «Usar GPU» y vuelve a intentarlo.'
  }
  return `No se pudo transcribir: ${msg}`
}
