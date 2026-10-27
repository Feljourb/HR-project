'use client'

/*
 * La page "Audit log" : le journal de TOUS les dossiers (qui a changé quoi, quand).
 * Filtres : collaborateur, qui a agi, action, dates. Lu dans /api/employees/history/.
 * Admin RH et IT voient les deux pôles ; un RH seulement son pôle (filtre fait par Django).
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, RotateCw, ScrollText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Panel, PanelHeader } from '@/components/dashboard/panel'
import { FormSection, SelectField, TextField } from '@/components/employees/form-fields'
import { HistoryChanges, formatDateTime } from '@/components/employees/history-changes'
import { PAGE_SIZE, type AuditEntry } from '@/lib/employees'
import { usePaged } from '@/lib/use-paged'
import { cn } from '@/lib/utils'

// Les actions (comme EmployeeHistory.Action côté Django).
const ACTION_OPTIONS = [
  { id: 'CREATED', name: 'Création' },
  { id: 'UPDATED', name: 'Modification' },
  { id: 'ROLE', name: 'Changement de rôle' },
  { id: 'PASSWORD_RESET', name: 'Réinitialisation du mot de passe' },
]

export function AuditLog() {
  // Les deux textes : ce qu'on tape, et ce qu'on envoie à l'API 300 ms après la dernière touche.
  const [typed, setTyped] = useState({ search: '', actor: '' })
  const [applied, setApplied] = useState(typed)
  const [action, setAction] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = { search: typed.search.trim(), actor: typed.actor.trim() }
      if (next.search !== applied.search || next.actor !== applied.actor) {
        setApplied(next)
        setPage(1)  // un nouveau filtre repart de la page 1
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [typed, applied])

  // Change un filtre de liste ou de date (tout de suite, et retour à la page 1).
  function filter(set: (value: string) => void) {
    return (value: string) => {
      set(value)
      setPage(1)
    }
  }

  const params = new URLSearchParams({ page: String(page) })
  if (applied.search) params.set('search', applied.search)
  if (applied.actor) params.set('actor', applied.actor)
  if (action) params.set('action', action)
  if (dateFrom) params.set('date_from', dateFrom)
  if (dateTo) params.set('date_to', dateTo)
  const { data, loading, failed, retry } = usePaged<AuditEntry>('/api/employees/history/', params)

  const pageCount = data ? Math.max(1, Math.ceil(data.count / PAGE_SIZE)) : 1

  return <div className="flex flex-col gap-4">
    <FormSection title="Filters">
      <TextField id="audit-search" label="Employee" value={typed.search} placeholder="Name or ID (U000007)"
        onChange={(search) => setTyped((value) => ({ ...value, search }))} />
      <TextField id="audit-actor" label="Done by" value={typed.actor} placeholder="Username, e.g. rh.alami"
        onChange={(actor) => setTyped((value) => ({ ...value, actor }))} />
      <SelectField id="audit-action" label="Action" value={action} onChange={filter(setAction)} options={ACTION_OPTIONS} placeholder="All actions" />
      <TextField id="audit-from" label="From" type="date" value={dateFrom} onChange={filter(setDateFrom)} />
      <TextField id="audit-to" label="To" type="date" value={dateTo} onChange={filter(setDateTo)} />
    </FormSection>

    <Panel>
      <PanelHeader icon={ScrollText} title="Audit log" meta={data ? `${data.count} change${data.count === 1 ? '' : 's'}` : 'Loading...'} />

      {!data && failed ? (
        <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
          <p className="text-sm text-slate-600">Could not load the audit log. Please try again.</p>
          <Button variant="outline" size="sm" onClick={retry}><RotateCw /> Try again</Button>
        </div>
      ) : !data ? (
        <p className="px-4 py-12 text-center text-sm text-slate-500">Loading...</p>
      ) : (
        <div aria-busy={loading} className={cn('transition-opacity', loading && 'opacity-60')}>
          {data.results.length === 0
            ? <p className="px-4 py-10 text-center text-sm text-slate-500">No change matches these filters.</p>
            : <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left">
                  <thead>
                    <tr className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-2">Date</th>
                      <th className="px-4 py-2">Employee</th>
                      <th className="px-4 py-2">Action</th>
                      <th className="px-4 py-2">Done by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.results.map((entry) => <tr key={entry.id} className="border-t border-slate-100 align-top">
                      <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-slate-500">
                        <time dateTime={entry.created_at}>{formatDateTime(entry.created_at)}</time>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <Link href={`/employees/${entry.employee}`} className="font-medium text-[#23355d] hover:underline">{entry.employee_label}</Link>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className="font-semibold text-[#0F172A]">{entry.action_label}</span>
                        <HistoryChanges changes={entry.changes} />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{entry.actor_name}</td>
                    </tr>)}
                  </tbody>
                </table>
              </div>}

          <footer className="flex items-center justify-end gap-1 border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-500">
            <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={!data.previous || loading} onClick={() => setPage(page - 1)}><ChevronLeft /></Button>
            <span className="tabular-nums">Page {page} / {pageCount}</span>
            <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={!data.next || loading} onClick={() => setPage(page + 1)}><ChevronRight /></Button>
          </footer>
        </div>
      )}
    </Panel>
  </div>
}
