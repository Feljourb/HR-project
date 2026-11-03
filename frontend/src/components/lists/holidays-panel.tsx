'use client'

/*
 * Les jours fériés dans la page "Reference lists" (Admin RH), décision du 2026-11-03 avec l'encadrant :
 * - une année à la fois (‹ 2026 ›) : chaque année garde SES dates (l'Aïd 2026 et l'Aïd 2027 sont deux lignes),
 *   rien n'est jamais remplacé ni effacé ;
 * - deux onglets : "Fixed" (même date chaque année) et "Variable" (fêtes religieuses estimées + jours ajoutés à la main) ;
 * - une année passée est en lecture seule : c'est l'historique des congés comptés avec (Django refuse aussi).
 */
import { useEffect, useState, type KeyboardEvent } from 'react'
import { ChevronLeft, ChevronRight, Lock, Plus } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import { AddValueDialog, type AddRequest } from '@/components/employees/add-value-dialog'
import type { ListConfig, ListValue } from './lists-config'
import { ValueRow } from './value-row'

type Tab = 'fixed' | 'variable'
const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'fixed', label: 'Fixed', hint: 'Same date every year (Green March, Throne Day...). Created automatically: nothing to do.' },
  { id: 'variable', label: 'Variable', hint: 'Religious holidays, from the Hijri calendar: the date is estimated. Correct it when the Ministry announces the day, then untick "Estimated". Exceptional days added by hand are here too.' },
]

// "2026-11-06" se trie comme du texte.
const byDate = (a: ListValue, b: ListValue) => (a.date ?? '').localeCompare(b.date ?? '')

export function HolidaysPanel({ list }: { list: ListConfig }) {
  const base = `${list.api}/${list.name}`
  const [years, setYears] = useState<{ years: number[]; current: number } | null>(null)
  const [chosenYear, setChosenYear] = useState<number | null>(null)
  const [tab, setTab] = useState<Tab>('fixed')
  const [loaded, setLoaded] = useState<{ year: number; items: ListValue[] } | null>(null)
  const [failed, setFailed] = useState<string | null>(null)  // ce qui n'a pas pu se charger
  const [addRequest, setAddRequest] = useState<AddRequest | null>(null)

  // Les années à choisir (celles qui ont des jours fériés), et l'année en cours.
  useEffect(() => {
    apiFetch(`${base}/years/`)
      .then(async (response) => {
        if (!response.ok) throw new Error()
        setYears(await response.json())
      })
      .catch(() => setFailed('years'))
  }, [base])

  // Par défaut : cette année (en 2027, la page s'ouvre sur 2027 toute seule).
  const year = chosenYear ?? years?.current ?? null

  useEffect(() => {
    if (year === null) return
    const controller = new AbortController()
    apiFetch(`${base}/?all=1&year=${year}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error()
        const items: ListValue[] = await response.json()
        setLoaded({ year, items: items.sort(byDate) })
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(`year-${year}`) })
    return () => controller.abort()
  }, [base, year])

  const items = year !== null && loaded?.year === year ? loaded.items : null
  const past = years !== null && year !== null && year < years.current
  const index = years && year !== null ? years.years.indexOf(year) : -1
  const previous = years && index > 0 ? years.years[index - 1] : null
  const next = years && index >= 0 && index < years.years.length - 1 ? years.years[index + 1] : null

  const ofTab = (id: Tab) => (items ?? []).filter((item) => Boolean(item.fixed) === (id === 'fixed'))
  const shown = ofTab(tab)
  const toConfirm = ofTab('variable').filter((item) => item.estimated && item.is_active).length
  // L'onglet "Fixed" n'a pas de colonne "Estimated" : une fête fixe n'est jamais estimée.
  const extra = tab === 'fixed' ? list.extra?.filter((field) => field.name === 'date') : list.extra

  // Garde la liste à jour sans la recharger (un jour déplacé dans une autre année quitte la page).
  function keep(change: (items: ListValue[]) => ListValue[]) {
    setLoaded((value) => value && {
      ...value, items: change(value.items).filter((item) => item.date?.startsWith(String(value.year))).sort(byDate),
    })
  }

  function openAdd() {
    setAddRequest({
      list: list.name, api: list.api, extra: list.extra, title: list.singular,
      onCreated: (item) => keep((old) => [...old, item as ListValue]),
    })
  }

  // Les flèches du clavier passent d'un onglet à l'autre (comme des onglets natifs).
  function onTabKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    const other = tab === 'fixed' ? 'variable' : 'fixed'
    setTab(other)
    document.getElementById(`holiday-tab-${other}`)?.focus()
  }

  return <section className="min-w-0 rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <AddValueDialog request={addRequest} onClose={() => setAddRequest(null)} />

    <header className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-[#192646]">Jours fériés</h2>
        <p className="text-[11px] text-slate-500">Created automatically every year. Each year keeps its own dates: nothing is replaced or deleted.</p>
      </div>

      {/* L'année affichée : ‹ 2026 ›, et où elle se situe (passée, en cours, à venir). */}
      {year !== null && <div className="flex items-center gap-2">
        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
          past ? 'bg-slate-100 text-slate-600' : year === years?.current ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700')}>
          {past && <Lock className="size-3" />}
          {past ? 'Past · read only' : year === years?.current ? 'This year' : 'Upcoming'}
        </span>
        <div className="flex items-center rounded-lg border border-slate-200 p-0.5">
          <button type="button" aria-label="Previous year" disabled={previous === null} onClick={() => previous !== null && setChosenYear(previous)}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-[#23355d] disabled:opacity-30 disabled:hover:bg-transparent">
            <ChevronLeft className="size-4" />
          </button>
          <span aria-live="polite" className="min-w-12 text-center text-sm font-semibold tabular-nums text-[#192646]">{year}</span>
          <button type="button" aria-label="Next year" disabled={next === null} onClick={() => next !== null && setChosenYear(next)}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-[#23355d] disabled:opacity-30 disabled:hover:bg-transparent">
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>}
    </header>

    {/* Les deux onglets, avec le nombre de jours de chacun. */}
    <div role="tablist" aria-label="Kind of holiday" onKeyDown={onTabKey} className="flex gap-1 border-b border-slate-100 px-4">
      {TABS.map(({ id, label }) => {
        const selected = tab === id
        return <button key={id} id={`holiday-tab-${id}`} type="button" role="tab" aria-selected={selected} aria-controls="holiday-panel"
          tabIndex={selected ? 0 : -1} onClick={() => setTab(id)}
          className={cn('-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-semibold transition-colors',
            selected ? 'border-[#23355d] text-[#192646]' : 'border-transparent text-slate-500 hover:text-[#23355d]')}>
          {label}
          <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] tabular-nums', selected ? 'bg-[#23355d] text-white' : 'bg-slate-100 text-slate-600')}>
            {items ? ofTab(id).length : '–'}
          </span>
          {/* Des dates religieuses encore à confirmer : un point ambre sur l'onglet. */}
          {id === 'variable' && toConfirm > 0 && !past && <span className="size-1.5 rounded-full bg-amber-500" aria-label={`${toConfirm} to confirm`} />}
        </button>
      })}
    </div>

    <div id="holiday-panel" role="tabpanel" aria-labelledby={`holiday-tab-${tab}`}>
      {past && <p className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-600">
        <Lock className="size-3.5 shrink-0 text-slate-400" />
        {year} is over: its holidays stay as they are, as the history of the leaves counted with them.
      </p>}

      <div className="flex flex-wrap items-start gap-3 px-4 py-3">
        <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-slate-500">
          {TABS.find((t) => t.id === tab)?.hint}
          {tab === 'variable' && toConfirm > 0 && !past && <span className="ml-1.5 rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700">{toConfirm} to confirm</span>}
        </p>
        {/* Ajouter : seulement un jour exceptionnel (onglet Variable), et jamais dans une année passée. */}
        {tab === 'variable' && !past && <button type="button" onClick={openAdd}
          className="flex items-center gap-1.5 rounded-lg bg-[#23355d] px-3 py-2 text-xs font-semibold text-white hover:bg-[#192646]">
          <Plus className="size-3.5" /> Add a holiday
        </button>}
      </div>

      {failed === 'years' || (year !== null && failed === `year-${year}` && items === null)
        ? <p className="px-4 py-10 text-center text-sm text-slate-500">Could not load the holidays. Please try again later.</p>
        : items === null
          ? <p className="px-4 py-10 text-center text-sm text-slate-500">Loading...</p>
          : shown.length === 0
            ? <p className="px-4 py-10 text-center text-sm text-slate-500">No {tab} holiday in {year}.</p>
            : <div className="overflow-x-auto">
                <table className="w-full min-w-[520px]">
                  <thead>
                    <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-2">Name</th>
                      {extra?.map((field) => <th key={field.name} className="px-4 py-2">{field.label}</th>)}
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2 text-right"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((item) => <ValueRow key={`${year}-${tab}-${item.id}`} list={list.name} api={list.api} item={item}
                      extra={extra} readOnly={past}
                      onChanged={(changed) => keep((old) => old.map((value) => (value.id === changed.id ? changed : value)))} />)}
                  </tbody>
                </table>
              </div>}
    </div>
  </section>
}
