'use client'

/*
 * Les réglages des congés (Reference lists -> Leaves -> "Leave settings"), Admin RH seulement (2026-11-10).
 * Les règles de l'entreprise : jours perdus après N ans, maximum par an, ancienneté, congé possible après N mois.
 * Elles changent le solde de TOUS les collaborateurs (il est recalculé) : donc
 * - des limites (Django refuse une faute de frappe : 0 an, 100 jours...) ;
 * - un avertissement à confirmer avant d'enregistrer ;
 * - l'historique : qui a changé quoi, quand (en cas d'erreur, on sait revenir en arrière).
 * Lu et enregistré dans /api/leaves/settings/.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { AlertTriangle, CheckCircle2, History, Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import { controlClass } from '@/components/employees/form-fields'
import { formatDateTime } from '@/components/employees/history-changes'

type Settings = {
  carry_over_years: number; max_days_per_year: number; seniority_years: number; seniority_bonus: number; months_before_first_leave: number
}
type Change = { id: number; changed_by: string | null; changed_at: string; changes: { field: string; label: string; old: string; new: string }[] }

// Les 5 réglages : le texte, l'aide, et les limites (les mêmes que Django).
const FIELDS: { name: keyof Settings; label: string; hint: string; min: number; max: number; step: number; unit: string }[] = [
  { name: 'carry_over_years', label: 'Days can be taken during', hint: 'Days earned in a year are lost after this (2 = until Dec 31 of the next year).', min: 1, max: 5, step: 1, unit: 'years' },
  { name: 'max_days_per_year', label: 'Maximum per year', hint: 'Annual right + seniority can never go above this (the law says 30).', min: 18, max: 60, step: 0.5, unit: 'days' },
  { name: 'seniority_years', label: 'Seniority: every', hint: 'A seniority bonus is added for each full period of this many years.', min: 1, max: 10, step: 1, unit: 'years' },
  { name: 'seniority_bonus', label: 'Seniority: extra days per year', hint: 'Added to the annual right for each full period above.', min: 0, max: 5, step: 0.5, unit: 'days' },
  { name: 'months_before_first_leave', label: 'Annual leave possible after', hint: 'Days are still earned from the hire date.', min: 0, max: 12, step: 1, unit: 'months of service' },
]

export function LeaveSettingsPanel() {
  const [saved, setSaved] = useState<Settings | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [history, setHistory] = useState<Change[]>([])
  const [failed, setFailed] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  function show(data: { settings: Settings; history: Change[] }) {
    setSaved(data.settings)
    setDraft(Object.fromEntries(FIELDS.map(({ name }) => [name, String(data.settings[name])])))
    setHistory(data.history)
  }

  useEffect(() => {
    apiFetch('/api/leaves/settings/')
      .then(async (response) => {
        if (!response.ok) throw new Error()
        show(await response.json())
      })
      .catch(() => setFailed(true))
  }, [])

  const changed = saved !== null && FIELDS.some(({ name }) => Number(draft[name]) !== Number(saved[name]))

  // 1er clic : l'avertissement ; 2e clic ("Yes, save") : l'enregistrement.
  function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setDone(false)
    setConfirming(true)
  }

  async function save() {
    setBusy(true)
    setError('')
    try {
      const body = Object.fromEntries(FIELDS.map(({ name }) => [name, Number(draft[name])]))
      const response = await apiFetch('/api/leaves/settings/', { method: 'PATCH', body: JSON.stringify(body) })
      const data = await response.json().catch(() => ({}))
      if (response.ok) {
        show(data)
        setDone(true)
      } else {
        // 400 : {"max_days_per_year": ["Assurez-vous que cette valeur est inférieure ou égale à 60."]}
        const [name, messages] = Object.entries(data)[0] ?? []
        const label = FIELDS.find((field) => field.name === name)?.label
        setError(`${label ? `${label}: ` : ''}${Array.isArray(messages) ? messages[0] : 'Something went wrong.'}`)
      }
    } catch {
      setError('Cannot reach the server. Please try again later.')
    }
    setConfirming(false)
    setBusy(false)
  }

  return <section className="min-w-0 rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <header className="border-b border-slate-100 px-4 py-3">
      <h2 className="text-sm font-semibold text-[#192646]">Leave settings</h2>
      <p className="text-[11px] text-slate-500">The company rules of the leave balance. Every change is kept in the history below.</p>
    </header>

    {saved === null
      ? <p className="px-4 py-10 text-center text-sm text-slate-500">{failed ? 'Could not load the settings (Admin RH only).' : 'Loading...'}</p>
      : <form onSubmit={ask} className="flex flex-col gap-4 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {FIELDS.map((field) => <div key={field.name}>
              <label htmlFor={`setting-${field.name}`} className="block text-xs font-semibold text-slate-700">{field.label}</label>
              <div className="mt-1.5 flex items-center gap-2">
                <input id={`setting-${field.name}`} type="number" required min={field.min} max={field.max} step={field.step}
                  value={draft[field.name] ?? ''} onChange={(e) => { setDraft((old) => ({ ...old, [field.name]: e.target.value })); setConfirming(false); setDone(false) }}
                  className={cn(controlClass, 'mt-0 w-24')} />
                <span className="text-xs text-slate-500">{field.unit}</span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">{field.hint}</p>
            </div>)}
          </div>

          {/* L'avertissement : ces règles changent le solde de TOUT le monde, tout de suite. */}
          {confirming && <div role="alert" className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
            <p className="flex items-start gap-1.5 font-semibold"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              This changes the leave balance of ALL employees, right now (balances are recalculated).</p>
            <p>Example: lowering &ldquo;Days can be taken during&rdquo; from 2 to 1 year makes everyone lose last year&apos;s days today. Are you sure?</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirming(false)} className="rounded-md px-3 py-1.5 font-semibold text-slate-600 hover:bg-white">Cancel</button>
              <button type="button" disabled={busy} onClick={save}
                className="flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 font-semibold text-white hover:bg-amber-700 disabled:opacity-60">
                {busy && <Loader2 className="size-3.5 animate-spin" />} Yes, save
              </button>
            </div>
          </div>}

          <div className="flex flex-wrap items-center justify-end gap-3">
            {error && <p role="alert" className="mr-auto text-xs font-medium text-red-600">{error}</p>}
            {done && <p role="status" className="mr-auto flex items-center gap-1.5 text-xs font-medium text-emerald-700"><CheckCircle2 className="size-4" /> Saved. Balances use the new rules.</p>}
            {!confirming && <button type="submit" disabled={!changed}
              className="rounded-lg bg-[#23355d] px-4 py-2 text-xs font-semibold text-white hover:bg-[#192646] disabled:cursor-not-allowed disabled:opacity-50">
              Save
            </button>}
          </div>
        </form>}

    {/* L'historique : qui a changé quoi, et quand. */}
    {history.length > 0 && <div className="border-t border-slate-100 px-4 py-3">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[#192646]"><History className="size-3.5" aria-hidden /> History</h3>
      <ul className="flex flex-col gap-2 text-xs">
        {history.map((item) => <li key={item.id} className="rounded-lg bg-slate-50 px-3 py-2">
          <p className="text-[11px] text-slate-500">{formatDateTime(item.changed_at)}{item.changed_by && <> · by <b className="font-semibold text-slate-700">{item.changed_by}</b></>}</p>
          {item.changes.map((change) => <p key={change.field} className="text-slate-700">
            {change.label}: <span className="text-slate-400 line-through">{change.old}</span> → <b className="font-semibold">{change.new}</b>
          </p>)}
        </li>)}
      </ul>
    </div>}
  </section>
}
