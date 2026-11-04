'use client'

/*
 * La page "Leave balances" (RH, Admin RH, IT) : le solde de chaque collaborateur, sur un seul écran (P1 step 1).
 * Lu dans /api/leaves/balances/ (?left=1 : aussi les "Sorti") : RH = son pôle ; Admin RH et IT = les deux.
 * Les chiffres viennent de la MÊME fonction que la page du collaborateur (balance() dans Django) :
 * le navigateur ne recompte rien, il filtre et trie seulement.
 */
import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight, PiggyBank } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { formatDate, type BalanceRow as Row } from '@/lib/leaves'
import { cn } from '@/lib/utils'
import { BalancePanel } from './balance-panel'
import { StatTiles } from './stat-tiles'

// Les colonnes qu'on peut trier (clic sur le titre).
type SortKey = 'employee' | 'available' | 'expiring'
type Sort = { key: SortKey; descending: boolean }

const filterClass = 'h-8 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs outline-none focus:border-[#23355d] focus:bg-white'

/** 13.5 -> "13.5", 4 -> "4", 1.625 -> "1.63" : un nombre de jours, sans le mot "days" (c'est le titre de la colonne). */
const days = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/, ''))
const expiringOf = (row: Row) => row.expiring?.days ?? 0

function compare(a: Row, b: Row, key: SortKey) {
  if (key === 'employee') return a.employee.localeCompare(b.employee, 'fr')
  if (key === 'available') return a.available - b.available
  return expiringOf(a) - expiringOf(b)
}

// initialEmployee : ouvert depuis la fiche (?employee=12) : son panneau s'ouvre tout de suite.
export function LeaveBalances({ initialEmployee = null }: { initialEmployee?: number | null }) {
  const [showLeft, setShowLeft] = useState(false)
  // +1 après un changement dans le panneau : le tableau est relu (le solde a changé).
  const [version, setVersion] = useState(0)
  const key = `${showLeft ? '?left=1' : ''}#${version}`
  const [openId, setOpenId] = useState<number | null>(initialEmployee)
  const [loaded, setLoaded] = useState<{ key: string; rows: Row[] } | null>(null)
  const [failedKey, setFailedKey] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [service, setService] = useState('')
  const [sort, setSort] = useState<Sort>({ key: 'employee', descending: false })

  useEffect(() => {
    const controller = new AbortController()
    apiFetch(`/api/leaves/balances/${key.split('#')[0]}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error()
        setLoaded({ key, rows: await response.json() })
      })
      .catch(() => { if (!controller.signal.aborted) setFailedKey(key) })
    return () => controller.abort()
  }, [key])

  const rows = loaded?.key === key ? loaded.rows : null
  const poles = new Set((rows ?? []).map((row) => row.pole))
  const services = [...new Set((rows ?? []).map((row) => row.department))].sort((a, b) => a.localeCompare(b, 'fr'))
  const needle = search.trim().toLowerCase()
  const shown = (rows ?? [])
    .filter((row) => (!service || row.department === service) && (!needle || row.employee.toLowerCase().includes(needle)))
    .sort((a, b) => (sort.descending ? -1 : 1) * compare(a, b, sort.key))

  // Les chiffres du haut : sur les lignes AFFICHÉES (les filtres changent aussi les cases).
  const expiringPeople = shown.filter((row) => expiringOf(row) > 0)
  const negative = shown.filter((row) => row.available < 0).length

  // Un clic sur le titre : trie par cette colonne ; un 2e clic : dans l'autre sens.
  // Les chiffres commencent par le plus grand (on cherche qui a beaucoup de jours, ou va en perdre).
  function sortBy(next: SortKey) {
    setSort((old) => (old.key === next ? { key: next, descending: !old.descending } : { key: next, descending: next !== 'employee' }))
  }

  return <div className="flex flex-col gap-4">
    <BalancePanel employeeId={openId} onClose={() => setOpenId(null)} onChanged={() => setVersion((old) => old + 1)} />

    <div>
      <h1 className="text-lg font-semibold text-[#192646]">Leave balances</h1>
      <p className="text-xs text-slate-500">The leave balance of every employee today. Click an employee to see the days year by year, the annual right and the leaves.</p>
    </div>

    {rows && <StatTiles label="Leave balances" tiles={[
      { label: 'Employees', value: String(shown.length), hint: showLeft ? 'Including employees who left' : 'Active and on trial' },
      { label: 'Days available', value: days(shown.reduce((sum, row) => sum + Math.max(row.available, 0), 0)), hint: 'All the shown employees', strong: true },
      { label: 'Days lost on 31/12', value: days(expiringPeople.reduce((sum, row) => sum + expiringOf(row), 0)), hint: `${expiringPeople.length} employee${expiringPeople.length === 1 ? '' : 's'} must take leave before` },
      { label: 'Negative balances', value: String(negative), hint: negative ? 'To check (a holiday changed after approval)' : 'None' },
    ]} />}

    <section className="rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      {/* Les filtres : nom, service, et les "Sorti" (cachés par défaut). */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <label htmlFor="balance-search" className="sr-only">Search an employee</label>
        <input id="balance-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search an employee..."
          className={cn(filterClass, 'w-52')} />
        <label htmlFor="balance-service" className="sr-only">Service</label>
        <select id="balance-service" value={service} onChange={(e) => setService(e.target.value)} className={filterClass}>
          <option value="">All services</option>
          {services.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={showLeft} onChange={(e) => setShowLeft(e.target.checked)} className="size-3.5 accent-[#192646]" />
          Show employees who left
        </label>
        {rows && <p className="ml-auto text-[11px] text-slate-500">{shown.length} of {rows.length} employee{rows.length === 1 ? '' : 's'}</p>}
      </div>

      {rows === null
        ? <p className="px-4 py-10 text-center text-sm text-slate-500">{failedKey === key ? 'Could not load the balances. Please try again later.' : 'Loading...'}</p>
        : shown.length === 0
          ? <p className="px-4 py-10 text-center text-sm text-slate-500"><PiggyBank className="mx-auto mb-2 size-6 text-[#8C6D52]" />
              {rows.length === 0 ? 'No employee in your pôle yet.' : 'No employee matches these filters.'}</p>
          : <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-xs">
                <thead>
                  <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <SortHeader label="Employee" column="employee" sort={sort} onSort={sortBy} />
                    <th className="px-4 py-2">Service</th>
                    <th className="px-4 py-2 text-right" title="Annual right + seniority, today">Right / year</th>
                    <th className="px-4 py-2 text-right" title="All the days earned since the hire date">Earned</th>
                    <th className="px-4 py-2 text-right">Taken</th>
                    <th className="px-4 py-2 text-right" title="Leaves waiting for approval">Pending</th>
                    <th className="px-4 py-2 text-right" title="Days not taken in time (older than 2 years)">Expired</th>
                    <SortHeader label="Available" column="available" sort={sort} onSort={sortBy} right />
                    <SortHeader label="Lost on 31/12" column="expiring" sort={sort} onSort={sortBy} right />
                  </tr>
                </thead>
                <tbody>
                  {/* Toute la ligne s'ouvre au clic ; le bouton du nom fait la même chose au clavier. */}
                  {shown.map((row) => <tr key={row.employee_id} onClick={() => setOpenId(row.employee_id)}
                    className="group cursor-pointer border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <button type="button" onClick={(e) => { e.stopPropagation(); setOpenId(row.employee_id) }}
                        className="inline-flex items-center gap-1 text-left font-semibold text-[#192646] group-hover:underline">
                        {row.employee}<ChevronRight className="size-3 text-slate-300" aria-hidden />
                      </button>
                      {row.status === 'LEFT' && <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">Left</span>}
                      <p className="text-[11px] text-slate-400">Hired {formatDate(row.hire_date)}</p>
                    </td>
                    {/* Admin RH voit les deux pôles : on dit lequel. */}
                    <td className="px-4 py-2.5 text-slate-600">{row.department}{poles.size > 1 && <span className="text-slate-400"> · {row.pole}</span>}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{days(row.yearly_right)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{days(row.acquired)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{days(row.taken)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{row.pending ? days(row.pending) : '—'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-400">{row.expired ? days(row.expired) : '—'}</td>
                    <td className={cn('px-4 py-2.5 text-right text-sm font-semibold tabular-nums', row.available < 0 ? 'text-red-600' : 'text-[#192646]')}>
                      {days(row.available)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {row.expiring && row.expiring.days > 0
                        ? <span title={`Lost on ${formatDate(row.expiring.on)} if not taken`}
                            className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-amber-700">{days(row.expiring.days)}</span>
                        : <span className="text-slate-300">—</span>}
                    </td>
                  </tr>)}
                </tbody>
              </table>
            </div>}
    </section>
  </div>
}

// Un titre de colonne qui trie au clic (aria-sort : le lecteur d'écran dit aussi l'ordre).
function SortHeader({ label, column, sort, onSort, right }: {
  label: string; column: SortKey; sort: Sort; onSort: (key: SortKey) => void; right?: boolean
}) {
  const active = sort.key === column
  const Icon = !active ? ArrowUpDown : sort.descending ? ArrowDown : ArrowUp
  return <th className={cn('px-4 py-2', right && 'text-right')} aria-sort={active ? (sort.descending ? 'descending' : 'ascending') : 'none'}>
    <button type="button" onClick={() => onSort(column)}
      className={cn('inline-flex items-center gap-1 uppercase tracking-wide hover:text-[#23355d]', active && 'text-[#23355d]')}>
      {label}<Icon className={cn('size-3', !active && 'opacity-40')} aria-hidden />
    </button>
  </th>
}
