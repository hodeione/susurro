import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Recorder } from './components/Recorder'
import { Transcript } from './components/Transcript'
import { Waveform } from './components/Waveform'
import { decodeToMono16k, duration as durationOf } from './lib/audio'
import { clock, segmentAt, toSrt, toTxt, toVtt, wordCount } from './lib/format'
import { LANGUAGES, MODELS, detectGpu, type Device, type GpuInfo } from './lib/models'
import { useTranscriber } from './lib/useTranscriber'

interface Loaded {
  name: string
  url: string
  samples: Float32Array
  duration: number
  size: number
}

const ACCEPT = 'audio/*,video/*,.opus,.ogg,.m4a,.mp3,.wav,.webm,.mp4,.mov,.aac,.flac'
const PREFS = 'susurro:prefs'

function loadPrefs() {
  try {
    return { modelId: 'base', language: 'es', useGpu: true, ...JSON.parse(localStorage.getItem(PREFS) ?? '{}') }
  } catch {
    return { modelId: 'base', language: 'es', useGpu: true }
  }
}

export default function App() {
  const prefs = useMemo(loadPrefs, [])
  const [gpu, setGpu] = useState<GpuInfo | null>(null)
  const [modelId, setModelId] = useState<string>(prefs.modelId)
  const [language, setLanguage] = useState<string>(prefs.language)
  const [useGpu, setUseGpu] = useState<boolean>(prefs.useGpu)
  const [translate, setTranslate] = useState(false)
  const [file, setFile] = useState<Loaded | null>(null)
  const [decoding, setDecoding] = useState(false)
  const [fileError, setFileError] = useState('')
  const [over, setOver] = useState(false)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useState(1)
  const audio = useRef<HTMLAudioElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const t = useTranscriber()

  useEffect(() => {
    detectGpu().then(setGpu)
  }, [])
  useEffect(() => {
    try {
      localStorage.setItem(PREFS, JSON.stringify({ modelId, language, useGpu }))
    } catch {
      /* sin almacenamiento */
    }
  }, [modelId, language, useGpu])

  const device: Device = gpu?.available && useGpu ? 'webgpu' : 'wasm'
  const model = MODELS.find((m) => m.id === modelId) ?? MODELS[1]!
  const modelOk = !model.webgpuOnly || device === 'webgpu'

  const open = useCallback(
    async (f: File) => {
      setFileError('')
      if (f.size > 1024 * 1024 * 1024) return setFileError('El archivo pesa más de 1 GB.')
      setDecoding(true)
      t.reset()
      try {
        const samples = await decodeToMono16k(await f.arrayBuffer())
        if (file) URL.revokeObjectURL(file.url)
        setFile({ name: f.name, url: URL.createObjectURL(f), samples, duration: durationOf(samples), size: f.size })
        setTime(0)
      } catch {
        setFileError('Tu navegador no puede leer este archivo. Prueba con MP3, M4A, WAV, OGG/Opus o MP4.')
      } finally {
        setDecoding(false)
      }
    },
    [file, t],
  )

  // Pegar o soltar en cualquier parte.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = e.clipboardData?.files?.[0]
      if (f) void open(f)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [open])

  // Espacio = reproducir/pausar (si no se está escribiendo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !file) return
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement).isContentEditable) return
      e.preventDefault()
      togglePlay()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const seek = (s: number) => {
    if (!audio.current) return
    audio.current.currentTime = s
    setTime(s)
  }
  const togglePlay = () => {
    const a = audio.current
    if (!a) return
    if (a.paused) void a.play()
    else a.pause()
  }

  const active = segmentAt(t.segments, time)
  const busy = t.phase === 'loading' || t.phase === 'transcribing'
  const transcribedUntil = t.phase === 'transcribing' ? (t.segments.at(-1)?.end ?? 0) : undefined
  const dl = Object.values(t.downloads)
  const dlTotal = dl.reduce((a, d) => a + d.total, 0)
  const dlLoaded = dl.reduce((a, d) => a + d.loaded, 0)
  const speed = t.stats.elapsedMs && file ? file.duration / (t.stats.elapsedMs / 1000) : 0
  const baseName = file?.name.replace(/\.[^.]+$/, '') ?? 'transcripcion'

  const download = (content: string, ext: string, type = 'text/plain') => {
    const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${baseName}.${ext}`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }
  const [copied, setCopied] = useState(false)

  return (
    <div
      className="min-h-screen"
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const f = e.dataTransfer.files[0]
        if (f && !busy) void open(f)
      }}
    >
      {over && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm">
          <p className="rounded-2xl border-2 border-dashed border-acid px-10 py-8 text-3xl font-bold text-acid">Suelta el audio</p>
        </div>
      )}

      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <a href="/" className="flex items-center gap-2.5 text-xl font-bold tracking-tight">
          <Logo /> susurro
        </a>
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider">
          <span className={`rounded-full border px-2.5 py-1 ${gpu?.available ? 'border-acid/50 text-acid' : 'border-line text-mute'}`}>
            {gpu === null ? '…' : gpu.available ? 'WebGPU ✓' : 'CPU (WASM)'}
          </span>
          <a href="https://github.com/hodeione/susurro" target="_blank" rel="noopener noreferrer" className="rounded-full border border-line px-2.5 py-1 text-mute hover:text-soft">
            GitHub ↗
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        {!file && (
          <section className="pt-8 pb-10 text-center sm:pt-16">
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em] text-mute">
              <span className="h-1.5 w-1.5 rounded-full bg-acid" /> Whisper · 100 % en tu navegador
            </p>
            <h1 className="mx-auto max-w-4xl text-5xl font-bold leading-[1.02] tracking-tight sm:text-7xl">
              Convierte cualquier audio en texto <span className="text-acid">sin subirlo a ningún sitio.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-mute">
              Audios de WhatsApp, notas de voz, reuniones o vídeos. La inteligencia artificial se ejecuta en tu dispositivo: nadie más escucha lo que transcribes.
            </p>
            <div className="mx-auto mt-10 max-w-2xl">
              <button
                type="button"
                onClick={() => input.current?.click()}
                disabled={decoding}
                className="group flex w-full flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-line bg-card/60 px-6 py-14 transition-colors hover:border-acid/60"
              >
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-acid text-ink transition-transform group-hover:-translate-y-1">
                  <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                    <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
                  </svg>
                </span>
                <span className="text-xl font-semibold">{decoding ? 'Leyendo el audio…' : 'Arrastra un audio o vídeo, o haz clic'}</span>
                <span className="text-sm text-mute">MP3, M4A, WAV, OGG/Opus de WhatsApp, MP4… · también Ctrl+V</span>
              </button>
              <div className="mt-4">
                <Recorder onDone={(f) => void open(f)} />
              </div>
              {fileError && <p className="mt-4 text-sm text-red-300">{fileError}</p>}
            </div>
            <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={(e) => e.target.files?.[0] && void open(e.target.files[0])} />
          </section>
        )}

        {file && (
          <section className="pt-4">
            <div className="rounded-3xl border border-line bg-card p-4 sm:p-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold" title={file.name}>
                    {file.name}
                  </p>
                  <p className="font-mono text-xs text-mute">
                    {clock(file.duration)} · {(file.size / 1024 / 1024).toFixed(1).replace('.', ',')} MB
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={togglePlay}
                    aria-label={playing ? 'Pausar' : 'Reproducir'}
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-acid text-ink transition-transform hover:scale-105"
                  >
                    {playing ? (
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
                        <rect x="6" y="5" width="4" height="14" rx="1" />
                        <rect x="14" y="5" width="4" height="14" rx="1" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" className="ml-0.5 h-5 w-5" fill="currentColor" aria-hidden="true">
                        <path d="M7 4.5v15l13-7.5z" />
                      </svg>
                    )}
                  </button>
                  <span className="w-24 text-center font-mono text-xs tabular-nums text-soft">
                    {clock(time)} / {clock(file.duration)}
                  </span>
                  <select
                    aria-label="Velocidad"
                    value={rate}
                    onChange={(e) => {
                      const r = Number(e.target.value)
                      setRate(r)
                      if (audio.current) audio.current.playbackRate = r
                    }}
                    className="rounded-lg border border-line bg-ink px-2 py-1.5 font-mono text-xs text-soft"
                  >
                    {[0.75, 1, 1.25, 1.5, 2].map((r) => (
                      <option key={r} value={r}>
                        {String(r).replace('.', ',')}×
                      </option>
                    ))}
                  </select>
                  {!busy && (
                    <button
                      type="button"
                      onClick={() => {
                        audio.current?.pause()
                        URL.revokeObjectURL(file.url)
                        setFile(null)
                        t.reset()
                      }}
                      className="rounded-lg border border-line px-3 py-1.5 font-mono text-xs text-mute hover:text-soft"
                    >
                      Otro audio
                    </button>
                  )}
                </div>
              </div>
              <Waveform
                samples={file.samples}
                duration={file.duration}
                currentTime={time}
                segments={t.segments}
                activeIndex={active}
                {...(transcribedUntil !== undefined ? { transcribedUntil } : {})}
                onSeek={seek}
              />
              <audio
                ref={audio}
                src={file.url}
                preload="auto"
                onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                className="hidden"
              />
            </div>

            {(t.phase === 'idle' || t.phase === 'error') && (
              <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div>
                  <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-mute">Modelo</p>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    {MODELS.map((m) => {
                      const disabled = m.webgpuOnly && !(gpu?.available && useGpu)
                      return (
                        <button
                          key={m.id}
                          type="button"
                          disabled={disabled}
                          aria-pressed={modelId === m.id}
                          onClick={() => setModelId(m.id)}
                          className={`rounded-2xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                            modelId === m.id ? 'border-acid bg-acid/10' : 'border-line hover:border-acid/40'
                          }`}
                        >
                          <span className={`block font-semibold ${modelId === m.id ? 'text-acid' : ''}`}>{m.name}</span>
                          <span className="mt-1 block text-xs leading-snug text-mute">{m.hint}</span>
                          <span className="mt-3 block font-mono text-[11px] text-soft/70">≈ {m.sizeMb[device]} MB · 1.ª vez</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div className="space-y-4">
                  <div>
                    <label htmlFor="lang" className="mb-2 block font-mono text-[11px] uppercase tracking-[0.2em] text-mute">
                      Idioma del audio
                    </label>
                    <select
                      id="lang"
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      className="w-full rounded-xl border border-line bg-ink px-3 py-2.5 text-sm focus:border-acid focus:outline-none"
                    >
                      {LANGUAGES.map(([c, n]) => (
                        <option key={c} value={c}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-soft">
                    <input type="checkbox" checked={translate} onChange={(e) => setTranslate(e.target.checked)} className="accent-[#c8ff00]" />
                    Traducir al inglés
                  </label>
                  <label className={`flex items-center gap-2 text-sm ${gpu?.available ? 'text-soft' : 'text-mute'}`}>
                    <input type="checkbox" disabled={!gpu?.available} checked={useGpu && !!gpu?.available} onChange={(e) => setUseGpu(e.target.checked)} className="accent-[#c8ff00]" />
                    Usar la tarjeta gráfica (WebGPU) {!gpu?.available && gpu && '· no disponible'}
                  </label>
                  <button
                    type="button"
                    disabled={!modelOk}
                    onClick={() =>
                      t.transcribe(file.samples, { modelId: model.id, device, shaderF16: !!gpu?.shaderF16, language, task: translate ? 'translate' : 'transcribe' })
                    }
                    className="w-full rounded-xl bg-acid py-3.5 font-semibold text-ink transition-shadow hover:shadow-[0_0_30px_rgba(200,255,0,0.35)] disabled:opacity-40"
                  >
                    Transcribir {clock(file.duration)} de audio →
                  </button>
                  {t.phase === 'error' && <p className="text-sm text-red-300">{t.error}</p>}
                </div>
              </div>
            )}

            {t.phase === 'loading' && (
              <div className="mt-6 rounded-3xl border border-line bg-card p-6">
                <p className="font-semibold">Preparando el modelo {model.name.toLowerCase()}…</p>
                <p className="mt-1 text-sm text-mute">
                  {dlTotal > 2e6
                    ? `Descargando ${(dlLoaded / 1e6).toFixed(0)} de ${(dlTotal / 1e6).toFixed(0)} MB. Solo la primera vez: después queda guardado en tu navegador.`
                    : 'Cargando desde la caché del navegador y preparando la ' + (device === 'webgpu' ? 'tarjeta gráfica' : 'CPU') + '…'}
                </p>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-line">
                  <div className="h-full rounded-full bg-acid transition-all" style={{ width: `${dlTotal > 2e6 ? Math.round((dlLoaded / dlTotal) * 100) : 5}%` }} />
                </div>
              </div>
            )}

            {(t.phase === 'transcribing' || t.phase === 'done' || (t.phase === 'idle' && t.segments.length > 0)) && (
              <div className="mt-6 rounded-3xl border border-line bg-card p-4 sm:p-6">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  {t.phase === 'transcribing' ? (
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-acid/70" />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-acid" />
                      </span>
                      <p className="text-sm text-soft">
                        Transcribiendo · fragmento {Math.min(t.progress.done + 1, t.progress.total)} de {t.progress.total}
                      </p>
                      <div className="h-1.5 max-w-xs flex-1 overflow-hidden rounded-full bg-line">
                        <div className="h-full rounded-full bg-acid transition-all" style={{ width: `${(t.progress.done / Math.max(1, t.progress.total)) * 100}%` }} />
                      </div>
                      <button type="button" onClick={t.cancel} className="rounded-lg border border-line px-3 py-1 font-mono text-xs text-mute hover:text-red-300">
                        Detener
                      </button>
                    </div>
                  ) : (
                    <p className="font-mono text-xs text-mute">
                      {wordCount(t.segments)} palabras · {t.segments.length} frases
                      {speed > 0 && ` · ${speed.toFixed(1).replace('.', ',')}× tiempo real`}
                      {t.stats.device && ` · ${t.stats.device === 'webgpu' ? 'WebGPU' : 'CPU'}`}
                    </p>
                  )}
                  {t.phase !== 'transcribing' && t.segments.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={async () => {
                          await navigator.clipboard.writeText(toTxt(t.segments))
                          setCopied(true)
                          setTimeout(() => setCopied(false), 1500)
                        }}
                        className="rounded-lg bg-acid px-3 py-1.5 font-mono text-xs font-semibold text-ink"
                      >
                        {copied ? '✓ Copiado' : 'Copiar texto'}
                      </button>
                      {[
                        ['TXT', () => download(toTxt(t.segments), 'txt')],
                        ['TXT con tiempos', () => download(toTxt(t.segments, true), 'txt')],
                        ['SRT', () => download(toSrt(t.segments), 'srt', 'application/x-subrip')],
                        ['VTT', () => download(toVtt(t.segments), 'vtt', 'text/vtt')],
                      ].map(([label, fn]) => (
                        <button
                          key={label as string}
                          type="button"
                          onClick={fn as () => void}
                          className="rounded-lg border border-line px-3 py-1.5 font-mono text-xs text-soft hover:border-acid hover:text-acid"
                        >
                          ↓ {label as string}
                        </button>
                      ))}
                      <button type="button" onClick={t.reset} className="rounded-lg px-3 py-1.5 font-mono text-xs text-mute hover:text-soft">
                        Repetir con otro modelo
                      </button>
                    </div>
                  )}
                </div>
                <Transcript
                  segments={t.segments}
                  activeIndex={active}
                  live={t.phase === 'transcribing' ? (t.live?.text ?? '') : null}
                  follow={playing}
                  onSeek={(s) => {
                    seek(s)
                    void audio.current?.play()
                  }}
                  onEdit={t.editSegment}
                />
                {t.phase === 'done' && t.segments.length === 0 && <p className="text-sm text-mute">No se ha detectado voz en este audio.</p>}
              </div>
            )}
          </section>
        )}

        {!file && (
          <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            {[
              ['Privado de verdad', 'El audio nunca sale de tu dispositivo. Puedes comprobarlo: tras la primera carga funciona sin conexión.'],
              ['IA de OpenAI, en local', 'Whisper, el modelo de reconocimiento de voz de OpenAI, ejecutado con ONNX Runtime en WebGPU o WebAssembly.'],
              ['Listo para usar', 'Texto con tiempos, subtítulos SRT y VTT, búsqueda y corrección. Haz clic en una frase para escucharla.'],
            ].map(([h, p]) => (
              <div key={h} className="rounded-2xl border border-line p-5">
                <p className="font-semibold">{h}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-mute">{p}</p>
              </div>
            ))}
          </section>
        )}
      </main>

      <footer className="mx-auto flex max-w-6xl flex-wrap justify-between gap-3 px-4 pb-10 font-mono text-[11px] text-mute sm:px-6">
        <span>
          Hecho por{' '}
          <a className="text-acid hover:underline" href="https://github.com/hodeione" target="_blank" rel="noopener noreferrer">
            Hodei Medina
          </a>{' '}
          · MIT
        </span>
        <span>Modelos: Whisper (OpenAI) vía Hugging Face · sin cookies ni analítica</span>
      </footer>
    </div>
  )
}

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="#c8ff00" />
      {[7, 11, 15, 19, 23].map((x, i) => {
        const h = [6, 12, 18, 12, 6][i]!
        return <rect key={x} x={x - 1} y={16 - h / 2} width="2.4" height={h} rx="1.2" fill="#08090b" />
      })}
    </svg>
  )
}
