'use client'

import { TreePalm } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DateTile, Panel, PanelHeader, PanelLink } from './panel'
import { leave, timeOff, type TimeOffKind } from './data'
import { MONTHS, addDays, dayParts, officeClock, shortDate, weekdayShort } from './time'

const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

const kindTag: Record<TimeOffKind, { label: string; tone: string }> = {
  leave: { label: 'Your leave', tone: 'bg-[#E4E9F2] text-[#23355d]' },
  holiday: { label: 'Holiday', tone: 'bg-[#F7F1EC] text-[#8C6D52]' },
  event: { label: 'Event', tone: 'bg-slate-100 text-slate-600' },
}

export function TimeOffPanel({ now, className, index }: { now: Date | null; className?: string; index: number }) {
  const clock = now ? officeClock(now) : null
  /* Six weeks starting on the Monday of the current week. */
  const firstDay = clock ? addDays(clock.key, -clock.weekday) : null
  const days = firstDay ? Array.from({ length: 42 }, (_, i) => addDays(firstDay, i)) : null
  const upcoming = timeOff.filter((item) => !clock || item.to >= clock.key).slice(0, 3)
  const free = leave.entitlement - leave.taken - leave.planned

  return <Panel className={className} index={index}>
    <PanelHeader icon={TreePalm} title="Time off & holidays" meta={days ? `${shortDate(days[0])} – ${shortDate(days[41])}` : 'Next six weeks'}>
      <span className="text-[11px] text-slate-500"><b className="font-semibold tabular-nums text-[#192646]">{free}</b> days free to book</span>
    </PanelHeader>

    <div className="px-4 pt-3">
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAY_INITIALS.map((d, i) => <span key={i} className={cn('pb-0.5 text-[10px] font-semibold', i >= 5 ? 'text-slate-300' : 'text-slate-400')}>{d}</span>)}
        {days
          ? days.map((key, i) => <DayCell key={key} dayKey={key} today={clock!.key} weekend={i % 7 >= 5} />)
          : Array.from({ length: 42 }, (_, i) => <span key={i} className="h-7 rounded-md bg-slate-50" />)}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1 text-[10px] text-slate-500">
        <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-[#23355d]" />Your leave</li>
        <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-[#F7F1EC] ring-1 ring-inset ring-[#D7C4B7]" />Public holiday</li>
        <li className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-[#23355d]" />Company event</li>
        <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] ring-2 ring-inset ring-[#23355d]" />Today</li>
      </ul>
    </div>

    <ul className="flex flex-col px-2 py-2">
      {upcoming.map((item) => (
        <li key={item.title} className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-slate-50">
          <DateTile dayKey={item.from} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-slate-800">{item.title}</p>
            <p className="truncate text-[11px] text-slate-500">
              {item.from === item.to ? `${weekdayShort(item.from)} ${shortDate(item.from)}` : `${shortDate(item.from)} – ${shortDate(item.to)}`} · {item.meta}
            </p>
          </div>
          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold', kindTag[item.kind].tone)}>{kindTag[item.kind].label}</span>
        </li>
      ))}
      {upcoming.length === 0 && <li className="px-2 py-3 text-xs text-slate-500">Nothing scheduled in the coming weeks.</li>}
    </ul>

    <PanelLink>Plan time off</PanelLink>
  </Panel>
}

function DayCell({ dayKey, today, weekend }: { dayKey: string; today: string; weekend: boolean }) {
  const mark = timeOff.find((item) => dayKey >= item.from && dayKey <= item.to)
  const { day, month } = dayParts(dayKey)
  const isToday = dayKey === today
  const tone = mark?.kind === 'leave' ? 'bg-[#23355d] font-semibold text-white'
    : mark?.kind === 'holiday' ? 'bg-[#F7F1EC] font-semibold text-[#8C6D52] ring-1 ring-inset ring-[#D7C4B7]'
    : isToday ? 'font-bold text-[#23355d] ring-2 ring-inset ring-[#23355d]'
    : dayKey < today ? 'text-slate-300'
    : weekend ? 'bg-slate-50 text-slate-400'
    : 'text-slate-600 hover:bg-slate-50'

  return <span title={mark ? `${shortDate(dayKey)} · ${mark.title}` : shortDate(dayKey)} className={cn('relative flex h-7 items-center justify-center rounded-md text-[11px] tabular-nums transition-colors', tone)}>
    {day === 1 ? <span><span className="mr-0.5 text-[8px] font-bold uppercase tracking-wide">{MONTHS[month]}</span>{day}</span> : day}
    {mark?.kind === 'event' && <span className="absolute bottom-[3px] size-1 rounded-full bg-[#23355d]" />}
  </span>
}
