/// <reference lib="webworker" />
import { env, pipeline, WhisperTextStreamer, type AutomaticSpeechRecognitionPipeline, type WhisperTokenizer } from '@huggingface/transformers'
import { SAMPLE_RATE, type Window } from './lib/audio'
import type { Segment } from './lib/format'
import { dtypeFor, MODELS, type Device } from './lib/models'

/*
 * Hilo de la IA. Mensajes:
 *   -> { type: 'load', modelId, device, shaderF16 }
 *   -> { type: 'run', audio, windows, language, task }
 *   -> { type: 'cancel' }
 *   <- progress (descarga), ready, partial (texto en vivo), window (segmentos de una ventana), done, error
 */

env.allowLocalModels = false // los modelos vienen del Hub de Hugging Face y se guardan en la caché del navegador

type In =
  | { type: 'load'; modelId: string; device: Device; shaderF16: boolean }
  | { type: 'run'; audio: Float32Array; windows: Window[]; language: string; task: 'transcribe' | 'translate' }
  | { type: 'cancel' }

const post = (m: unknown) => (self as DedicatedWorkerGlobalScope).postMessage(m)

let asr: AutomaticSpeechRecognitionPipeline | null = null
let loadedKey = ''
let cancelled = false

async function load(modelId: string, device: Device, shaderF16: boolean) {
  const key = `${modelId}|${device}|${shaderF16}`
  if (asr && loadedKey === key) return post({ type: 'ready', device, cached: true })
  if (asr) await asr.dispose()
  asr = null
  const model = MODELS.find((m) => m.id === modelId)!
  const t0 = performance.now()
  asr = (await pipeline('automatic-speech-recognition', model.repo, {
    device,
    dtype: dtypeFor(device, shaderF16, modelId),
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status === 'progress' && p.file && p.total) post({ type: 'progress', file: p.file, loaded: p.loaded ?? 0, total: p.total })
      if (p.status === 'done' && p.file) post({ type: 'progress', file: p.file, loaded: 1, total: 1, done: true })
    },
  })) as AutomaticSpeechRecognitionPipeline
  loadedKey = key
  // Calentamiento: la primera inferencia compila los kernels (sobre todo en WebGPU).
  await asr(new Float32Array(SAMPLE_RATE), { language: 'es' })
  post({ type: 'ready', device, ms: Math.round(performance.now() - t0) })
}

async function run(audio: Float32Array, windows: Window[], language: string, task: 'transcribe' | 'translate') {
  if (!asr) throw new Error('El modelo no está cargado.')
  cancelled = false
  const t0 = performance.now()
  for (let i = 0; i < windows.length; i++) {
    if (cancelled) return post({ type: 'cancelled' })
    const w = windows[i]!
    const offset = w.start / SAMPLE_RATE
    let live = ''
    const streamer = new WhisperTextStreamer(asr.tokenizer as WhisperTokenizer, {
      skip_prompt: true,
      callback_function: (text: string) => {
        live += text
        post({ type: 'partial', index: i, text: live })
      },
    })
    const out = (await asr(audio.subarray(w.start, w.end), {
      return_timestamps: true,
      ...(language !== 'auto' ? { language } : {}),
      task,
      streamer,
    })) as { text: string; chunks?: { timestamp: [number, number | null]; text: string }[] }

    const winEnd = (w.end - w.start) / SAMPLE_RATE
    const segments: Segment[] = (out.chunks?.length ? out.chunks : [{ timestamp: [0, winEnd] as [number, number], text: out.text }]).map((c) => ({
      start: offset + Math.min(c.timestamp[0], winEnd),
      // Whisper deja el último final a null cuando el audio termina a mitad de frase.
      end: offset + Math.min(c.timestamp[1] ?? winEnd, winEnd),
      text: c.text,
    }))
    post({ type: 'window', index: i, total: windows.length, segments, elapsedMs: Math.round(performance.now() - t0) })
  }
  post({ type: 'done', elapsedMs: Math.round(performance.now() - t0) })
}

self.onmessage = async (e: MessageEvent<In>) => {
  const m = e.data
  try {
    if (m.type === 'load') await load(m.modelId, m.device, m.shaderF16)
    else if (m.type === 'run') await run(m.audio, m.windows, m.language, m.task)
    else if (m.type === 'cancel') cancelled = true
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    post({ type: 'error', stage: m.type, message: msg })
  }
}
