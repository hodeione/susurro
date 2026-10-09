export interface Segment {
  start: number // segundos
  end: number
  text: string
}

/** 75.5 -> "1:15", 3725 -> "1:02:05" */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

/** Marca de tiempo de subtítulos: "00:01:15,500" (SRT) o "00:01:15.500" (VTT). */
export function stamp(sec: number, sep: ',' | '.'): string {
  const ms = Math.max(0, Math.round(sec * 1000))
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const r = ms % 1000
  const p = (n: number, l = 2) => String(n).padStart(l, '0')
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(r, 3)}`
}

/**
 * Limpia los segmentos que devuelve Whisper: quita vacíos y alucinaciones
 * típicas en silencio, ordena, evita solapes y garantiza duración mínima.
 */
export function tidy(segments: Segment[]): Segment[] {
  const HALLUCINATIONS = /^(\[?(música|music|silencio|aplausos|risas|blank_audio)\]?|subtítulos realizados por la comunidad de amara\.org|¡?gracias por ver( el vídeo)?!?|suscríbete.*)$/i
  const out: Segment[] = []
  for (const s of [...segments].sort((a, b) => a.start - b.start)) {
    const text = s.text.replace(/\s+/g, ' ').trim()
    if (!text || HALLUCINATIONS.test(text.replace(/[.\s]+$/, ''))) continue
    const prev = out[out.length - 1]
    const start = prev ? Math.max(s.start, prev.end) : Math.max(0, s.start)
    const end = Math.max(start + 0.3, s.end)
    // Whisper a veces repite la misma frase en dos ventanas contiguas.
    if (prev && prev.text === text && start - prev.end < 1) {
      prev.end = end
      continue
    }
    out.push({ start, end, text })
  }
  return out
}

export function toTxt(segments: Segment[], withTimes = false): string {
  return segments.map((s) => (withTimes ? `[${clock(s.start)}] ${s.text}` : s.text)).join(withTimes ? '\n' : ' ').trim() + '\n'
}

export function toSrt(segments: Segment[]): string {
  return segments.map((s, i) => `${i + 1}\n${stamp(s.start, ',')} --> ${stamp(s.end, ',')}\n${s.text}\n`).join('\n')
}

export function toVtt(segments: Segment[]): string {
  return 'WEBVTT\n\n' + segments.map((s) => `${stamp(s.start, '.')} --> ${stamp(s.end, '.')}\n${s.text}\n`).join('\n')
}

/** Índice del segmento que suena en `t` (búsqueda binaria), o -1. */
export function segmentAt(segments: Segment[], t: number): number {
  let lo = 0
  let hi = segments.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const s = segments[mid]!
    if (t < s.start) hi = mid - 1
    else if (t >= s.end) lo = mid + 1
    else return mid
  }
  return -1
}

export function wordCount(segments: Segment[]): number {
  return segments.reduce((n, s) => n + (s.text.match(/\S+/g)?.length ?? 0), 0)
}
