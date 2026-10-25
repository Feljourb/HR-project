'use client'

/*
 * Choisir le manager (N+1) en tapant son nom : il peut y avoir des centaines de
 * collaborateurs, une liste déroulante serait illisible.
 * La recherche utilise /api/employees/?search=... (donc un RH ne trouve que son pôle).
 */
import { useEffect, useState } from 'react'
import { Search, X } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import type { EmployeeRow, Page } from '@/lib/employees'
import { Field, controlClass } from './form-fields'
import { cn } from '@/lib/utils'

type ManagerPickerProps = {
  value: string                 // l'id du manager choisi, ou ''
  label: string                 // son texte, ex. "U000002 - TEST Manager"
  onChange: (id: string, label: string) => void
  excludeId?: number            // on ne peut pas être son propre manager
  error?: string
}

export function ManagerPicker({ value, label, onChange, excludeId, error }: ManagerPickerProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ query: string; rows: EmployeeRow[] } | null>(null)
  const search = query.trim()

  // Même principe que le tableau : on attend 300 ms sans frappe, et on annule l'ancienne requête.
  useEffect(() => {
    if (search.length < 2) return  // au moins 2 lettres
    const controller = new AbortController()
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ search, page_size: '8' })
      apiFetch(`/api/employees/?${params}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : { results: [] }))
        .then((page: Page<EmployeeRow>) => setResults({ query: search, rows: page.results }))
        .catch(() => {})
    }, 300)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [search])

  const rows = results?.query === search ? results.rows.filter((row) => row.id !== excludeId) : []

  // Un manager est choisi : on l'affiche, avec un bouton pour l'enlever.
  if (value) {
    return <Field id="manager" label="Manager (N+1)" error={error}>
      <div className={cn(controlClass, 'flex items-center justify-between gap-2')}>
        <span className="truncate">{label}</span>
        <button type="button" aria-label="Remove the manager" onClick={() => onChange('', '')} className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"><X className="size-3.5" /></button>
      </div>
    </Field>
  }

  return <Field id="manager" label="Manager (N+1)" error={error} hint="Type at least 2 letters of a name, a CIN or an ID.">
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-[calc(50%+3px)] size-4 -translate-y-1/2 text-slate-400" />
      <input id="manager" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a manager..." autoComplete="off" className={cn(controlClass, 'pl-9')} />
      {rows.length > 0 && <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
        {rows.map((row) => {
          const text = `${row.u_number} - ${row.last_name.toUpperCase()} ${row.first_name}`
          return <li key={row.id}>
            <button type="button" onClick={() => { onChange(String(row.id), text); setQuery('') }} className="w-full px-3 py-2 text-left hover:bg-slate-50">
              <p className="text-xs font-medium text-slate-800">{text}</p>
              <p className="text-[10.5px] text-slate-400">{row.position} · {row.department}</p>
            </button>
          </li>
        })}
      </ul>}
    </div>
  </Field>
}
