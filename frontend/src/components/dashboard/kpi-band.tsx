'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { CalendarDays, Check, ClipboardCheck, Download, ReceiptText, Wallet } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import type { ExpenseClaim } from '@/lib/expenses'
import type { Balance } from '@/lib/leaves'
import type { Approval, WorkflowRequest } from '@/lib/requests'
import { cn } from '@/lib/utils'
import { stagger, surface } from './panel'
import type { LeaveData } from './use-leave-data'
import { MONTHS, MONTHS_LONG, daysInMonth, formatMad, officeClock, shortDate } from './time'

// validator : manager, RH, Admin RH, IT (ceux qui valident d'habitude). Un collaborateur voit ses demandes.
export function KpiBand({ now, leaveData, claims, validator }: {
  now: Date | null; leaveData: LeaveData | 'none' | null; claims: ExpenseClaim[] | null; validator: boolean
}) {
  const clock = now ? officeClock(now) : null
  // Le vrai solde (/api/leaves/mine/balance/) ; null tant qu'il n'est pas là, ou sans dossier RH.
  const balance = leaveData && leaveData !== 'none' ? leaveData.balance : null
  // Mes vraies notes de frais : en attente du N+1, et validées (à imprimer pour les RH, pas encore remboursées).
  const inApproval = (claims ?? []).filter((c) => c.status === 'IN_PROGRESS')
  const toPrint = (claims ?? []).filter((c) => c.status === 'APPROVED' && !c.reimbursed_at).length
  const payday = clock ? daysInMonth(clock.year, clock.month) : null
  const daysToPay = clock && payday ? payday - clock.day : null

  return <section style={stagger(1)} className={cn(surface, 'sbd-rise grid gap-px overflow-hidden bg-slate-200/80 sm:grid-cols-2 xl:grid-cols-4')}>
    <KpiCell icon={CalendarDays} label="Leave balance" value={balance ? String(balance.available) : '—'}
      unit={balance ? 'days available' : leaveData === 'none' ? 'no leave data' : ''}
      footer={<span className="flex items-center justify-between gap-2">
        {/* Les jours de l'an dernier perdus le 31/12 s'ils ne sont pas pris : on prévient. */}
        <span className="truncate">{balance?.expiring
          ? <><b className="font-semibold text-slate-700">{balance.expiring.days}</b> days lost on {shortDate(balance.expiring.on)}</>
          : 'Usable for 2 years'}</span>
        <Link href="/leaves" className="shrink-0 font-semibold text-[#23355d] hover:underline">Request a leave</Link>
      </span>}>
      {balance ? <LeaveMeter balance={balance} /> : <Meter value={0} max={1} />}
    </KpiCell>

    <KpiCell icon={ReceiptText} label="Expenses in approval" value={claims ? formatMad(inApproval.reduce((sum, c) => sum + c.total, 0)) : '—'} unit="MAD"
      footer={<span className="flex items-center justify-between gap-2">
        <span className="truncate">{claims ? `${inApproval.length} in approval · ${toPrint} validated (PDF for HR)` : ' '}</span>
        <Link href="/expenses" className="shrink-0 font-semibold text-[#23355d] hover:underline">Expense claims</Link>
      </span>}>
      {claims ? <ClaimsColumns history={monthlyTotals(claims, now)} /> : <Meter value={0} max={1} />}
    </KpiCell>

    <WorkCell validator={validator} now={now} />

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

// Pris (acceptés) / en attente (en cours de validation) / disponibles : les trois parts du solde.
function LeaveMeter({ balance }: { balance: Balance }) {
  const segments = [
    { label: 'Taken', value: balance.taken, color: 'bg-[#23355d]' },
    { label: 'Pending', value: balance.pending, color: 'bg-[#8A9CC9]' },
    { label: 'Free', value: Math.max(balance.available, 0), color: 'bg-[#E4E9F2]' },
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

/** Le montant de MES notes (validées ou en cours) par mois d'envoi, sur les 6 derniers mois. */
function monthlyTotals(claims: ExpenseClaim[], now: Date | null): { month: string; amount: number }[] {
  const today = now ?? new Date()
  return Array.from({ length: 6 }, (_, i) => {
    const day = new Date(today.getFullYear(), today.getMonth() - 5 + i, 1)
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}`
    const amount = claims.filter((c) => (c.status === 'IN_PROGRESS' || c.status === 'APPROVED') && c.created_at.startsWith(key))
      .reduce((sum, c) => sum + c.total, 0)
    return { month: MONTHS[day.getMonth()], amount }
  })
}

/* Sparkline columns: history in the de-emphasis tone, the focused month in the accent.
   Hover or keyboard focus moves the readout; it rests on the current month. */
function ClaimsColumns({ history: expenseHistory }: { history: { month: string; amount: number }[] }) {
  const last = expenseHistory.length - 1
  const [active, setActive] = useState(last)
  const max = Math.max(1, ...expenseHistory.map((m) => m.amount))  // au moins 1 : pas de division par zéro sans notes
  const slot = 20
  const bar = 12
  const height = 40
  const base = height - 1
  const current = expenseHistory[active]

  return <div className="flex items-end justify-between gap-3">
    <svg width={expenseHistory.length * slot} height={height} viewBox={`0 0 ${expenseHistory.length * slot} ${height}`} role="img" aria-label={`Amount claimed per month, ${expenseHistory[0].month} to ${expenseHistory[last].month}`} onMouseLeave={() => setActive(last)} className="shrink-0">
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

/*
 * La 3e case : ce que J'AI à faire, avec les vraies demandes du moteur des circuits.
 * - Un valideur (manager, RH...) : "To approve", les demandes qui attendent SA réponse (/api/workflows/approvals/).
 * - Un collaborateur : "My requests", ses demandes encore en cours (/api/workflows/requests/), et qui les attend.
 * Un collaborateur responsable d'équipe (il peut être le N+1 de quelqu'un) voit aussi "To approve" s'il a des demandes.
 */
function WorkCell({ validator, now }: { validator: boolean; now: Date | null }) {
  const [work, setWork] = useState<{ approvals: Approval[]; mine: WorkflowRequest[] } | null>(null)

  useEffect(() => {
    Promise.all([apiFetch('/api/workflows/approvals/'), apiFetch('/api/workflows/requests/')])
      .then(async ([approvals, mine]) => {
        if (!approvals.ok || !mine.ok) throw new Error()
        setWork({ approvals: await approvals.json(), mine: await mine.json() })
      })
      .catch(() => setWork({ approvals: [], mine: [] }))
  }, [])

  const toApprove = work?.approvals ?? []
  const inProgress = (work?.mine ?? []).filter((request) => request.status === 'IN_PROGRESS')
  const approving = validator || toApprove.length > 0

  // Depuis combien de jours la demande attend (pour voir celles qui traînent).
  const ageOf = (sent: string) => now ? Math.max(0, Math.floor((now.getTime() - Date.parse(sent)) / 86_400_000)) : null

  const lines = approving
    ? toApprove.slice(0, 3).map((approval) => ({ id: approval.id, title: approval.request.title, who: approval.request.requester, age: ageOf(approval.request.created_at) }))
    : inProgress.slice(0, 3).map((request) => {
        const step = request.steps.find((s) => s.status === 'PENDING')
        return { id: request.id, title: request.title, who: step ? `Waiting for ${step.validator}` : '', age: ageOf(request.created_at) }
      })
  const count = approving ? toApprove.length : inProgress.length

  return <KpiCell icon={ClipboardCheck} label={approving ? 'To approve' : 'My requests'}
    value={work ? String(count) : '—'} unit={approving ? 'waiting for you' : 'in progress'}
    footer={<span className="flex items-center justify-between gap-2">
      <span className="truncate">{approving ? 'Leaves, expenses and documents' : 'Follow them step by step'}</span>
      <Link href={approving ? '/approvals' : '/requests'} className="shrink-0 font-semibold text-[#23355d] hover:underline">
        {approving ? 'Team approvals' : 'My requests'}
      </Link>
    </span>}>
    {work && lines.length === 0
      ? <p className="flex items-center gap-1.5 text-xs text-slate-500"><Check className="size-3.5 text-emerald-600" />{approving ? 'Nothing waiting for you.' : 'No request in progress.'}</p>
      : <ul className="flex flex-col gap-1">
          {lines.map((line) => <li key={line.id} className="flex items-center gap-2 text-xs">
            <span className="mx-[3px] size-1.5 shrink-0 rounded-full bg-[#23355d]" />
            <span className="min-w-0 flex-1 truncate font-medium text-slate-700" title={`${line.title} · ${line.who}`}>
              {line.title} <span className="font-normal text-slate-400">· {line.who}</span>
            </span>
            {line.age !== null && <AgeChip days={line.age} />}
          </li>)}
        </ul>}
  </KpiCell>
}

// "today", "2 d"... ; en orange après 3 jours d'attente : une demande qui traîne.
function AgeChip({ days }: { days: number }) {
  const tone = days >= 3 ? 'bg-amber-50 text-amber-700 ring-amber-200' : 'bg-slate-50 text-slate-600 ring-slate-200'
  return <span className={cn('shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums ring-1 ring-inset', tone)}>{days === 0 ? 'today' : `${days} d`}</span>
}
