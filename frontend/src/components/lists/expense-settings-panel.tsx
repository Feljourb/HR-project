'use client'

/*
 * Les réglages des notes de frais (Reference lists -> Expenses -> "Réglages des notes de frais"), Admin RH (2026-11-16,
 * remarque de la réunion) : QUI peut diminuer le montant d'une dépense pendant la validation (le N+1 et les RH,
 * seulement les RH, ou personne). Lu et enregistré dans /api/expenses/settings/.
 */
import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import { formatDateTime } from '@/components/employees/history-changes'

type Settings = { who_can_correct: string; updated_at: string; updated_by: string | null }

const CHOICES = [
  { id: 'MANAGER_AND_HR', title: 'The N+1 and HR', text: 'The manager can correct while validating, and HR again during their control.' },
  { id: 'HR_ONLY', title: 'HR only', text: 'The N+1 approves or rejects; only HR correct an amount.' },
  { id: 'NOBODY', title: 'Nobody', text: 'Validators approve or reject the whole claim; amounts never change.' },
]

export function ExpenseSettingsPanel() {
  const [saved, setSaved] = useState<Settings | null>(null)
  const [choice, setChoice] = useState('')
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    apiFetch('/api/expenses/settings/')
      .then(async (response) => {
        if (!response.ok) throw new Error()
        const data: Settings = await response.json()
        setSaved(data)
        setChoice(data.who_can_correct)
      })
      .catch(() => setFailed(true))
  }, [])

  async function save() {
    setBusy(true)
    setError('')
    setDone(false)
    try {
      const response = await apiFetch('/api/expenses/settings/', { method: 'PATCH', body: JSON.stringify({ who_can_correct: choice }) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.detail ?? 'Could not save.')
      setSaved(data)
      setDone(true)
    } catch (problem) {
      setError(problem instanceof Error && problem.message !== 'Failed to fetch' ? problem.message : 'Cannot reach the server. Please try again later.')
    }
    setBusy(false)
  }

  return <section className="min-w-0 rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <header className="border-b border-slate-100 px-4 py-3">
      <h2 className="text-sm font-semibold text-[#192646]">Expense settings</h2>
      <p className="text-[11px] text-slate-500">
        Who may LOWER the amount of an expense while validating (e.g. the receipt says 150, the line says 200).
        Never higher; a reason is required; the employee is notified and the original amount stays visible.
      </p>
    </header>

    {saved === null
      ? <p className="px-4 py-10 text-center text-sm text-slate-500">{failed ? 'Could not load the settings (Admin RH only).' : 'Loading...'}</p>
      : <div className="flex flex-col gap-4 p-4">
          <fieldset>
            <legend className="text-xs font-semibold text-slate-700">Who can correct an amount</legend>
            <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
              {CHOICES.map((option) => {
                const selected = choice === option.id
                return <label key={option.id} className={cn('flex cursor-pointer gap-2 rounded-lg border px-2.5 py-2 transition-colors',
                  selected ? 'border-[#23355d] bg-[#E4E9F2]/50 ring-1 ring-[#23355d]' : 'border-slate-200 hover:border-slate-300')}>
                  <input type="radio" name="who-can-correct" value={option.id} checked={selected}
                    onChange={() => { setChoice(option.id); setDone(false) }} className="mt-0.5 accent-[#192646]" />
                  <span>
                    <span className="block text-xs font-semibold text-[#192646]">{option.title}</span>
                    <span className="block text-[11px] leading-snug text-slate-500">{option.text}</span>
                  </span>
                </label>
              })}
            </div>
          </fieldset>
          <p className="text-[11px] text-slate-500">
            The HR control step is set on the Workflows page (circuit &ldquo;Note de frais&rdquo;: HR &ldquo;Validate&rdquo;).
          </p>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {error && <p role="alert" className="mr-auto text-xs font-medium text-red-600">{error}</p>}
            {done && <p role="status" className="mr-auto flex items-center gap-1.5 text-xs font-medium text-emerald-700"><CheckCircle2 className="size-4" /> Saved.</p>}
            {!done && saved.updated_by && <p className="mr-auto text-[11px] text-slate-400">Last change {formatDateTime(saved.updated_at)} by {saved.updated_by}</p>}
            <button type="button" onClick={save} disabled={busy || choice === saved.who_can_correct}
              className="flex items-center gap-1.5 rounded-lg bg-[#23355d] px-4 py-2 text-xs font-semibold text-white hover:bg-[#192646] disabled:cursor-not-allowed disabled:opacity-50">
              {busy && <Loader2 className="size-3.5 animate-spin" />} Save
            </button>
          </div>
        </div>}
  </section>
}
