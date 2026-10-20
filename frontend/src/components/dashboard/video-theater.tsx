'use client'

import { useEffect, useRef, useState } from 'react'
import { Captions, Check, Eye, ListVideo, MessageSquare, Mic, MonitorPlay, ScrollText, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { featuredVideo as video, type Cue } from './data'
import { saveVideoProgress } from './live-store'
import { NetworkCanvas } from './network-canvas'
import { ReactionBar } from './reactions'
import { focusTownHall } from './town-hall-panel'
import { formatTimecode, fullDate } from './time'

export type TheaterTab = 'chapters' | 'transcript'
type Lang = 'en' | 'fr'

const vttTime = (s: number) => `00:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.000`
const toVtt = (cues: Cue[]) => `WEBVTT\n\n${cues.map((c, i) => `${i + 1}\n${vttTime(c.start)} --> ${vttTime(c.end)}\n${c.text}`).join('\n\n')}\n`

/* Native <dialog> gives focus containment, Esc to close and inert background for free.
   Every way of closing goes through dialog.close(), so progress is saved in one place. */
export function VideoTheater({ start, initialTab, onClose }: { start: number; initialTab: TheaterTab; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const cueRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [tab, setTab] = useState<TheaterTab>(initialTab)
  const [lang, setLang] = useState<Lang>('en')
  const [time, setTime] = useState(start)
  const [playing, setPlaying] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [tracks, setTracks] = useState<Record<Lang, string> | null>(null)

  const cues = video.transcript[lang]
  const activeCue = cues.findLastIndex((c) => time >= c.start)
  const activeChapter = video.chapters.findLastIndex((c) => time >= c.start)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    const root = document.documentElement
    const previous = root.style.overflow
    root.style.overflow = 'hidden'
    return () => { root.style.overflow = previous }
  }, [])

  /* Caption files are generated from the transcript so both always match. */
  useEffect(() => {
    const urls = {
      en: URL.createObjectURL(new Blob([toVtt(video.transcript.en)], { type: 'text/vtt' })),
      fr: URL.createObjectURL(new Blob([toVtt(video.transcript.fr)], { type: 'text/vtt' })),
    }
    // Blob URLs are browser resources: create them after mount, free them on unmount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTracks(urls)
    return () => { URL.revokeObjectURL(urls.en); URL.revokeObjectURL(urls.fr) }
  }, [])

  useEffect(() => {
    if (tab === 'transcript' && playing) cueRefs.current[activeCue]?.scrollIntoView({ block: 'nearest' })
  }, [activeCue, tab, playing])

  const handleClose = () => {
    /* A stale close event can arrive after a dev-mode remount re-opened the dialog. */
    if (dialogRef.current?.open) return
    saveVideoProgress(video.id, Math.floor(videoRef.current?.currentTime ?? time))
    onClose()
  }

  const seek = (seconds: number) => {
    setTime(seconds)
    const el = videoRef.current
    if (unavailable || !el) {
      setTab('transcript')
      const index = cues.findIndex((c) => c.start >= seconds)
      requestAnimationFrame(() => cueRefs.current[index]?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
      return
    }
    el.currentTime = seconds
    el.play().catch(() => {})
  }

  return <dialog ref={dialogRef} onClose={handleClose} aria-labelledby="theater-title"
    onClick={(e) => { if (e.target === dialogRef.current) dialogRef.current?.close() }}
    className="sbd-theater m-auto max-h-[calc(100dvh-2rem)] w-[min(1180px,calc(100vw-2rem))] overflow-hidden rounded-2xl bg-[#0E1830] p-0 text-[#F7F1EC] shadow-[0_40px_120px_-20px_rgba(0,0,0,0.6)] ring-1 ring-white/10 backdrop:bg-[#060B18]/80 backdrop:backdrop-blur-[3px]">
    <div className="grid max-h-[calc(100dvh-2rem)] overflow-y-auto lg:grid-cols-[minmax(0,1fr)_340px] lg:overflow-hidden">
      <div className="flex min-w-0 flex-col">
        <header className="flex items-start gap-3 py-4 pl-5 pr-14">
          <img src="/logo.png" alt="" className="size-9 shrink-0 rounded-lg bg-white object-contain p-1" />
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#C9A27E]">{video.eyebrow}</p>
            <h2 id="theater-title" className="text-balance text-lg font-semibold leading-snug tracking-tight">{video.title}</h2>
            <p className="mt-0.5 text-[11px] text-[#A9B4CC]">{video.speaker} · {fullDate(video.published)} · {formatTimecode(video.duration)}</p>
          </div>
        </header>

        <div className="relative aspect-video bg-black">
          <video ref={videoRef} src={video.src} controls playsInline preload="metadata" className="size-full"
            onLoadedMetadata={(e) => { if (start) e.currentTarget.currentTime = start; e.currentTarget.play().catch(() => {}) }}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
            onError={() => setUnavailable(true)}>
            {tracks && <>
              <track kind="captions" srcLang="en" label="English" src={tracks.en} default />
              <track kind="captions" srcLang="fr" label="Français" src={tracks.fr} />
            </>}
          </video>
          {unavailable && <div className="absolute inset-0 flex items-center bg-[linear-gradient(160deg,#192646_0%,#101B35_70%)]">
            <NetworkCanvas className="absolute inset-0 size-full opacity-70" />
            <div className="relative max-w-sm p-6 sm:p-8">
              <MonitorPlay className="size-6 text-[#C9A27E]" />
              <p className="mt-3 text-base font-semibold">This video isn’t available right now</p>
              <p className="mt-1 text-sm text-[#A9B4CC]">The full message is in the transcript, in English and French.</p>
              <button type="button" onClick={() => setTab('transcript')} className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-[#E9D5C0] px-3.5 text-[13px] font-semibold text-[#101B35] transition-colors hover:bg-[#F2E4D3]"><ScrollText className="size-4" /> Read the transcript</button>
            </div>
          </div>}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/10 px-5 py-3">
          <ReactionBar id={video.id} counts={video.reactions} tone="dark" />
          <span className="flex items-center gap-3 text-[11px] text-[#A9B4CC]">
            <span className="flex items-center gap-1"><Eye className="size-3.5" />{video.views.toLocaleString('en-US')} views</span>
            <span className="flex items-center gap-1"><MessageSquare className="size-3.5" />{video.comments} comments</span>
            <span className="flex items-center gap-1"><Captions className="size-3.5" />EN · FR</span>
          </span>
        </div>
      </div>

      <aside className="relative min-h-[320px] border-t border-white/10 lg:border-l lg:border-t-0">
        <div className="flex h-full flex-col lg:absolute lg:inset-0">
          <div className="flex items-center gap-1 border-b border-white/10 px-3 py-2.5 lg:pr-14">
            {([['chapters', 'Chapters', ListVideo], ['transcript', 'Transcript', ScrollText]] as const).map(([value, label, Icon]) => (
              <button key={value} type="button" aria-pressed={tab === value} onClick={() => setTab(value)}
                className={cn('inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-colors', tab === value ? 'bg-white/10 text-white' : 'text-[#A9B4CC] hover:text-white')}>
                <Icon className="size-3.5" />{label}
              </button>
            ))}
            {tab === 'transcript' && <div className="ml-auto flex rounded-md bg-white/[0.06] p-0.5" role="group" aria-label="Transcript language">
              {(['en', 'fr'] as const).map((l) => <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)} className={cn('h-6 rounded px-2 text-[10px] font-bold uppercase tracking-wider', lang === l ? 'bg-[#E9D5C0] text-[#101B35]' : 'text-[#A9B4CC] hover:text-white')}>{l}</button>)}
            </div>}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {tab === 'chapters'
              ? <>
                <p className="px-3 pb-2 pt-1.5 text-[12.5px] leading-relaxed text-[#A9B4CC]"><span className="font-semibold text-[#E6EAF2]">In this message: </span>{video.summary}</p>
                <ol className="flex flex-col gap-0.5">
                  {video.chapters.map((chapter, i) => {
                    const end = video.chapters[i + 1]?.start ?? video.duration
                    const done = time >= end
                    const current = i === activeChapter && time > 0
                    return <li key={chapter.start}>
                      <button type="button" onClick={() => seek(chapter.start)} className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors', current ? 'bg-white/10' : 'hover:bg-white/[0.05]')}>
                        <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-full font-mono text-[10px] ring-1', done ? 'bg-[#E9D5C0] text-[#101B35] ring-[#E9D5C0]' : current ? 'text-[#F2C98F] ring-[#F2C98F]' : 'text-[#A9B4CC] ring-white/15')}>{done ? <Check className="size-3.5" /> : i + 1}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-[#E6EAF2]">{chapter.title}</span>
                          <span className="block font-mono text-[10.5px] text-[#8D98B3]">{formatTimecode(chapter.start)} – {formatTimecode(end)}</span>
                        </span>
                        {current && playing && <span className="flex h-3 items-end gap-[2px]" aria-label="Now playing">{[0, 1, 2].map((b) => <span key={b} className="sbd-eq w-[3px] rounded-sm bg-[#F2C98F]" style={{ animationDelay: `${b * 0.15}s` }} />)}</span>}
                      </button>
                    </li>
                  })}
                </ol>
              </>
              : <ol className="flex flex-col" lang={lang}>
                  {cues.map((cue, i) => (
                    <li key={cue.start}>
                      <button ref={(el) => { cueRefs.current[i] = el }} type="button" onClick={() => seek(cue.start)}
                        className={cn('flex w-full gap-3 rounded-lg px-3 py-2 text-left transition-colors', i === activeCue && time > 0 ? 'bg-white/10' : 'hover:bg-white/[0.05]')}>
                        <span className="w-9 shrink-0 pt-px font-mono text-[10.5px] text-[#C9A27E]">{formatTimecode(cue.start)}</span>
                        <span className={cn('text-[13px] leading-relaxed', i === activeCue && time > 0 ? 'text-white' : 'text-[#C3CAD9]')}>{cue.text}</span>
                      </button>
                    </li>
                  ))}
                </ol>}
          </div>

          <div className="m-3 mt-0 rounded-xl bg-[#E9D5C0] p-3.5 text-[#101B35]">
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[#8C6D52]"><Mic className="size-3" /> Q4 Town Hall · 8 Oct</p>
            <p className="mt-1 text-[13px] font-semibold leading-snug">Questions for General Management? Send them before the Town Hall, anonymously if you prefer.</p>
            <button type="button" onClick={() => { dialogRef.current?.close(); requestAnimationFrame(focusTownHall) }}
              className="mt-2.5 inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#101B35] px-3 text-[12px] font-semibold text-[#F7F1EC] transition-colors hover:bg-[#192646]">Ask a question</button>
          </div>
        </div>
      </aside>
    </div>

    <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Close video"
      className="absolute right-3 top-3 z-10 flex size-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E9D5C0]">
      <X className="size-4" />
    </button>
  </dialog>
}
