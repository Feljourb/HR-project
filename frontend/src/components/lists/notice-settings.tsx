'use client'

/*
 * Réglages des arrivées et départs -> onglet "Notice period" (2026-11-25, Admin RH + IT) : le PRÉAVIS, une seule place.
 * ① La grille (la loi par défaut, art. 43 + décret 2004 : c'est le minimum ; le contrat ou la convention collective
 *   peuvent donner plus) : 2 groupes x 3 anciennetés, chaque case = une durée + jours / mois.
 * ② Quelles catégories sont des "cadres et assimilés" (les autres = employés et ouvriers).
 * ③ Pour quels types de départ le préavis s'applique (démission et licenciement par défaut).
 * Chaque changement est enregistré tout de suite ; une demande déjà faite garde SA photo du préavis.
 */
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import { controlClass } from '@/components/ui/control-class'
import { errorOf } from '@/lib/journeys'

type Rule = { id: number; group: 'EXECUTIVE' | 'OTHER'; group_label: string; min_years: number; amount: number; unit: 'DAYS' | 'MONTHS' }
type Item = { id: number | string; name: string; is_active?: boolean }
type NoticeSettingsValue = { notice_types: string[]; executive_categories: number[]; updated_by_name: string | null }

// Les 3 anciennetés de la loi : "moins d'1 an", "1 à 5 ans", "plus de 5 ans" (min_years = 0, 1, 5).
const SENIORITY: [number, string][] = [[0, 'Less than 1 year'], [1, '1 to 5 years'], [5, 'More than 5 years']]
const GROUPS: ['EXECUTIVE' | 'OTHER', string][] = [['EXECUTIVE', 'Managers (cadres)'], ['OTHER', 'Employees and workers']]

export function NoticeSettings() {
  const [rules, setRules] = useState<Rule[] | null>(null)
  const [value, setValue] = useState<NoticeSettingsValue | null>(null)
  const [categories, setCategories] = useState<Item[]>([])
  const [types, setTypes] = useState<Item[]>([])
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  useEffect(() => {
    const json = (path: string) => apiFetch(path).then((response) => (response.ok ? response.json() : Promise.reject()))
    Promise.all([json('/api/journeys/notice-rules/'), json('/api/journeys/settings/'), json('/api/employees/lists/categories/'),
      json('/api/journeys/departures/options/')])
      .then(([ruleRows, settings, categoryRows, options]) => {
        setRules(ruleRows)
        setValue(settings)
        setCategories(categoryRows)
        setTypes(options.types)
      })
      .catch(() => setError('Could not load these settings: refresh the page.'))
  }, [])

  async function patch(body: Partial<NoticeSettingsValue>) {
    setError('')
    setSaved('')
    const response = await apiFetch('/api/journeys/settings/', { method: 'PATCH', body: JSON.stringify(body) }).catch(() => null)
    if (response?.ok) { setValue(await response.json()); setSaved('✓ Saved') } else setError(response ? await errorOf(response) : 'The server does not answer. Try again.')
  }

  const toggle = (list: (number | string)[], item: number | string) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item])

  return <div className="flex flex-col gap-4">
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">{error}</p>}

    {/* ① La grille */}
    <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <h2 className="text-sm font-semibold text-[#192646]">① Notice period by seniority</h2>
      <p className="mt-1 text-xs text-slate-500">
        The law (Code du travail art. 43, decree of 2004) is the <span className="font-medium">minimum</span>: the contract or the collective agreement can give more.
        E.g. an employee with 3 years resigns on 25/11 → 1 month → last day at the earliest 25/12.
      </p>
      {rules && <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[480px] text-left text-xs">
          <thead><tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-3 font-semibold">Seniority</th>
            {GROUPS.map(([group, label]) => <th key={group} className="py-2 pr-3 font-semibold">{label}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {SENIORITY.map(([years, label]) => <tr key={years}>
              <td className="py-2 pr-3 font-medium text-slate-700">{label}</td>
              {GROUPS.map(([group]) => {
                const rule = rules.find((row) => row.group === group && row.min_years === years)
                return <td key={group} className="py-2 pr-3">
                  {rule ? <RuleCell rule={rule} onSaved={(next) => { setRules(rules.map((row) => (row.id === next.id ? next : row))); setSaved('✓ Saved') }} />
                    : <span className="text-slate-400">—</span>}
                </td>
              })}
            </tr>)}
          </tbody>
        </table>
      </div>}
    </section>

    {/* ② Les catégories "cadres" */}
    {value && <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <h2 className="text-sm font-semibold text-[#192646]">② Which categories are managers (cadres)?</h2>
      <p className="mt-1 text-xs text-slate-500">The category comes from the employee file. Not ticked = employees and workers.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {categories.filter((item) => item.is_active !== false || value.executive_categories.includes(Number(item.id))).map((item) => {
          const on = value.executive_categories.includes(Number(item.id))
          return <label key={item.id} className={cn('flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium',
            on ? 'border-[#23355d] bg-[#23355d]/5 text-[#192646]' : 'border-slate-200 text-slate-600 hover:border-slate-300')}>
            <input type="checkbox" checked={on} className="size-3.5 accent-[#23355d]"
              onChange={() => void patch({ executive_categories: toggle(value.executive_categories, Number(item.id)) as number[] })} />
            {item.name}
          </label>
        })}
      </div>
    </section>}

    {/* ③ Les types de départ avec préavis */}
    {value && <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <h2 className="text-sm font-semibold text-[#192646]">③ Departures with a notice period</h2>
      <p className="mt-1 text-xs text-slate-500">By default: resignation and dismissal. E.g. the end of a fixed-term contract (CDD) has no notice.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {types.map((item) => {
          const on = value.notice_types.includes(String(item.id))
          return <label key={item.id} className={cn('flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium',
            on ? 'border-[#23355d] bg-[#23355d]/5 text-[#192646]' : 'border-slate-200 text-slate-600 hover:border-slate-300')}>
            <input type="checkbox" checked={on} className="size-3.5 accent-[#23355d]"
              onChange={() => void patch({ notice_types: toggle(value.notice_types, String(item.id)) as string[] })} />
            {item.name}
          </label>
        })}
      </div>
    </section>}

    <div className="flex flex-col gap-1 text-[11px] text-slate-500">
      {saved && <p role="status" className="font-medium text-emerald-700">{saved}</p>}
      {value?.updated_by_name && <p>Last change by {value.updated_by_name}.</p>}
      <p><span className="font-semibold text-slate-600">Good to know:</span> a request keeps the notice computed when it was sent (a change here applies to the next ones). The app never blocks a departure: it warns, and HR decide (respected / waived / not respected). These values must be checked by HR or a lawyer.</p>
    </div>
  </div>
}

/** Une case de la grille : la durée + jours / mois, enregistrée avec "Save" quand elle change. */
function RuleCell({ rule, onSaved }: { rule: Rule; onSaved: (rule: Rule) => void }) {
  const [amount, setAmount] = useState(String(rule.amount))
  const [unit, setUnit] = useState(rule.unit)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const changed = amount !== String(rule.amount) || unit !== rule.unit

  async function save() {
    setBusy(true)
    setError('')
    const response = await apiFetch(`/api/journeys/notice-rules/${rule.id}/`, {
      method: 'PATCH', body: JSON.stringify({ amount: Number(amount), unit }),
    }).catch(() => null)
    setBusy(false)
    if (response?.ok) onSaved(await response.json())
    else setError(response ? await errorOf(response) : 'No answer.')
  }

  return <div className="flex flex-wrap items-center gap-1.5">
    <input type="number" min={1} max={365} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Duration"
      className={cn(controlClass, 'mt-0 h-8 w-16 px-2')} />
    <select value={unit} onChange={(e) => setUnit(e.target.value as Rule['unit'])} aria-label="Unit" className={cn(controlClass, 'mt-0 h-8 w-24 px-2')}>
      <option value="DAYS">days</option>
      <option value="MONTHS">months</option>
    </select>
    {changed && <button type="button" onClick={() => void save()} disabled={busy || !Number(amount)}
      className="flex h-8 items-center gap-1 rounded-md bg-[#23355d] px-2.5 text-[11px] font-semibold text-white hover:bg-[#192646] disabled:opacity-50">
      {busy && <Loader2 className="size-3 animate-spin" />} Save
    </button>}
    {error && <span role="alert" className="w-full text-[11px] text-red-600">{error}</span>}
  </div>
}
