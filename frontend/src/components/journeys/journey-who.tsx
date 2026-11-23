'use client'

/*
 * QUI arrive / part, et QUAND : le même en-tête dans "My tasks" et dans la page des RH (un seul composant).
 * Ex. [SA] Sara Alami  (Arrival)  · Commercial terrain · Ventes
 *          First day: 01/12/2026 (in 8 days)
 */
import { LogIn, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'
import { frDate, fromToday, KIND_LABEL, type EmployeeCard, type JourneyKind } from '@/lib/journeys'

export function KindBadge({ kind }: { kind: JourneyKind }) {
  const Icon = kind === 'ARRIVAL' ? LogIn : LogOut
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
    kind === 'ARRIVAL' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>
    <Icon className="size-3" aria-hidden /> {KIND_LABEL[kind]}
  </span>
}

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

export function JourneyWho({ employee, kind, day }: { employee: EmployeeCard; kind: JourneyKind; day: string }) {
  return <div className="flex min-w-0 items-center gap-3">
    <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#23355d]/10 text-xs font-bold text-[#23355d]">
      {initials(employee.name)}
    </span>
    <div className="min-w-0">
      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[#192646]">
        <span className="truncate">{employee.name}</span> <KindBadge kind={kind} />
      </p>
      <p className="truncate text-[11px] text-slate-500">
        {kind === 'ARRIVAL' ? 'First day' : 'Last day'}: <span className="font-semibold text-slate-700">{frDate(day)}</span> ({fromToday(day)})
        {' · '}{employee.position} · {employee.department}
      </p>
    </div>
  </div>
}
