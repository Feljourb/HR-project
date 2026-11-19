'use client'

/*
 * Une liste de référence DANS une page de réglages (2026-11-19) : le tableau des valeurs (Edit, Deactivate), "Add",
 * et une LÉGENDE sous le tableau (règle "Don't Make Me Think" : ce que veut dire chaque colonne).
 * Un seul composant pour "Leave types" (Réglages des congés) et "Document types" (Réglages des documents).
 * Rien n'est supprimé : on désactive.
 */
import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { AddValueDialog, type AddRequest } from '@/components/employees/add-value-dialog'
import type { ListConfig, ListValue } from './lists-config'
import { ValueRow } from './value-row'

const byName = (a: ListValue, b: ListValue) => a.name.localeCompare(b.name, 'fr')

export function ListCard({ list, title, text, addLabel, legend }: {
  list: ListConfig; title: string; text: string; addLabel: string; legend: [string, string][]
}) {
  const [items, setItems] = useState<ListValue[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [adding, setAdding] = useState<AddRequest | null>(null)

  useEffect(() => {
    apiFetch(`${list.api}/${list.name}/?all=1`)
      .then(async (response) => {
        if (!response.ok) throw new Error()
        setItems(((await response.json()) as ListValue[]).sort(byName))
      })
      .catch(() => setFailed(true))
  }, [list])

  function openAdd() {
    setAdding({ list: list.name, api: list.api, extra: list.extra, title: list.singular,
      onCreated: (item) => setItems((old) => [...(old ?? []), item].sort(byName)) })
  }

  return <section className="min-w-0 rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <AddValueDialog request={adding} onClose={() => setAdding(null)} />
    <header className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-[#192646]">{title}</h2>
        <p className="text-[11px] text-slate-500">{text}</p>
      </div>
      <button type="button" onClick={openAdd}
        className="flex items-center gap-1.5 rounded-lg bg-[#23355d] px-3 py-2 text-xs font-semibold text-white hover:bg-[#192646]">
        <Plus className="size-3.5" /> {addLabel}
      </button>
    </header>

    {items === null
      ? <p className="px-4 py-10 text-center text-sm text-slate-500">{failed ? 'Could not load this list: refresh the page.' : 'Loading...'}</p>
      : <div className="overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2">Name</th>
                {list.extra?.map((field) => <th key={field.name} className="px-4 py-2">{field.label}</th>)}
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => <ValueRow key={item.id} list={list.name} api={list.api} item={item} extra={list.extra}
                onChanged={(changed) => setItems((old) => (old ?? []).map((value) => (value.id === changed.id ? changed : value)).sort(byName))} />)}
            </tbody>
          </table>
        </div>}

    {/* La légende : ce que veut dire chaque colonne. */}
    <dl className="grid gap-1.5 border-t border-slate-100 px-4 py-3 text-[11px] text-slate-500">
      {legend.map(([term, meaning]) => <div key={term}>
        <dt className="inline font-semibold text-slate-700">{term}</dt> <dd className="inline">= {meaning}</dd>
      </div>)}
    </dl>
  </section>
}
