import type { CSSProperties, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MONTHS, dayParts } from './time'

/** Position in the load-in sequence; `.sbd-rise` / `.sbd-grow-*` offset their delay by it. */
export const stagger = (i: number) => ({ '--i': i }) as CSSProperties

export const surface = 'rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]'

export function Panel({ className, index = 0, children }: { className?: string; index?: number; children: ReactNode }) {
  return <section style={stagger(index)} className={cn('sbd-rise flex min-w-0 flex-col overflow-hidden', surface, className)}>{children}</section>
}

export function PanelHeader({ icon: Icon, title, meta, children }: { icon: LucideIcon; title: string; meta?: ReactNode; children?: ReactNode }) {
  return <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-100 px-4 py-3">
    <Icon className="size-4 shrink-0 text-[#8C6D52]" />
    <div className="min-w-0 flex-1">
      <h2 className="truncate text-sm font-semibold text-[#192646]">{title}</h2>
      {meta && <p className="truncate text-[11px] text-slate-500">{meta}</p>}
    </div>
    {children}
  </header>
}

export function PanelLink({ children }: { children: ReactNode }) {
  return <button type="button" className="mt-auto flex items-center justify-center gap-1 border-t border-slate-100 py-2.5 text-[11px] font-semibold text-[#23355d] transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none">
    {children}<ChevronRight className="size-3.5" />
  </button>
}

export function DateTile({ dayKey }: { dayKey: string }) {
  const { day, month } = dayParts(dayKey)
  return <span className="flex w-10 shrink-0 flex-col items-center rounded-md border border-[#D7C4B7]/70 bg-[#F7F1EC] py-1 leading-none">
    <span className="text-[9px] font-bold uppercase tracking-wider text-[#8C6D52]">{MONTHS[month]}</span>
    <span className="mt-0.5 text-sm font-bold tabular-nums text-[#23355d]">{day}</span>
  </span>
}
