'use client'

import { useState, useSyncExternalStore } from 'react'
import { ArrowRight, BadgeCheck, ChevronLeft, ChevronRight, Eye, MessageSquare, Newspaper, Pause, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Panel, PanelHeader, PanelLink } from './panel'
import { news } from './data'
import { acknowledge, useLiveState } from './live-store'
import { NewsCover } from './news-cover'
import { ReactionBar } from './reactions'
import { formatClock, officeClock, shortDate } from './time'

const featured = news.filter((item) => item.featured)
const more = news.filter((item) => !item.featured)

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'
function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/* Top stories advance like "stories": the active bar fills over 8 s, then moves on.
   Rotation pauses on hover, on keyboard focus, with the pause button, and never starts
   when reduced motion is requested (WCAG 2.2.2). */
export function NewsPanel({ className, index }: { className?: string; index: number }) {
  const [active, setActive] = useState(0)
  const [userPaused, setUserPaused] = useState(false)
  const [hovering, setHovering] = useState(false)
  const [focused, setFocused] = useState(false)
  const reduced = useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  )
  const { acknowledged } = useLiveState()
  const running = !userPaused && !hovering && !focused && !reduced
  const story = featured[active]
  const unread = news.filter((item) => item.unread).length

  const go = (i: number) => setActive((i + featured.length) % featured.length)
  const ackAt = story.mustRead ? acknowledged[story.id] : undefined

  return <Panel className={className} index={index}>
    <PanelHeader icon={Newspaper} title="Company news" meta={`${news.length} stories this month · ${unread} unread`}>
      <button type="button" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-[#23355d] transition-colors hover:bg-slate-50">All news <ArrowRight className="size-3" /></button>
    </PanelHeader>

    <div className="px-3 pt-3" aria-roledescription="carousel" aria-label="Top stories"
      onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}
      onFocus={() => setFocused(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false) }}>
      <div className="group relative h-44 overflow-hidden rounded-lg bg-[#192646]">
        {featured.map((item, i) => (
          <NewsCover key={item.id} kind={item.cover} className={cn('absolute inset-0 size-full transition-[opacity,transform] duration-700 ease-out', i === active ? 'scale-100 opacity-100' : 'scale-[1.04] opacity-0')} />
        ))}
        <div aria-hidden className="absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-black/35 to-transparent" />

        <div className="absolute inset-x-3 top-2.5 flex items-center gap-1.5">
          {featured.map((item, i) => (
            <button key={item.id} type="button" onClick={() => go(i)} aria-label={`Story ${i + 1} of ${featured.length}: ${item.title}`} aria-current={i === active}
              className="flex h-4 flex-1 items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
              <span className="relative h-[3px] w-full overflow-hidden rounded-full bg-white/35">
                {i < active && <span className="absolute inset-0 bg-white" />}
                {i === active && (reduced
                  ? <span className="absolute inset-0 bg-white" />
                  : <span key={`run-${active}`} className="sbd-story absolute inset-0 bg-white" style={{ animationPlayState: running ? 'running' : 'paused' }} onAnimationEnd={() => go(active + 1)} />)}
              </span>
            </button>
          ))}
          <button type="button" onClick={() => setUserPaused(!userPaused)} aria-label={userPaused ? 'Resume rotation' : 'Pause rotation'}
            className="ml-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm transition-colors hover:bg-black/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
            {userPaused ? <Play className="ml-px size-3 fill-current" /> : <Pause className="size-3 fill-current" />}
          </button>
        </div>

        <button type="button" onClick={() => go(active - 1)} aria-label="Previous story" className="absolute left-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#192646] opacity-0 shadow-md transition-opacity group-hover:opacity-100 focus-visible:opacity-100"><ChevronLeft className="size-4" /></button>
        <button type="button" onClick={() => go(active + 1)} aria-label="Next story" className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#192646] opacity-0 shadow-md transition-opacity group-hover:opacity-100 focus-visible:opacity-100"><ChevronRight className="size-4" /></button>
      </div>

      <article key={story.id} role="group" aria-roledescription="slide" aria-label={`${active + 1} of ${featured.length}`} aria-live={running ? 'off' : 'polite'} className="sbd-fade flex flex-col gap-2 px-1 pb-1 pt-3">
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-slate-500">
          <span className="rounded-full bg-[#F7F1EC] px-2 py-px text-[10px] font-semibold text-[#8C6D52] ring-1 ring-inset ring-[#D7C4B7]/70">{story.category}</span>
          {story.mustRead && <span className={cn('rounded-full px-2 py-px text-[10px] font-semibold ring-1 ring-inset', ackAt ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-amber-50 text-amber-700 ring-amber-200')}>{ackAt ? 'Acknowledged' : 'Must read'}</span>}
          <span className="ml-0.5 font-medium text-slate-600">{story.author}</span>
          <span aria-hidden>·</span><span>{shortDate(story.date)}</span>
          <span aria-hidden>·</span><span>{story.readMinutes} min read</span>
          {story.unread && !ackAt && <span className="ml-auto inline-flex items-center gap-1 font-semibold text-[#23355d]"><span className="size-1.5 rounded-full bg-[#23355d]" />New</span>}
        </p>
        <h3 className="line-clamp-2 min-h-[2lh] text-[15px] font-semibold leading-snug text-[#192646]">
          <button type="button" className="text-left hover:underline hover:decoration-[#D7C4B7] hover:underline-offset-4">{story.title}</button>
        </h3>
        <p className="line-clamp-2 min-h-[2lh] text-xs leading-relaxed text-slate-600">{story.excerpt}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1">
          <ReactionBar id={story.id} counts={story.reactions} compact />
          <span className="flex items-center gap-2.5 text-[11px] text-slate-400">
            <span className="flex items-center gap-1"><Eye className="size-3.5" />{story.views.toLocaleString('en-US')}</span>
            <span className="flex items-center gap-1"><MessageSquare className="size-3.5" />{story.comments}</span>
          </span>
          <span className="ml-auto">
            {story.mustRead
              ? ackAt
                ? <span className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200"><BadgeCheck className="size-3.5" />Acknowledged {shortDate(officeClock(new Date(ackAt)).key)}, {formatClock(officeClock(new Date(ackAt)).minutes)}</span>
                : <button type="button" onClick={() => acknowledge(story.id)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#23355d] px-3 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-[#192646]">
                    <BadgeCheck className="size-3.5" />I’ve read this <span className="font-normal text-white/60">· due {shortDate(story.mustRead.due)}</span>
                  </button>
              : <button type="button" className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-[11px] font-semibold text-[#23355d] transition-colors hover:bg-slate-50">Read story <ArrowRight className="size-3" /></button>}
          </span>
        </div>
      </article>
    </div>

    <div className="mt-2 border-t border-slate-100">
      <p className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">More news</p>
      <ul className="flex flex-col px-2 pb-2">
        {more.map((item) => (
          <li key={item.id}>
            <button type="button" className="group flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-slate-50">
              <span className="h-12 w-[72px] shrink-0 overflow-hidden rounded-md ring-1 ring-slate-200/70">
                <NewsCover kind={item.cover} compact className="size-full transition-transform duration-500 group-hover:scale-105" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-[#8C6D52]">{item.category} <span className="font-medium normal-case tracking-normal text-slate-400">· {shortDate(item.date)} · {item.readMinutes} min</span></span>
                <span className="mt-0.5 line-clamp-2 text-xs font-semibold leading-snug text-slate-800">{item.title}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-slate-400"><MessageSquare className="size-3" />{item.comments}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>

    <PanelLink>All announcements</PanelLink>
  </Panel>
}
