'use client'

/*
 * La page "Absences" (RH, Admin RH, IT) : qui est en congé, mois par mois.
 * Lu dans /api/leaves/absences/?date_from=&date_to=&status=all : TOUTES les demandes qui touchent ce mois
 * (aussi refusées et annulées) ; les filtres (statut, type, nom) se font ici, dans le navigateur.
 * Par défaut le tableau montre les absences (acceptées + en cours). Un RH ne reçoit que son pôle ;
 * Admin RH et IT, les deux pôles. Chaque ligne ouvre l'historique de la demande.
 * En haut, les chiffres du mois (/api/leaves/absences/summary/), que les RH téléchargent en image
 * pour leurs présentations ("Download image").
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { formatDate, formatDays, isoDate, type Absence, type AbsenceSummary } from '@/lib/leaves'
import { cn } from '@/lib/utils'
import { StatTiles } from './stat-tiles'

const BADGE: Record<string, string> = {
  IN_PROGRESS: 'bg-amber-50 text-amber-700',
  APPROVED: 'bg-emerald-50 text-emerald-700',
  REJECTED: 'bg-red-50 text-red-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
}

// Le filtre "Status". "active" (par défaut) = les absences : acceptées + en cours.
const STATUS_FILTERS = [
  { id: 'active', name: 'Approved & pending' },
  { id: 'all', name: 'All requests' },
  { id: 'APPROVED', name: 'Approved' },
  { id: 'IN_PROGRESS', name: 'Pending' },
  { id: 'REJECTED', name: 'Refused' },
  { id: 'CANCELLED', name: 'Cancelled' },
]

function matchesStatus(status: string, filter: string) {
  if (filter === 'all') return true
  if (filter === 'active') return status === 'APPROVED' || status === 'IN_PROGRESS'
  return status === filter
}

const filterClass = 'h-8 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs outline-none focus:border-[#23355d] focus:bg-white'

type Loaded = { key: string; rows: Absence[]; summary: AbsenceSummary }

export function Absences() {
  // Le mois affiché : son premier jour. Au départ, le mois en cours.
  const [month, setMonth] = useState(() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1) })
  const from = isoDate(month)
  const to = isoDate(new Date(month.getFullYear(), month.getMonth() + 1, 0))  // le jour 0 du mois suivant = le dernier jour de ce mois
  const key = `date_from=${from}&date_to=${to}`
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failedKey, setFailedKey] = useState('')
  // Les filtres du tableau (gardés quand on change de mois).
  const [statusFilter, setStatusFilter] = useState('active')
  const [typeFilter, setTypeFilter] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    // Le tableau et ses chiffres, ensemble : ils parlent toujours du même mois.
    Promise.all([
      apiFetch(`/api/leaves/absences/?${key}&status=all`, { signal: controller.signal }),
      apiFetch(`/api/leaves/absences/summary/?${key}`, { signal: controller.signal }),
    ])
      .then(async ([rows, summary]) => {
        if (!rows.ok || !summary.ok) throw new Error()
        setLoaded({ key, rows: await rows.json(), summary: await summary.json() })
      })
      .catch(() => { if (!controller.signal.aborted) setFailedKey(key) })
    return () => controller.abort()
  }, [key])

  const current = loaded?.key === key ? loaded : null
  const rows = current?.rows ?? null
  const poles = new Set((rows ?? []).map((row) => row.pole))
  const types = [...new Set((rows ?? []).map((row) => row.leave_type_label))].sort()
  const needle = search.trim().toLowerCase()
  const shown = (rows ?? []).filter((row) => matchesStatus(row.status, statusFilter)
    && (!typeFilter || row.leave_type_label === typeFilter)
    && (!needle || row.employee.toLowerCase().includes(needle)))
  const activeCount = (rows ?? []).filter((row) => matchesStatus(row.status, 'active')).length
  const today = isoDate(new Date())
  const monthName = month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const isThisMonth = from <= today && today <= to

  function move(months: number) {
    setMonth((old) => new Date(old.getFullYear(), old.getMonth() + months, 1))
  }

  return <div className="flex flex-col gap-4">
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-lg font-semibold text-[#192646]">Absences</h1>
        <p className="text-xs text-slate-500">Approved leaves and leaves waiting for approval, month by month.</p>
      </div>
      {/* Le mois : il change les chiffres ET le tableau. */}
      <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-1 py-0.5">
        <button type="button" aria-label="Previous month" onClick={() => move(-1)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"><ChevronLeft className="size-4" /></button>
        <h2 className="min-w-36 text-center text-sm font-semibold capitalize text-[#192646]">{monthName}</h2>
        <button type="button" aria-label="Next month" onClick={() => move(1)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"><ChevronRight className="size-4" /></button>
      </div>
    </div>

    {current && <StatTiles
      label={`Absences of ${monthName}`}
      image={{
        title: `Absences · ${monthName}`,
        subtitle: `${poles.size ? `Pôle ${[...poles].join(' & ')}` : 'Your pôle'} · approved and pending leaves`,
        fileName: `absences_${from.slice(0, 7)}.png`,
      }}
      tiles={[
        { label: 'People absent', value: String(current.summary.people), hint: 'At least one leave this month', strong: true },
        { label: 'Days approved', value: formatDays(current.summary.approved_days), hint: 'Inside this month' },
        { label: 'Days pending', value: formatDays(current.summary.pending_days), hint: 'Waiting for approval' },
        // "Aujourd'hui" n'a de sens que pour le mois en cours ; sinon, le nombre de congés.
        isThisMonth
          ? { label: 'Absent today', value: String(current.summary.absent_today), hint: 'Approved leave today' }
          : { label: 'Leave requests', value: String(activeCount), hint: 'Approved or pending' },
      ]} />}

    <section className="rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-[#192646]">Leave requests of {monthName}</h2>
        {rows && <p className="ml-auto text-[11px] text-slate-500">{shown.length} of {rows.length} request{rows.length === 1 ? '' : 's'}</p>}
      </header>

      {/* Les filtres : statut (par défaut les absences), type de congé, nom du collaborateur. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <label htmlFor="status-filter" className="sr-only">Status</label>
        <select id="status-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={filterClass}>
          {STATUS_FILTERS.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
        <label htmlFor="type-filter" className="sr-only">Type of leave</label>
        <select id="type-filter" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={filterClass}>
          <option value="">All types</option>
          {types.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <label htmlFor="employee-search" className="sr-only">Search an employee</label>
        <input id="employee-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search an employee..."
          className={cn(filterClass, 'w-52')} />
      </div>

      {rows === null
        ? <p className="px-4 py-10 text-center text-sm text-slate-500">{failedKey === key ? 'Could not load the absences. Please try again later.' : 'Loading...'}</p>
        : shown.length === 0
          ? <p className="px-4 py-10 text-center text-sm text-slate-500"><CalendarDays className="mx-auto mb-2 size-6 text-[#8C6D52]" />
              {rows.length === 0 ? 'No leave request this month.' : 'No request matches these filters.'}</p>
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
                    <th className="px-4 py-2 text-right">History</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => {
                    // "Today" : seulement une vraie absence (un congé refusé ou annulé n'éloigne personne).
                    const now = matchesStatus(row.status, 'active') && row.start_date <= today && today <= row.end_date
                    // Un jour férié a changé après l'envoi : le dernier recalcul, et ce que les RH doivent vérifier.
                    const recount = row.recounts[row.recounts.length - 1]
                    const toCheck = recount?.warning && matchesStatus(row.status, 'active') ? recount.warning : ''
                    return <tr key={row.id} className={cn('border-t border-slate-100', now && 'bg-blue-50/40')}>
                      <td className="px-4 py-2.5 font-semibold text-[#192646]">
                        {row.employee}
                        {now && <span className="ml-2 rounded-full bg-[#192646] px-1.5 py-0.5 text-[10px] font-semibold text-white">Today</span>}
                      </td>
                      {/* Admin RH voit les deux pôles : on dit lequel. */}
                      <td className="px-4 py-2.5 text-slate-600">{row.department}{poles.size > 1 && <span className="text-slate-400"> · {row.pole}</span>}</td>
                      <td className="px-4 py-2.5 text-slate-600">{row.leave_type_label}</td>
                      <td className="px-4 py-2.5 text-slate-600">
                        <Link href={`/requests/${row.request}?from=absences`} className="hover:underline">
                          {formatDate(row.start_date, true)}{row.starts_afternoon && ' (pm)'} → {formatDate(row.end_date, true)}{row.ends_noon && ' (am)'}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                        {recount && <span title={`Recounted ${formatDays(recount.old_days)} → ${formatDays(recount.new_days)} · ${recount.reason}`}
                          className="mr-1.5 inline-flex align-[-2px] text-sky-600">
                          <RefreshCw className="size-3" aria-hidden />
                          <span className="sr-only">Recounted from {formatDays(recount.old_days)}: {recount.reason}.</span>
                        </span>}
                        {formatDays(row.days)}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap items-center gap-1">
                          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', BADGE[row.status])}>{row.status_label}</span>
                          {toCheck && <span title={toCheck} className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                            <AlertTriangle className="size-3" aria-hidden /> To check<span className="sr-only">: {toCheck}</span>
                          </span>}
                          {/* P2 step 4 : un certificat demandé mais pas encore reçu (les RH relancent le collaborateur). */}
                          {row.document_required && !row.has_document && matchesStatus(row.status, 'active') &&
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                              <AlertTriangle className="size-3" aria-hidden /> Document missing
                            </span>}
                        </div>
                      </td>
                      {/* L'historique de la demande : chaque étape, qui a répondu, quand, et le commentaire. */}
                      <td className="px-4 py-2.5 text-right">
                        <Link href={`/requests/${row.request}?from=absences`} className="font-semibold text-[#23355d] hover:underline">View</Link>
                      </td>
                    </tr>
                  })}
                </tbody>
              </table>
            </div>}
    </section>
  </div>
}
