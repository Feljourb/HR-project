'use client'

import type { LucideIcon } from 'lucide-react'
import { CalendarDays, FileText, Moon, ReceiptText, Sparkles, Sun, Sunrise } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { stagger } from './panel'
import { isoWeek, longDate, officeClock } from './time'

const secondaryActions = [
  { label: 'Submit expense', icon: ReceiptText },
  { label: 'Demande administrative', icon: FileText },
]

function salutation(hour: number | null): { text: string; icon: LucideIcon } {
  if (hour === null) return { text: 'Welcome back', icon: Sparkles }
  if (hour < 12) return { text: 'Good morning', icon: Sunrise }
  if (hour < 18) return { text: 'Good afternoon', icon: Sun }
  return { text: 'Good evening', icon: Moon }
}

export function Greeting({ now }: { now: Date | null }) {
  const clock = now ? officeClock(now) : null
  const { text, icon: DayIcon } = salutation(clock ? Math.floor(clock.minutes / 60) : null)

  return <section style={stagger(0)} className="sbd-rise flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5 font-medium text-[#8C6D52]"><DayIcon className="size-3.5" />{clock ? longDate(clock.key) : 'Today'}</span>
        {clock && <span className="tabular-nums">Week {isoWeek(clock.key)}</span>}
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600 ring-1 ring-slate-200">
          <span className="relative flex size-1.5"><span className="absolute inline-flex size-full rounded-full bg-emerald-500 opacity-60 motion-safe:animate-ping" /><span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" /></span>
          <span className="font-mono tabular-nums text-slate-800">{clock ? <>{String(Math.floor(clock.minutes / 60)).padStart(2, '0')}<span className="sbd-blink">:</span>{String(clock.minutes % 60).padStart(2, '0')}</> : '--:--'}</span>
          Casablanca
        </span>
      </div>
      <h1 className="mt-1.5 text-balance text-2xl font-semibold tracking-tight text-[#192646]">{text}, Fatima</h1>
    </div>

    <div className="flex flex-wrap gap-2">
      <Button className="h-9 gap-1.5 bg-[#23355d] px-3.5 text-[13px] font-semibold text-white shadow-sm hover:bg-[#192646]"><CalendarDays className="size-4" /> Request leave</Button>
      {secondaryActions.map(({ label, icon: Icon }) => (
        <Button key={label} variant="outline" className="h-9 gap-1.5 border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-[#23355d]/30 hover:bg-white hover:text-[#23355d]">
          <Icon className="size-4 text-slate-400 transition-colors group-hover/button:text-[#23355d]" /> {label}
        </Button>
      ))}
    </div>
  </section>
}
