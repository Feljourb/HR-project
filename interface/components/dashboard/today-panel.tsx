'use client'

import { Fragment } from 'react'
import { CalendarClock, MapPin, Video } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Panel, PanelHeader, PanelLink, stagger } from './panel'
import { agenda, weekLoad, type AgendaItem } from './data'
import { formatClock, formatDuration, officeClock, shortDate, toMinutes, weekdayShort } from './time'

type AgendaStatus = 'past' | 'live' | 'upcoming'
type AgendaEntry = AgendaItem & { startMin: number; endMin: number; status: AgendaStatus }

export function getAgendaState(minutes: number) {
  const items: AgendaEntry[] = agenda.map((item) => {
    const startMin = toMinutes(item.start)
    const endMin = toMinutes(item.end)
    const status: AgendaStatus = endMin <= minutes ? 'past' : startMin <= minutes ? 'live' : 'upcoming'
    return { ...item, startMin, endMin, status }
  })
  const live = items.find((item) => item.status === 'live') ?? null
  const next = items.find((item) => item.status === 'upcoming') ?? null
  /* The "now" line sits before the next meeting; a meeting in progress marks "now" itself. */
  const markerAt = live ? -1 : next ? items.indexOf(next) : items.length
  return { items, live, next, markerAt, remaining: items.filter((item) => item.status !== 'past').length }
}

/* Rail x-position = row padding (16) + time column (40) + gap (12) + half the node column (5). */
const rail = <span aria-hidden className="absolute inset-y-0 left-[72.5px] w-px bg-slate-200" />

export function TodayPanel({ now, className, index }: { now: Date | null; className?: string; index: number }) {
  const clock = now ? officeClock(now) : null
  const state = clock ? getAgendaState(clock.minutes) : null
  const items: AgendaEntry[] = state?.items ?? agenda.map((item) => ({ ...item, startMin: toMinutes(item.start), endMin: toMinutes(item.end), status: 'upcoming' }))
  const totalHours = weekLoad.reduce((sum, d) => sum + d.hours, 0)

  return <Panel className={className} index={index}>
    <PanelHeader icon={CalendarClock} title="Today" meta={`${clock ? `${weekdayShort(clock.key)} ${shortDate(clock.key)} · ` : ''}${agenda.length} meetings`}>
      {state && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{state.remaining ? `${state.remaining} to go` : 'Day complete'}</span>}
    </PanelHeader>

    <ol className="flex flex-col py-1.5">
      {items.map((item, i) => <Fragment key={item.title}>
        {clock && state?.markerAt === i && <NowMarker minutes={clock.minutes} />}
        <AgendaRow item={item} isNext={state?.next === item} minutes={clock?.minutes ?? null} />
      </Fragment>)}
      {clock && state?.markerAt === items.length && <NowMarker minutes={clock.minutes} />}
    </ol>

    <div className="mx-4 mb-3 mt-auto rounded-lg bg-slate-50 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-medium text-slate-600">Meeting load this week</p>
        <p className="text-[11px] tabular-nums text-slate-500"><span className="font-semibold text-slate-700">{totalHours} h</span> of 40 h</p>
      </div>
      <div className="mt-2 grid grid-cols-5 gap-2">
        {weekLoad.map((d, i) => {
          const isToday = clock?.weekday === i
          return <div key={d.day} className="flex flex-col items-center gap-1" title={`${d.day}: ${d.hours} h of meetings`}>
            <div className="flex h-8 w-full items-end justify-center border-b border-slate-200">
              <span style={{ height: `${(d.hours / 5) * 100}%`, ...stagger(i) }} className={cn('sbd-grow-y w-full max-w-6 rounded-t-[4px]', isToday ? 'bg-[#23355d]' : 'bg-[#C3CDDD]')} />
            </div>
            <span className={cn('text-[10px] tabular-nums', isToday ? 'font-semibold text-[#192646]' : 'text-slate-400')}>{isToday ? `${d.day} · ${d.hours} h` : d.day}</span>
          </div>
        })}
      </div>
    </div>

    <PanelLink>Open calendar</PanelLink>
  </Panel>
}

function AgendaRow({ item, isNext, minutes }: { item: AgendaEntry; isNext: boolean; minutes: number | null }) {
  const Place = item.online ? Video : MapPin
  const isPast = item.status === 'past'
  const isLive = item.status === 'live'
  return <li className={cn('relative flex gap-3 px-4 py-2', isLive && 'bg-[#23355d]/[0.05]')}>
    {rail}
    <div className={cn('w-10 shrink-0 text-right font-mono text-[11px] leading-[18px] tabular-nums', isPast ? 'text-slate-400' : 'text-slate-700')}>
      {item.start}
      <div className="text-[10px] leading-4 text-slate-400">{item.end}</div>
    </div>
    <div className="relative z-10 flex w-2.5 shrink-0 justify-center pt-1">
      {isLive
        ? <span className="relative flex size-2.5"><span className="absolute inline-flex size-full rounded-full bg-[#23355d] opacity-50 motion-safe:animate-ping" /><span className="relative inline-flex size-2.5 rounded-full bg-[#23355d] ring-[3px] ring-[#F4F5F8]" /></span>
        : <span className={cn('size-2.5 rounded-full ring-[3px] ring-white', isPast ? 'bg-slate-300' : 'border-2 border-[#23355d] bg-white')} />}
    </div>
    <div className={cn('min-w-0 flex-1', isPast && 'opacity-60')}>
      <p className="truncate text-[13px] font-medium leading-[18px] text-slate-800">{item.title}</p>
      <p className="flex items-center gap-1 truncate text-[11px] text-slate-500"><Place className="size-3 shrink-0" />{item.place} · {item.people}</p>
    </div>
    {isLive && minutes !== null && <span className="h-fit shrink-0 rounded-full bg-[#23355d] px-2 py-0.5 text-[10px] font-semibold text-white">Now · {formatDuration(item.endMin - minutes)} left</span>}
    {isNext && minutes !== null && <span className="h-fit shrink-0 rounded-full bg-[#F7F1EC] px-2 py-0.5 text-[10px] font-semibold text-[#8C6D52] ring-1 ring-inset ring-[#D7C4B7]/70">In {formatDuration(item.startMin - minutes)}</span>}
  </li>
}

function NowMarker({ minutes }: { minutes: number }) {
  return <li aria-label={`Current time ${formatClock(minutes)}`} className="relative flex items-center gap-3 px-4 py-1">
    {rail}
    <span className="w-10 shrink-0 text-right font-mono text-[10px] font-semibold tabular-nums text-[#8C6D52]">{formatClock(minutes)}</span>
    <span className="relative z-10 flex w-2.5 shrink-0 justify-center"><span className="size-2 rounded-full bg-[#8C6D52] ring-[3px] ring-white" /></span>
    <span className="h-px flex-1 bg-[#8C6D52]/40" />
  </li>
}
