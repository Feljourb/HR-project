'use client'

/*
 * "Réglages des congés" : TOUT au même endroit (2026-11-19, l'utilisatrice : "c'est séparé, on oublie" ; même modèle
 * que Réglages des notes de frais et des documents). Avant : 3 entrées dans Reference lists.
 *   ① Leave types : le tableau des types + une légende (ce que veut dire chaque colonne) ;
 *   ② Public holidays : une année à la fois (holidays-panel.tsx, inchangé) ;
 *   ③ Balance rules : 2 ans, max 36, ancienneté, 6 mois (leave-settings-panel.tsx, inchangé).
 * Rien n'est supprimé : on désactive.
 */
import { useEffect, useState } from 'react'
import { CalendarDays, ListChecks, Plus, Scale } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { AddValueDialog, type AddRequest } from '@/components/employees/add-value-dialog'
import { HolidaysPanel } from './holidays-panel'
import { LeaveSettingsPanel } from './leave-settings-panel'
import { SettingsTabs } from './settings-tabs'
import { HOLIDAYS_LIST, LEAVE_TYPES_LIST, type ListValue } from './lists-config'
import { ValueRow } from './value-row'

// 2026-11-19 : la page était trop longue -> 3 onglets (settings-tabs.tsx), une section visible à la fois ; rien ne change dedans.
export function LeaveSettingsAll() {
  return <SettingsTabs title="Réglages des congés" storageKey="leave-settings-tab"
    text="Everything about leaves in one place. Choose a section."
    tabs={[
      { id: 'types', label: 'Leave types', icon: ListChecks, content: <LeaveTypes />,
        hint: 'What employees can ask for (annual, sick, wedding…) and the rules of each type.' },
      { id: 'holidays', label: 'Public holidays', icon: CalendarDays, content: <HolidaysPanel list={HOLIDAYS_LIST} />,
        hint: 'The days off of each year: they count 0 in a leave. Created automatically; correct a religious date here.' },
      { id: 'rules', label: 'Balance rules', icon: Scale, content: <LeaveSettingsPanel />,
        hint: 'How the balance is earned and lost: 2 years to take the days, maximum per year, seniority, first leave after 6 months.' },
    ]} />
}

const byName = (a: ListValue, b: ListValue) => a.name.localeCompare(b.name, 'fr')

// La légende du tableau : chaque colonne en mots simples, avec un exemple (règle "Don't Make Me Think").
const LEGEND = [
  ['Taken from the balance', 'Yes = the days come out of the employee’s balance (annual leave). No = the balance does not change (sick, wedding…).'],
  ['Legal maximum', 'The most days for ONE request (e.g. own wedding = 4 days). — = no maximum.'],
  ['Days in the past allowed', 'How many days back the leave may start when the employee asks (e.g. sick = 2: ill yesterday, asks today). 0 = today or later.'],
  ['Counting', 'Working days: Monday–Friday = 1, Saturday = ½, Sunday and public holidays = 0. Calendar days: every day = 1 (maternity: 98 days = 14 weeks).'],
  ['Document from', 'From how many days a supporting document is asked (1 = always). — = never.'],
]

function LeaveTypes() {
  const list = LEAVE_TYPES_LIST
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
        <h2 className="text-sm font-semibold text-[#192646]">Leave types</h2>
        <p className="text-[11px] text-slate-500">What employees can ask for, and the rules of each type. The legend under the table explains each column.</p>
      </div>
      <button type="button" onClick={openAdd}
        className="flex items-center gap-1.5 rounded-lg bg-[#23355d] px-3 py-2 text-xs font-semibold text-white hover:bg-[#192646]">
        <Plus className="size-3.5" /> Add a type
      </button>
    </header>

    {items === null
      ? <p className="px-4 py-10 text-center text-sm text-slate-500">{failed ? 'Could not load this list: refresh the page.' : 'Loading...'}</p>
      : <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
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
      {LEGEND.map(([term, text]) => <div key={term}>
        <dt className="inline font-semibold text-slate-700">{term}</dt> <dd className="inline">= {text}</dd>
      </div>)}
    </dl>
  </section>
}
