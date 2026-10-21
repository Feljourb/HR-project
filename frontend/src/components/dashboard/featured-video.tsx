'use client'

import { useState } from 'react'
import { Captions, Check, Eye, MessageSquare, Mic, Play, ScrollText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { featuredVideo as video } from './data'
import { useLiveState } from './live-store'
import { NetworkCanvas } from './network-canvas'
import { stagger } from './panel'
import { ReactionBar } from './reactions'
import { focusTownHall } from './town-hall-panel'
import { VideoTheater, type TheaterTab } from './video-theater'
import { formatTimecode, fullDate } from './time'

const chapterEnd = (i: number) => video.chapters[i + 1]?.start ?? video.duration

export function FeaturedVideo({ className, index }: { className?: string; index: number }) {
  const [theater, setTheater] = useState<{ start: number; tab: TheaterTab } | null>(null)
  const [hovered, setHovered] = useState<number | null>(null)
  const watched = useLiveState().videoProgress[video.id] ?? 0
  const canResume = watched > 5 && watched < video.duration - 5

  const open = (start = canResume ? watched : 0, tab: TheaterTab = 'chapters') => setTheater({ start, tab })

  return <section style={stagger(index)} aria-labelledby="featured-video-title"
    className={cn('sbd-rise flex min-w-0 flex-col overflow-hidden rounded-xl bg-[#101B35] text-[#F7F1EC] shadow-[0_18px_40px_-18px_rgba(16,27,53,0.55)] ring-1 ring-[#192646]', className)}>

    {/* Poster: the whole area plays the video; content sits above the click target with pointer-events off. */}
    <div className="group relative flex min-h-[480px] flex-1 flex-col overflow-hidden sm:min-h-[360px] bg-[radial-gradient(90%_110%_at_100%_0%,#2A4170_0%,transparent_58%),linear-gradient(160deg,#192646_0%,#101B35_72%)] p-5 sm:p-6">
      <NetworkCanvas paused={theater !== null} className="absolute inset-0 size-full transition-transform duration-700 group-hover:scale-[1.02]" />
      <div aria-hidden className="absolute inset-0 bg-[linear-gradient(90deg,#101B35_0%,rgba(16,27,53,0.82)_38%,rgba(16,27,53,0)_70%)]" />
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#101B35]/90 to-transparent" />
      <button type="button" onClick={() => open()} aria-label={`${canResume ? 'Resume' : 'Play'} video: ${video.title}, ${formatTimecode(video.duration)}`} className="absolute inset-0 z-10 cursor-pointer focus-visible:outline-none" />

      <div className="pointer-events-none relative z-20 flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em]">
        {watched === 0 && <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E9D5C0] px-2 py-0.5 text-[#101B35]"><span className="size-1.5 rounded-full bg-[#8C6D52]" />New</span>}
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[#D5DBE8] ring-1 ring-inset ring-white/10">Leadership</span>
        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-black/25 px-2 py-0.5 text-[#D5DBE8]"><Captions className="size-3" />EN · FR</span>
      </div>

      <div className="pointer-events-none relative z-20 mt-auto max-w-[31rem] pt-10">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[#C9A27E]">{video.eyebrow}</p>
        <h2 id="featured-video-title" className="mt-2 text-balance text-[26px] font-semibold leading-[1.15] tracking-tight text-white sm:text-[30px]">{video.title}</h2>
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#A9B4CC]">
          <img src="/logo-white.png" alt="" className="h-4 w-auto" />
          <span className="font-medium text-[#E6EAF2]">{video.speaker}</span>
          <span aria-hidden>·</span><span>{fullDate(video.published)}</span>
          <span aria-hidden>·</span><span className="tabular-nums">{video.views.toLocaleString('en-US')} views</span>
        </p>

        <span className="mt-5 inline-flex items-center gap-3 rounded-full bg-[#F7F1EC] py-1.5 pl-1.5 pr-4 text-[#101B35] shadow-[0_10px_30px_-10px_rgba(0,0,0,0.5)] transition-transform duration-200 group-hover:scale-[1.03] group-has-[button:focus-visible]:ring-4 group-has-[button:focus-visible]:ring-[#E9D5C0]/50">
          <span className="relative flex size-10 items-center justify-center rounded-full bg-[#101B35] text-[#F7F1EC]">
            <span aria-hidden className="sbd-ripple absolute inset-0 rounded-full bg-[#101B35]" />
            <Play className="relative ml-0.5 size-4 fill-current" />
          </span>
          <span className="text-[13px] font-semibold">{canResume ? 'Resume message' : 'Watch the message'}</span>
          <span className="font-mono text-[11px] tabular-nums text-[#101B35]/60">{canResume ? `${formatTimecode(watched)} / ` : ''}{formatTimecode(video.duration)}</span>
        </span>
      </div>

      {/* Chapter timeline, proportional to each chapter's length; fills with watch progress. */}
      <div aria-hidden className="pointer-events-none relative z-20 mt-6 flex gap-[3px]">
        {video.chapters.map((chapter, i) => {
          const length = chapterEnd(i) - chapter.start
          const fill = Math.min(1, Math.max(0, (watched - chapter.start) / length))
          return <span key={chapter.start} style={{ flexGrow: length }} className={cn('relative basis-0 overflow-hidden rounded-full transition-all duration-200', hovered === i ? 'h-1.5 bg-white/45' : 'h-1 bg-white/20')}>
            <span className="absolute inset-y-0 left-0 rounded-full bg-[#F2C98F]" style={{ width: `${fill * 100}%` }} />
          </span>
        })}
      </div>
    </div>

    <ol className="grid grid-cols-2 gap-px border-t border-white/10 bg-white/10 sm:grid-cols-4">
      {video.chapters.map((chapter, i) => {
        const done = watched >= chapterEnd(i)
        return <li key={chapter.start} className="bg-[#101B35]">
          <button type="button" onClick={() => open(chapter.start)} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(i)} onBlur={() => setHovered(null)}
            aria-label={`Play from ${formatTimecode(chapter.start)}: ${chapter.title}`}
            className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-white/[0.05] focus-visible:bg-white/[0.08] focus-visible:outline-none">
            <span className="min-w-0 flex-1">
              <span className="block font-mono text-[10.5px] tabular-nums text-[#C9A27E]">{formatTimecode(chapter.start)}</span>
              <span className="mt-0.5 block truncate text-[12.5px] font-medium text-[#E6EAF2]">{chapter.title}</span>
            </span>
            {done && <Check className="size-3.5 shrink-0 text-[#F2C98F]" />}
          </button>
        </li>
      })}
    </ol>

    <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 border-t border-white/10 px-4 py-3">
      <ReactionBar id={video.id} counts={video.reactions} tone="dark" />
      <span className="flex items-center gap-3 text-[11px] text-[#A9B4CC]">
        <span className="flex items-center gap-1"><Eye className="size-3.5" />{video.views.toLocaleString('en-US')}</span>
        <span className="flex items-center gap-1"><MessageSquare className="size-3.5" />{video.comments}</span>
      </span>
      <span className="ml-auto flex gap-2">
        <button type="button" onClick={() => open(0, 'transcript')} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium text-[#D5DBE8] transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E9D5C0]/60"><ScrollText className="size-3.5" /> Transcript</button>
        <button type="button" onClick={focusTownHall} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#E9D5C0] px-3 text-[12px] font-semibold text-[#101B35] transition-colors hover:bg-[#F2E4D3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><Mic className="size-3.5" /> Ask a question</button>
      </span>
    </div>

    {theater && <VideoTheater start={theater.start} initialTab={theater.tab} onClose={() => setTheater(null)} />}
  </section>
}
