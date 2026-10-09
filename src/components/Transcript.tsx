import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { clock, type Segment } from '../lib/format'

interface Props {
  segments: Segment[]
  activeIndex: number
  live: string | null
  follow: boolean
  onSeek: (t: number) => void
  onEdit: (i: number, text: string) => void
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function highlight(text: string, q: string): ReactNode {
  if (!q) return text
  const n = norm(text)
  const nq = norm(q)
  const parts: ReactNode[] = []
  let i = 0
  let k = 0
  for (;;) {
    const j = n.indexOf(nq, i)
    if (j < 0) break
    parts.push(text.slice(i, j), <mark key={k++} className="rounded bg-acid px-0.5 text-ink">{text.slice(j, j + q.length)}</mark>)
    i = j + q.length
  }
  parts.push(text.slice(i))
  return parts
}

export function Transcript({ segments, activeIndex, live, follow, onSeek, onEdit }: Props) {
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<number | null>(null)
  const list = useRef<HTMLOListElement>(null)
  const matches = useMemo(() => (query.trim() ? segments.filter((s) => norm(s.text).includes(norm(query.trim()))).length : 0), [segments, query])

  // Sigue la frase que suena (si el usuario no está editando).
  useEffect(() => {
    if (!follow || activeIndex < 0 || editing !== null) return
    const el = list.current?.querySelector<HTMLElement>(`[data-i="${activeIndex}"]`)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeIndex, follow, editing])

  // Mientras transcribe, baja con el texto nuevo.
  useEffect(() => {
    if (live === null) return
    const el = list.current
    if (el) el.scrollTop = el.scrollHeight
  }, [live, segments.length])

  return (
    <div className="flex min-h-0 flex-col">
      <div className="mb-3 flex items-center gap-2">
        <input
          className="w-full rounded-lg border border-line bg-ink px-3 py-2 text-sm text-white placeholder:text-mute/60 focus:border-acid focus:outline-none"
          placeholder="Buscar en la transcripción…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Buscar en la transcripción"
        />
        {query.trim() && <span className="shrink-0 font-mono text-xs text-mute">{matches} frases</span>}
      </div>
      <ol ref={list} className="max-h-[52vh] min-h-48 space-y-0.5 overflow-y-auto pr-1" aria-live="off">
        {segments.map((s, i) => {
          const active = i === activeIndex
          const hidden = query.trim() && !norm(s.text).includes(norm(query.trim()))
          if (hidden) return null
          return (
            <li key={`${s.start}-${i}`} data-i={i} className={`group grid grid-cols-[3.5rem_minmax(0,1fr)] gap-3 rounded-lg px-2 py-1.5 transition-colors ${active ? 'bg-acid/10' : 'hover:bg-white/5'}`}>
              <button
                type="button"
                onClick={() => onSeek(s.start)}
                className={`pt-0.5 text-left font-mono text-xs tabular-nums ${active ? 'text-acid' : 'text-mute hover:text-soft'}`}
                aria-label={`Ir a ${clock(s.start)}`}
              >
                {clock(s.start)}
              </button>
              {editing === i ? (
                <textarea
                  autoFocus
                  defaultValue={s.text}
                  rows={Math.max(1, Math.ceil(s.text.length / 70))}
                  onBlur={(e) => {
                    onEdit(i, e.target.value.trim() || s.text)
                    setEditing(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) (e.target as HTMLTextAreaElement).blur()
                    if (e.key === 'Escape') setEditing(null)
                  }}
                  className="w-full resize-none rounded border border-acid bg-ink px-2 py-1 text-[15px] leading-relaxed text-white focus:outline-none"
                />
              ) : (
                <p
                  onClick={() => onSeek(s.start)}
                  onDoubleClick={() => setEditing(i)}
                  title="Clic: escuchar · Doble clic: corregir"
                  className={`cursor-pointer text-[15px] leading-relaxed ${active ? 'text-white' : 'text-soft/90'}`}
                >
                  {highlight(s.text, query.trim())}
                </p>
              )}
            </li>
          )
        })}
        {live !== null && (
          <li className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-3 px-2 py-1.5">
            <span className="pt-0.5 font-mono text-xs text-acid">···</span>
            <p className="text-[15px] leading-relaxed text-acid/90">
              {live}
              <span className="ml-0.5 inline-block h-4 w-2 translate-y-0.5 animate-pulse bg-acid" />
            </p>
          </li>
        )}
      </ol>
    </div>
  )
}
