/** Whisper trabaja con audio mono a 16 kHz. */
export const SAMPLE_RATE = 16_000

/**
 * Decodifica cualquier audio o vídeo que entienda el navegador (MP3, M4A,
 * WAV, OGG/Opus de WhatsApp, MP4, WebM…) y lo devuelve mono a 16 kHz.
 * Un OfflineAudioContext a 16 kHz hace el remuestreo con la calidad del navegador.
 */
export async function decodeToMono16k(data: ArrayBuffer): Promise<Float32Array> {
  const probe = new AudioContext()
  let decoded: AudioBuffer
  try {
    decoded = await probe.decodeAudioData(data.slice(0))
  } finally {
    void probe.close()
  }
  const length = Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE))
  const offline = new OfflineAudioContext(1, length, SAMPLE_RATE)
  const src = offline.createBufferSource()
  src.buffer = decoded
  // El destino es de un canal: la Web Audio API mezcla a mono con sus reglas
  // estándar (estéreo -> 0,5·(L+R)), así que basta con conectar.
  src.connect(offline.destination)
  src.start()
  const rendered = await offline.startRendering()
  return rendered.getChannelData(0).slice()
}

/** Picos (máximo absoluto) por columna para dibujar la forma de onda. */
export function computePeaks(samples: Float32Array, columns: number): Float32Array {
  const out = new Float32Array(columns)
  if (!samples.length || columns <= 0) return out
  const step = samples.length / columns
  let globalMax = 0
  for (let c = 0; c < columns; c++) {
    const from = Math.floor(c * step)
    const to = Math.min(samples.length, Math.floor((c + 1) * step))
    let m = 0
    for (let i = from; i < to; i++) {
      const v = Math.abs(samples[i]!)
      if (v > m) m = v
    }
    out[c] = m
    if (m > globalMax) globalMax = m
  }
  // Normaliza para que las grabaciones flojas también se vean.
  if (globalMax > 0) for (let c = 0; c < columns; c++) out[c] = out[c]! / globalMax
  return out
}

/** Energía RMS en tramas de `frameMs` milisegundos. */
export function frameEnergy(samples: Float32Array, sampleRate = SAMPLE_RATE, frameMs = 20): Float32Array {
  const size = Math.max(1, Math.round((sampleRate * frameMs) / 1000))
  const n = Math.ceil(samples.length / size)
  const out = new Float32Array(n)
  for (let f = 0; f < n; f++) {
    let sum = 0
    const from = f * size
    const to = Math.min(samples.length, from + size)
    for (let i = from; i < to; i++) sum += samples[i]! * samples[i]!
    out[f] = Math.sqrt(sum / Math.max(1, to - from))
  }
  return out
}

export interface Window {
  start: number // en muestras
  end: number
}

/**
 * Trocea el audio en ventanas de como mucho `maxSec` segundos (Whisper ve
 * 30 s de una vez) cortando en el punto más silencioso de los últimos
 * `searchSec` segundos de cada ventana, para no partir palabras.
 * Para buscar el silencio se suaviza la energía con una media móvil de
 * ~200 ms: un hueco entre palabras cuenta más que una sola trama baja.
 */
export function splitOnSilence(samples: Float32Array, sampleRate = SAMPLE_RATE, maxSec = 28, searchSec = 8): Window[] {
  const total = samples.length
  const maxLen = Math.floor(maxSec * sampleRate)
  if (total <= maxLen) return total ? [{ start: 0, end: total }] : []

  const frameMs = 20
  const frame = Math.round((sampleRate * frameMs) / 1000)
  const energy = frameEnergy(samples, sampleRate, frameMs)
  const smooth = movingAverage(energy, 10)

  const windows: Window[] = []
  let start = 0
  while (total - start > maxLen) {
    const hardEnd = start + maxLen
    const fromFrame = Math.floor((hardEnd - searchSec * sampleRate) / frame)
    const toFrame = Math.floor(hardEnd / frame)
    let best = toFrame
    let bestVal = Infinity
    for (let f = Math.max(fromFrame, Math.floor(start / frame) + 1); f < toFrame; f++) {
      const v = smooth[f]!
      // Ante empate se prefiere el corte más tardío (ventanas más largas = menos ventanas).
      if (v <= bestVal) {
        bestVal = v
        best = f
      }
    }
    const cut = Math.min(hardEnd, Math.max(start + sampleRate, best * frame + Math.floor(frame / 2)))
    windows.push({ start, end: cut })
    start = cut
  }
  windows.push({ start, end: total })
  return windows
}

function movingAverage(x: Float32Array, radius: number): Float32Array {
  const out = new Float32Array(x.length)
  let acc = 0
  let count = 0
  for (let i = 0; i < x.length + radius; i++) {
    if (i < x.length) {
      acc += x[i]!
      count++
    }
    if (i - 2 * radius - 1 >= 0) {
      acc -= x[i - 2 * radius - 1]!
      count--
    }
    const c = i - radius
    if (c >= 0 && c < x.length) out[c] = acc / count
  }
  return out
}

/** Duración en segundos. */
export const duration = (samples: Float32Array, sampleRate = SAMPLE_RATE) => samples.length / sampleRate

/** WAV PCM 16 bits mono, para poder reproducir lo grabado o exportarlo. */
export function encodeWav(samples: Float32Array, sampleRate = SAMPLE_RATE): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buf)
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([buf], { type: 'audio/wav' })
}
