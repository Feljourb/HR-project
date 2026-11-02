'use client'

/*
 * La page "Absences" (RH, Admin RH, IT) : qui est en congé, mois par mois.
 * Lu dans /api/leaves/absences/?date_from=&date_to= : Django renvoie les congés acceptés ET en cours
 * qui touchent ce mois. Un RH ne reçoit que son pôle ; Admin RH et IT, les deux pôles.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { formatDate, formatDays, type Absence } from '@/lib/leaves'
import { cn } from '@/lib/utils'

const BADGE: Record<string, string> = {
  IN_PROGRESS: 'bg-amber-50 text-amber-700',
  APPROVED: 'bg-emerald-50 text-emerald-700',
}

/** Une date en "AAAA-MM-JJ" (l'heure locale, pas UTC : sinon le 1er du mois peut devenir le 31). */
function iso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function Absences() {
  // Le mois affiché : son premier jour. Au départ, le mois en cours.
  const [month, setMonth] = useState(() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1) })
  const from = iso(month)
  const to = iso(new Date(month.getFullYear(), month.getMonth() + 1, 0))  // le jour 0 du mois suivant = le dernier jour de ce mois
  const key = `date_from=${from}&date_to=${to}`
  const [loaded, setLoaded] = useState<{ key: string; rows: Absence[] } | null>(null)
  const [failedKey, setFailedKey] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    apiFetch(`/api/leaves/absences/?${key}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status))
        setLoaded({ key, rows: await response.json() })
      })
      .catch(() => { if (!controller.signal.aborted) setFailedKey(key) })
    return () => controller.abort()
  }, [key])

  const rows = loaded?.key === key ? loaded.rows : null
  const today = iso(new Date())
  const absentToday = new Set((rows ?? []).filter((row) => row.status === 'APPROVED' && row.start_date <= today && today <= row.end_date)
    .map((row) => row.employee_id)).size
  const poles = new Set((rows ?? []).map((row) => row.pole))

  function move(months: number) {
    setMonth((old) => new Date(old.getFullYear(), old.getMonth() + months, 1))
  }

  return <div className="flex flex-col gap-4">
    <div>
      <h1 className="text-lg font-semibold text-[#192646]">Absences</h1>
      <p className="text-xs text-slate-500">Approved leaves and leaves waiting for approval, month by month.</p>
    </div>

    <section className="rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Previous month" onClick={() => move(-1)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"><ChevronLeft className="size-4" /></button>
          <h2 className="min-w-36 text-center text-sm font-semibold capitalize text-[#192646]">
            {month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
          </h2>
          <button type="button" aria-label="Next month" onClick={() => move(1)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"><ChevronRight className="size-4" /></button>
        </div>
        {rows && <p className="ml-auto text-[11px] text-slate-500">
          {rows.length} leave{rows.length === 1 ? '' : 's'} · {absentToday} {absentToday === 1 ? 'person' : 'people'} absent today
        </p>}
      </header>

      {rows === null
        ? <p className="px-4 py-10 text-center text-sm text-slate-500">{failedKey === key ? 'Could not load the absences. Please try again later.' : 'Loading...'}</p>
        : rows.length === 0
          ? <p className="px-4 py-10 text-center text-sm text-slate-500"><CalendarDays className="mx-auto mb-2 size-6 text-[#8C6D52]" />No leave this month.</p>
          : <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-xs">
                <thead>
                  <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2">Employee</th>
                    <th className="px-4 py-2">Service</th>
                    <th className="px-4 py-2">Type</th>
                    <th className="px-4 py-2">Dates</th>
                    <th className="px-4 py-2 text-right">Days</th>
                    <th className="px-4 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const now = row.start_date <= today && today <= row.end_date
                    return <tr key={row.id} className={cn('border-t border-slate-100', now && 'bg-blue-50/40')}>
                      <td className="px-4 py-2.5 font-semibold text-[#192646]">
                        {row.employee}
                        {now && <span className="ml-2 rounded-full bg-[#192646] px-1.5 py-0.5 text-[10px] font-semibold text-white">Today</span>}
                      </td>
                      {/* Admin RH voit les deux pôles : on dit lequel. */}
                      <td className="px-4 py-2.5 text-slate-600">{row.department}{poles.size > 1 && <span className="text-slate-400"> · {row.pole}</span>}</td>
                      <td className="px-4 py-2.5 text-slate-600">{row.leave_type_label}</td>
                      <td className="px-4 py-2.5 text-slate-600">
                        <Link href={`/requests/${row.request}`} className="hover:underline">
                          {formatDate(row.start_date, true)}{row.starts_afternoon && ' (pm)'} → {formatDate(row.end_date, true)}{row.ends_noon && ' (am)'}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{formatDays(row.days)}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', BADGE[row.status])}>{row.status_label}</span>
                      </td>
                    </tr>
                  })}
                </tbody>
              </table>
            </div>}
    </section>
  </div>
}
