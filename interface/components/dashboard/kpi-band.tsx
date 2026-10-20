'use client'

import { useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { CalendarDays, Check, ClipboardCheck, Download, ReceiptText, Wallet } from 'lucide-react'
import { cn } from '@/lib/utils'
import { stagger, surface } from './panel'
import { expenseHistory, leave, pendingExpenses, tasks } from './data'
import { useLiveState } from './live-store'
import { MONTHS, MONTHS_LONG, daysBetween, daysInMonth, formatMad, officeClock, shortDate } from './time'

export function KpiBand({ now }: { now: Date | null }) {
  const clock = now ? officeClock(now) : null
  const balance = leave.entitlement - leave.taken
  const payday = clock ? daysInMonth(clock.year, clock.month) : null
  const daysToPay = clock && payday ? payday - clock.day : null
  const { acknowledged } = useLiveState()
  const openTasks = tasks.filter((t) => !(t.acknowledges && acknowledged[t.acknowledges])).length

  return <section style={stagger(1)} className={cn(surface, 'sbd-rise grid gap-px overflow-hidden bg-slate-200/80 sm:grid-cols-2 xl:grid-cols-4')}>
    <KpiCell icon={CalendarDays} label="Leave balance" value={String(balance)} unit={`of ${leave.entitlement} days`}
      footer={<>+{leave.monthlyAccrual} days accrue on <b className="font-semibold text-slate-700">1 {clock ? MONTHS[clock.month % 12] : 'next month'}</b></>}>
      <LeaveMeter />
    </KpiCell>

    <KpiCell icon={ReceiptText} label="Expenses in approval" value={formatMad(pendingExpenses.total)} unit="MAD"
      footer={<>{pendingExpenses.claims} claims · {pendingExpenses.withManager} with manager · {pendingExpenses.withFinance} with finance</>}>
      <ClaimsColumns />
    </KpiCell>

    <KpiCell icon={ClipboardCheck} label="Tasks to complete" value={String(openTasks)} unit={openTasks === 1 ? 'task left' : 'tasks left'}
      footer={<>Assigned by HR and IT</>}>
      <ul className="flex flex-col gap-1">
        {tasks.map((task) => {
          const done = Boolean(task.acknowledges && acknowledged[task.acknowledges])
          return <li key={task.id} className="flex items-center gap-2 text-xs">
            {done
              ? <Check className="size-3 shrink-0 text-emerald-600" />
              : <span className="mx-[3px] size-1.5 shrink-0 rounded-full bg-[#23355d]" />}
            <span className={cn('min-w-0 flex-1 truncate font-medium', done ? 'text-slate-400 line-through decoration-slate-300' : 'text-slate-700')}>{task.title}</span>
            {done
              ? <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-px text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">Done</span>
              : <DueChip due={task.due} days={clock ? daysBetween(clock.key, task.due) : null} />}
          </li>
        })}
      </ul>
    </KpiCell>

    <KpiCell icon={Wallet} label="Next payday" value={clock && payday ? `${payday} ${MONTHS[clock.month - 1]}` : '—'}
      unit={daysToPay === null ? '' : daysToPay === 0 ? 'today' : `in ${daysToPay} day${daysToPay > 1 ? 's' : ''}`}
      footer={<span className="flex items-center justify-between gap-2">
        <span>{clock ? MONTHS_LONG[(clock.month + 10) % 12] : 'Last'} payslip is ready</span>
        <button type="button" className="inline-flex items-center gap-1 font-semibold text-[#23355d] hover:underline"><Download className="size-3" /> PDF</button>
      </span>}>
      {clock && payday
        ? <div className="flex flex-col gap-2">
            <Meter value={clock.day} max={payday} />
            <div className="flex justify-between text-[11px] tabular-nums text-slate-500">
              <span>1 {MONTHS[clock.month - 1]}</span>
              <span>Day <b className="font-semibold text-slate-700">{clock.day}</b> of {payday}</span>
            </div>
          </div>
        : <Meter value={0} max={1} />}
    </KpiCell>
  </section>
}

function KpiCell({ icon: Icon, label, value, unit, footer, children }: { icon: LucideIcon; label: string; value: string; unit: string; footer: ReactNode; children: ReactNode }) {
  return <div className="group flex min-w-0 flex-col gap-3 bg-white p-4 transition-colors hover:bg-[#FCFCFD]">
    <div className="flex items-center justify-between gap-2">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <span className="flex size-7 items-center justify-center rounded-md bg-slate-50 text-slate-400 ring-1 ring-slate-200/70 transition-colors group-hover:bg-[#23355d] group-hover:text-white group-hover:ring-[#23355d]"><Icon className="size-3.5" /></span>
    </div>
    <p className="flex items-baseline gap-1.5">
      <span className="text-[28px] font-semibold leading-none tracking-tight text-[#192646]">{value}</span>
      <span className="text-xs font-medium text-slate-500">{unit}</span>
    </p>
    <div className="min-h-10">{children}</div>
    <div className="mt-auto border-t border-slate-100 pt-2.5 text-[11px] text-slate-500">{footer}</div>
  </div>
}

function LeaveMeter() {
  const segments = [
    { label: 'Taken', value: leave.taken, color: 'bg-[#23355d]' },
    { label: 'Planned', value: leave.planned, color: 'bg-[#8A9CC9]' },
    { label: 'Free', value: leave.entitlement - leave.taken - leave.planned, color: 'bg-[#E4E9F2]' },
  ]
  return <div className="flex flex-col gap-2">
    <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={segments.map((s) => `${s.label} ${s.value} days`).join(', ')}>
      {segments.map((s, i) => <span key={s.label} style={{ flexGrow: s.value, ...stagger(i) }} className={cn('sbd-grow-x h-full basis-0', s.color)} />)}
    </div>
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
      {segments.map((s) => <li key={s.label} className="flex items-center gap-1.5"><span className={cn('size-2 rounded-full', s.color, s.label === 'Free' && 'ring-1 ring-inset ring-[#C3CDDD]')} />{s.label} <b className="font-semibold tabular-nums text-slate-700">{s.value}</b></li>)}
    </ul>
  </div>
}

/* Sparkline columns: history in the de-emphasis tone, the focused month in the accent.
   Hover or keyboard focus moves the readout; it rests on the current month. */
function ClaimsColumns() {
  const last = expenseHistory.length - 1
  const [active, setActive] = useState(last)
  const max = Math.max(...expenseHistory.map((m) => m.amount))
  const slot = 20
  const bar = 12
  const height = 40
  const base = height - 1
  const current = expenseHistory[active]

  return <div className="flex items-end justify-between gap-3">
    <svg width={expenseHistory.length * slot} height={height} viewBox={`0 0 ${expenseHistory.length * slot} ${height}`} role="img" aria-label="Amount claimed per month, April to September" onMouseLeave={() => setActive(last)} className="shrink-0">
      <line x1={0} x2={expenseHistory.length * slot} y1={base + 0.5} y2={base + 0.5} stroke="#E2E8F0" strokeWidth={1} />
      {expenseHistory.map((m, i) => {
        const h = Math.max(3, (m.amount / max) * (base - 2))
        const x = i * slot + (slot - bar) / 2
        const y = base - h
        const r = 3
        return <g key={m.month} tabIndex={0} aria-label={`${m.month}: ${formatMad(m.amount)} MAD`} onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onBlur={() => setActive(last)} className="cursor-default outline-none">
          <rect x={i * slot} y={0} width={slot} height={height} fill="transparent" />
          <path d={`M${x} ${base} V${y + r} Q${x} ${y} ${x + r} ${y} H${x + bar - r} Q${x + bar} ${y} ${x + bar} ${y + r} V${base} Z`}
            fill={i === active ? '#23355d' : '#C3CDDD'} style={stagger(i)} className="sbd-grow-y transition-[fill] duration-150" />
        </g>
      })}
    </svg>
    <div className="min-w-0 text-right leading-tight">
      <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">{current.month} claimed</p>
      <p className="text-[13px] font-semibold tabular-nums text-[#192646]">{formatMad(current.amount)} <span className="text-[10px] font-medium text-slate-400">MAD</span></p>
    </div>
  </div>
}

function Meter({ value, max }: { value: number; max: number }) {
  return <div className="h-2 overflow-hidden rounded-full bg-[#E4E9F2]" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
    <div style={{ width: `${(value / max) * 100}%` }} className="sbd-grow-x h-full rounded-full bg-[#23355d]" />
  </div>
}

function DueChip({ due, days }: { due: string; days: number | null }) {
  const tone = days === null ? 'bg-slate-50 text-slate-600 ring-slate-200'
    : days < 0 ? 'bg-red-50 text-red-700 ring-red-200'
    : days <= 3 ? 'bg-amber-50 text-amber-700 ring-amber-200'
    : 'bg-slate-50 text-slate-600 ring-slate-200'
  const label = days === null ? shortDate(due) : days < 0 ? 'Overdue' : days === 0 ? 'Due today' : `${shortDate(due)} · ${days} d`
  return <span className={cn('shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums ring-1 ring-inset', tone)}>{label}</span>
}
