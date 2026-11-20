'use client'

/*
 * Page Workflows -> "Out of office (delegation)" (2026-11-19, remarque de la réunion) : Admin RH choisit si le délégué
 * doit ACCEPTER une délégation. Ici et pas dans un module : la délégation sert à toutes les demandes (congés, notes de
 * frais, documents), comme les circuits et le DG de cette page. Enregistré dès le clic (GET / PATCH /api/workflows/settings/).
 */
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { formatDateTime } from '@/components/employees/history-changes'
import { sendChange } from '@/lib/workflows'

type Settings = { delegate_must_accept: boolean; updated_at: string; updated_by: string | null }
type Rule = 'delegate_must_accept'

export function DelegationSettings() {
  const [current, setCurrent] = useState<Settings | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    apiFetch('/api/workflows/settings/')
      .then(async (response) => { if (response.ok) setCurrent(await response.json()) })
      .catch(() => setError('Could not load this setting: refresh the page.'))
  }, [])

  async function change(rule: Rule, value: boolean) {
    setBusy(true)
    setError('')
    const result = await sendChange<Settings>(() => apiFetch('/api/workflows/settings/',
      { method: 'PATCH', body: JSON.stringify({ [rule]: value }) }), 'Only Admin RH can change this setting.')
    setBusy(false)
    if ('error' in result) return setError(result.error)
    setCurrent(result.data)
  }

  return <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <h3 className="text-sm font-semibold text-[#192646]">Validation rules</h3>
    <p className="text-[11px] text-slate-500">Rules for everybody who validates requests (leaves, expense claims, documents). Saved at each click.</p>
    {current === null
      ? <p className="mt-3 text-xs text-slate-400">{error || 'Loading...'}</p>
      : <div className="mt-3 flex flex-col gap-2">
          <Choice checked={current.delegate_must_accept} busy={busy} onChange={(value) => change('delegate_must_accept', value)}
            title="The delegate must accept (Out of office)"
            text="The colleague chosen as delegate receives a request: Accept or Decline (with a reason). Until they accept, nothing reaches them: the requests wait for the absent. Unticked = the delegation works at once." />
          {/* (Les notifications imposées à tous : Settings -> Company notifications, 2026-11-20 : une seule place.) */}
        </div>}
    {current?.updated_by && <p className="mt-2 text-[11px] text-slate-400">Last change by {current.updated_by} · {formatDateTime(current.updated_at)}</p>}
    {error && current && <p role="alert" className="mt-2 text-[11px] font-medium text-red-600">{error}</p>}
  </section>
}

/** Une règle : une case, son nom, et ce qu'elle change en une phrase. */
function Choice({ checked, busy, onChange, title, text }: {
  checked: boolean; busy: boolean; onChange: (value: boolean) => void; title: string; text: string
}) {
  return <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5 hover:bg-slate-50">
    <input type="checkbox" checked={checked} disabled={busy} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 accent-[#23355d]" />
    <span className="text-xs">
      <span className="flex items-center gap-1.5 font-semibold text-[#192646]">{title} {busy && <Loader2 className="size-3 animate-spin" />}</span>
      <span className="text-slate-500">{text}</span>
    </span>
  </label>
}
