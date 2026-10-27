'use client'

/*
 * Le tableau des collaborateurs (pour les RH) : recherche, filtres, pages de 25.
 *
 * Le filtrage se fait côté Django (pas ici) : on envoie ?search=...&status=...&entity=...&page=...
 * à /api/employees/ et on affiche ce qu'il renvoie. Un RH ne reçoit que son pôle :
 * c'est le backend qui décide, le frontend ne fait qu'afficher.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Plus, RotateCw, Search, UsersRound } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Panel, PanelHeader } from '@/components/dashboard/panel'
import { apiFetch } from '@/lib/api'
import { PAGE_SIZE, STATUS_LABELS, type EmployeeRow, type ReferenceItem, type Status } from '@/lib/employees'
import { usePaged } from '@/lib/use-paged'
import { cn } from '@/lib/utils'

const headCell = 'h-9 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400'
const selectClass = 'h-9 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs text-slate-700 focus-visible:border-[#23355d] focus-visible:outline-none'

// Couleur du badge de chaque statut.
const STATUS_TONES: Record<Status, string> = {
  ACTIVE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  TRIAL: 'border-amber-200 bg-amber-50 text-amber-700',
  LEFT: 'border-slate-200 bg-slate-100 text-slate-500',
}

export function EmployeeTable() {
  const router = useRouter()
  // Ce que le RH tape dans la recherche, et ce qu'on envoie vraiment à l'API
  // (300 ms après la dernière touche : pas une requête par lettre).
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [entity, setEntity] = useState('')
  const [page, setPage] = useState(1)
  const [entities, setEntities] = useState<ReferenceItem[]>([])

  // Les paramètres de la requête, ex. "page=2&search=alami&status=ACTIVE".
  const params = new URLSearchParams({ page: String(page) })
  if (search) params.set('search', search)
  if (status) params.set('status', status)
  if (entity) params.set('entity', entity)

  // Charge la page de résultats à chaque changement de paramètres (voir lib/use-paged.ts).
  const { data, loading, failed, retry } = usePaged<EmployeeRow>('/api/employees/', params)

  // Recherche "debounce" : on attend 300 ms sans frappe avant de chercher.
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = query.trim()
      if (next !== search) {
        setSearch(next)
        setPage(1)  // une nouvelle recherche repart de la page 1
      }
    }, 300)
    return () => clearTimeout(timer)  // une nouvelle touche annule l'attente précédente
  }, [query, search])

  // La liste des entités pour le filtre (un RH ne reçoit que celles de son pôle).
  useEffect(() => {
    apiFetch('/api/employees/lists/entities/')
      .then((response) => (response.ok ? response.json() : []))
      .then(setEntities)
      .catch(() => setEntities([]))
  }, [])

  // Page quittée (Next.js la garde cachée) : on oublie aussi la liste des entités.
  useEffect(() => () => setEntities([]), [])

  // Un filtre change : on revient à la page 1.
  function changeFilter(setter: (value: string) => void, value: string) {
    setter(value)
    setPage(1)
  }

  const pageCount = data ? Math.max(1, Math.ceil(data.count / PAGE_SIZE)) : 1
  const first = data && data.count > 0 ? (page - 1) * PAGE_SIZE + 1 : 0
  const last = data ? Math.min(page * PAGE_SIZE, data.count) : 0

  return <Panel>
    <PanelHeader icon={UsersRound} title="Employees" meta={data ? `${data.count} employee${data.count === 1 ? '' : 's'}` : 'Loading...'}>
      {/* Barre de filtres : recherche, statut, entité. */}
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <label htmlFor="employee-search" className="sr-only">Search employees</label>
          <Input id="employee-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, CIN or ID (U000001)..." className="h-9 border-slate-200 bg-slate-50 pl-10 text-xs shadow-none" />
        </div>
        <label htmlFor="employee-status" className="sr-only">Status</label>
        <select id="employee-status" value={status} onChange={(e) => changeFilter(setStatus, e.target.value)} className={selectClass}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <label htmlFor="employee-entity" className="sr-only">Entity</label>
        <select id="employee-entity" value={entity} onChange={(e) => changeFilter(setEntity, e.target.value)} className={selectClass}>
          <option value="">All entities</option>
          {entities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <Link href="/employees/new" className="flex h-9 items-center gap-1.5 rounded-lg bg-[#23355d] px-3 text-xs font-semibold text-white hover:bg-[#192646]"><Plus className="size-4" /> New employee</Link>
      </div>
    </PanelHeader>

    {/* 3 cas : erreur (sans données), premier chargement, ou le tableau. */}
    {!data && failed ? (
      <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
        <p className="text-sm text-slate-600">Could not load employees. Please try again.</p>
        <Button variant="outline" size="sm" onClick={retry}><RotateCw /> Try again</Button>
      </div>
    ) : !data ? (
      <p className="px-4 py-12 text-center text-sm text-slate-500">Loading...</p>
    ) : (
      // Pendant un nouveau chargement, on garde les anciennes lignes, un peu pâles.
      <div aria-busy={loading} className={cn('transition-opacity', loading && 'opacity-60')}>
        <Table>
          <TableHeader>
            <TableRow className="border-slate-100 bg-slate-50/80 hover:bg-slate-50/80">
              <TableHead className={cn(headCell, 'pl-4')}>Employee</TableHead>
              <TableHead className={headCell}>Position</TableHead>
              <TableHead className={headCell}>Department</TableHead>
              <TableHead className={headCell}>Entity</TableHead>
              <TableHead className={headCell}>Contract</TableHead>
              <TableHead className={cn(headCell, 'pr-4')}>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* Clic sur une ligne -> le dossier. Le nom est aussi un vrai lien (clavier, Ctrl+clic). */}
            {data.results.map((row) => <TableRow key={row.id} onClick={() => router.push(`/employees/${row.id}`)} className="cursor-pointer border-slate-100 hover:bg-slate-50/80">
              <TableCell className="py-2.5 pl-4">
                <Link href={`/employees/${row.id}`} onClick={(e) => e.stopPropagation()} className="text-[13px] font-medium text-slate-800 hover:text-[#23355d] hover:underline">{row.first_name} {row.last_name.toUpperCase()}</Link>
                <p className="font-mono text-[10.5px] text-slate-400">{row.u_number}</p>
              </TableCell>
              <TableCell className="py-2.5 text-xs text-slate-600">{row.position}</TableCell>
              <TableCell className="py-2.5">
                <p className="text-xs text-slate-700">{row.department}</p>
                <p className="text-[10.5px] text-slate-400">{row.direction}</p>
              </TableCell>
              <TableCell className="py-2.5 text-xs text-slate-600">{row.entity}</TableCell>
              <TableCell className="py-2.5 text-xs text-slate-600">{row.contract_type}</TableCell>
              <TableCell className="py-2.5 pr-4">
                <Badge variant="outline" className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', STATUS_TONES[row.status])}>
                  <span className="size-1.5 rounded-full bg-current" />{row.status_label}
                </Badge>
              </TableCell>
            </TableRow>)}
          </TableBody>
        </Table>

        {data.results.length === 0 && <p className="px-4 py-10 text-center text-sm text-slate-500">No employee matches these filters.</p>}

        {/* Pagination : "1–25 of 63" et les flèches précédent / suivant. */}
        <footer className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-500">
          <span className="tabular-nums">{first}–{last} of {data.count}</span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={!data.previous || loading} onClick={() => setPage(page - 1)}><ChevronLeft /></Button>
            <span className="tabular-nums">Page {page} / {pageCount}</span>
            <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={!data.next || loading} onClick={() => setPage(page + 1)}><ChevronRight /></Button>
          </div>
        </footer>
      </div>
    )}
  </Panel>
}
