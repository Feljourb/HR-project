'use client'

/*
 * "Time off & holidays" : les 6 prochaines semaines. Mes VRAIS congés (acceptés et en cours) et les vrais
 * jours fériés viennent de l'API Congés (useLeaveData). Les "company events" restent des exemples (data.ts) :
 * il n'y a pas encore de module d'événements.
 */
import { TreePalm } from 'lucide-react'
import { formatDays } from '@/lib/leaves'
import { cn } from '@/lib/utils'
import { DateTile, Panel, PanelHeader, PanelLink } from './panel'
import { timeOff } from './data'
import { MONTHS, addDays, dayParts, officeClock, shortDate, weekdayShort } from './time'
import type { LeaveData } from './use-leave-data'

const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

// pending : un congé encore en validation (N+1, RH).
type Kind = 'leave' | 'pending' | 'holiday' | 'event'
type Item = { from: string; to: string; kind: Kind; title: string; meta: string }

const kindTag: Record<Kind, { label: string; tone: string }> = {
  leave: { label: 'Your leave', tone: 'bg-[#E4E9F2] text-[#23355d]' },
  pending: { label: 'Pending', tone: 'bg-[#EEF1F8] text-[#5B6B95]' },
  holiday: { label: 'Holiday', tone: 'bg-[#F7F1EC] text-[#8C6D52]' },
  event: { label: 'Event', tone: 'bg-slate-100 text-slate-600' },
}

// Un jour peut être à la fois férié et dans un congé : on montre d'abord le férié (le bureau est fermé).
const PRIORITY: Kind[] = ['holiday', 'leave', 'pending', 'event']

/** Les congés (acceptés et en cours), les jours fériés et les événements, triés par date. */
function itemsOf(leaveData: LeaveData | null): Item[] {
  const events: Item[] = timeOff.filter((item) => item.kind === 'event')
  if (!leaveData) return events
  const leaves: Item[] = leaveData.leaves
    .filter((leave) => leave.status === 'APPROVED' || leave.status === 'IN_PROGRESS')
    .map((leave) => ({
      from: leave.start_date, to: leave.end_date, kind: leave.status === 'APPROVED' ? 'leave' : 'pending',
      title: leave.leave_type_label, meta: `${formatDays(leave.days)} · ${leave.status_label}`,
    }))
  const holidays: Item[] = leaveData.holidays.map((holiday) => ({
    from: holiday.date, to: holiday.date, kind: 'holiday', title: holiday.name,
    meta: holiday.estimated ? 'Office closed · date to confirm' : 'Office closed',
  }))
  return [...leaves, ...holidays, ...events].sort((a, b) => a.from.localeCompare(b.from))
}

export function TimeOffPanel({ now, leaveData, className, index }: {
  now: Date | null; leaveData: LeaveData | 'none' | null; className?: string; index: number
}) {
  const clock = now ? officeClock(now) : null
  /* Six weeks starting on the Monday of the current week. */
  const firstDay = clock ? addDays(clock.key, -clock.weekday) : null
  const days = firstDay ? Array.from({ length: 42 }, (_, i) => addDays(firstDay, i)) : null
  const data = leaveData && leaveData !== 'none' ? leaveData : null
  const items = itemsOf(data)
  const upcoming = items.filter((item) => !clock || item.to >= clock.key).slice(0, 4)

  return <Panel className={className} index={index}>
    <PanelHeader icon={TreePalm} title="Time off & holidays" meta={days ? `${shortDate(days[0])} – ${shortDate(days[41])}` : 'Next six weeks'}>
      <span className="text-[11px] text-slate-500"><b className="font-semibold tabular-nums text-[#192646]">{data ? data.balance.available : '—'}</b> days free to book</span>
    </PanelHeader>

    <div className="px-4 pt-3">
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAY_INITIALS.map((d, i) => <span key={i} className={cn('pb-0.5 text-[10px] font-semibold', i >= 5 ? 'text-slate-300' : 'text-slate-400')}>{d}</span>)}
        {days
          ? days.map((key, i) => <DayCell key={key} dayKey={key} today={clock!.key} weekend={i % 7 >= 5} items={items} />)
          : Array.from({ length: 42 }, (_, i) => <span key={i} className="h-7 rounded-md bg-slate-50" />)}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1 text-[10px] text-slate-500">
        <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-[#23355d]" />Your leave</li>
        <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-[#8A9CC9]" />Pending</li>
        <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-[#F7F1EC] ring-1 ring-inset ring-[#D7C4B7]" />Public holiday</li>
        <li className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-[#23355d]" />Company event</li>
        <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] ring-2 ring-inset ring-[#23355d]" />Today</li>
      </ul>
    </div>

    <ul className="flex flex-col px-2 py-2">
      {upcoming.map((item) => (
        <li key={`${item.kind}-${item.from}-${item.title}`} className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-slate-50">
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

    <PanelLink href="/leaves">Plan time off</PanelLink>
  </Panel>
}

function DayCell({ dayKey, today, weekend, items }: { dayKey: string; today: string; weekend: boolean; items: Item[] }) {
  const covering = items.filter((item) => dayKey >= item.from && dayKey <= item.to)
  const mark = PRIORITY.map((kind) => covering.find((item) => item.kind === kind)).find(Boolean)
  const { day, month } = dayParts(dayKey)
  const isToday = dayKey === today
  const tone = mark?.kind === 'holiday' ? 'bg-[#F7F1EC] font-semibold text-[#8C6D52] ring-1 ring-inset ring-[#D7C4B7]'
    : mark?.kind === 'leave' ? 'bg-[#23355d] font-semibold text-white'
    : mark?.kind === 'pending' ? 'bg-[#8A9CC9] font-semibold text-white'
    : isToday ? 'font-bold text-[#23355d] ring-2 ring-inset ring-[#23355d]'
    : dayKey < today ? 'text-slate-300'
    : weekend ? 'bg-slate-50 text-slate-400'
    : 'text-slate-600 hover:bg-slate-50'

  return <span title={mark ? `${shortDate(dayKey)} · ${mark.title}` : shortDate(dayKey)} className={cn('relative flex h-7 items-center justify-center rounded-md text-[11px] tabular-nums transition-colors', tone)}>
    {day === 1 ? <span><span className="mr-0.5 text-[8px] font-bold uppercase tracking-wide">{MONTHS[month]}</span>{day}</span> : day}
    {mark?.kind === 'event' && <span className="absolute bottom-[3px] size-1 rounded-full bg-[#23355d]" />}
  </span>
}
