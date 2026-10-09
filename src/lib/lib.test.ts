import { describe, expect, it } from 'vitest'
import { computePeaks, frameEnergy, SAMPLE_RATE, splitOnSilence } from './audio'
import { clock, segmentAt, stamp, tidy, toSrt, toTxt, toVtt, wordCount, type Segment } from './format'
import { dtypeFor } from './models'

/** Audio sintético: tono (voz) con silencios en los segundos indicados. */
function synth(seconds: number, silences: [number, number][]): Float32Array {
  const a = new Float32Array(seconds * SAMPLE_RATE)
  for (let i = 0; i < a.length; i++) {
    const t = i / SAMPLE_RATE
    const quiet = silences.some(([s, e]) => t >= s && t < e)
    a[i] = quiet ? (Math.random() - 0.5) * 0.002 : Math.sin(2 * Math.PI * 220 * t) * 0.5
  }
  return a
}

describe('splitOnSilence', () => {
  it('no trocea audios cortos', () => {
    expect(splitOnSilence(synth(20, []))).toEqual([{ start: 0, end: 20 * SAMPLE_RATE }])
    expect(splitOnSilence(new Float32Array(0))).toEqual([])
  })
  it('corta dentro del silencio más cercano al límite', () => {
    const a = synth(70, [[24, 25], [51, 52.5]])
    const w = splitOnSilence(a)
    expect(w).toHaveLength(3)
    const cut1 = w[0]!.end / SAMPLE_RATE
    const cut2 = w[1]!.end / SAMPLE_RATE
    expect(cut1).toBeGreaterThanOrEqual(24)
    expect(cut1).toBeLessThanOrEqual(25)
    expect(cut2).toBeGreaterThanOrEqual(51)
    expect(cut2).toBeLessThanOrEqual(52.5)
  })
  it('cubre todo el audio sin huecos ni ventanas > 28 s', () => {
    const a = synth(200, [])
    const w = splitOnSilence(a)
    expect(w[0]!.start).toBe(0)
    expect(w.at(-1)!.end).toBe(a.length)
    for (let i = 0; i < w.length; i++) {
      expect(w[i]!.end - w[i]!.start).toBeLessThanOrEqual(28 * SAMPLE_RATE)
      if (i) expect(w[i]!.start).toBe(w[i - 1]!.end)
    }
  })
})

describe('señal', () => {
  it('picos normalizados y energía', () => {
    const p = computePeaks(synth(2, [[0, 1]]), 4)
    expect(Math.max(...p)).toBeCloseTo(1)
    expect(p[0]).toBeLessThan(0.05)
    const e = frameEnergy(synth(1, []))
    expect(e[10]).toBeCloseTo(0.5 / Math.SQRT2, 2)
  })
})

const segs: Segment[] = [
  { start: 0, end: 2.5, text: ' Hola, ¿qué tal?' },
  { start: 2.5, end: 61.25, text: ' Vamos a empezar la reunión.' },
]

describe('formatos', () => {
  it('relojes y marcas', () => {
    expect(clock(75.5)).toBe('1:15')
    expect(clock(3725)).toBe('1:02:05')
    expect(stamp(61.25, ',')).toBe('00:01:01,250')
    expect(stamp(3725.004, '.')).toBe('01:02:05.004')
  })
  it('SRT, VTT y TXT', () => {
    const t = tidy(segs)
    expect(toSrt(t)).toBe('1\n00:00:00,000 --> 00:00:02,500\nHola, ¿qué tal?\n\n2\n00:00:02,500 --> 00:01:01,250\nVamos a empezar la reunión.\n')
    expect(toVtt(t).startsWith('WEBVTT\n\n00:00:00.000 --> 00:00:02.500\nHola')).toBe(true)
    expect(toTxt(t)).toBe('Hola, ¿qué tal? Vamos a empezar la reunión.\n')
    expect(toTxt(t, true)).toContain('[0:02] Vamos')
    expect(wordCount(t)).toBe(8)
  })
  it('limpia alucinaciones, duplicados y solapes', () => {
    const t = tidy([
      { start: 5, end: 7, text: 'Segunda' },
      { start: 0, end: 6, text: 'Primera' },
      { start: 7, end: 9, text: '[Música]' },
      { start: 9, end: 10, text: 'Subtítulos realizados por la comunidad de Amara.org' },
      { start: 10, end: 11, text: 'Segunda' },
      { start: 30, end: 31, text: '   ' },
    ])
    expect(t.map((s) => s.text)).toEqual(['Primera', 'Segunda', 'Segunda'])
    expect(t[1]!.start).toBe(6)
  })
  it('encuentra el segmento que suena', () => {
    const t = tidy(segs)
    expect(segmentAt(t, 0)).toBe(0)
    expect(segmentAt(t, 2.5)).toBe(1)
    expect(segmentAt(t, 100)).toBe(-1)
  })
})

describe('modelos', () => {
  it('elige precisión según el dispositivo', () => {
    expect(dtypeFor('wasm', false, 'base')).toEqual({ encoder_model: 'q8', decoder_model_merged: 'q8' })
    expect(dtypeFor('webgpu', true, 'base').encoder_model).toBe('fp16')
    expect(dtypeFor('webgpu', false, 'base').encoder_model).toBe('fp32')
  })
})
