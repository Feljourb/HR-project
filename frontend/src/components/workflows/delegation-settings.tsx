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

export function DelegationSettings() {
  const [current, setCurrent] = useState<Settings | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    apiFetch('/api/workflows/settings/')
      .then(async (response) => { if (response.ok) setCurrent(await response.json()) })
      .catch(() => setError('Could not load this setting: refresh the page.'))
  }, [])

  async function change(value: boolean) {
    setBusy(true)
    setError('')
    const result = await sendChange<Settings>(() => apiFetch('/api/workflows/settings/',
      { method: 'PATCH', body: JSON.stringify({ delegate_must_accept: value }) }), 'Only Admin RH can change this setting.')
    setBusy(false)
    if ('error' in result) return setError(result.error)
    setCurrent(result.data)
  }

  return <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <h3 className="text-sm font-semibold text-[#192646]">Out of office (delegation)</h3>
    <p className="text-[11px] text-slate-500">A validator who goes away chooses a colleague who answers their requests (leaves, expense claims, documents).</p>
    {current === null
      ? <p className="mt-3 text-xs text-slate-400">{error || 'Loading...'}</p>
      : <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5 hover:bg-slate-50">
          <input type="checkbox" checked={current.delegate_must_accept} disabled={busy} onChange={(e) => change(e.target.checked)}
            className="mt-0.5 size-4 accent-[#23355d]" />
          <span className="text-xs">
            <span className="flex items-center gap-1.5 font-semibold text-[#192646]">
              The delegate must accept {busy && <Loader2 className="size-3 animate-spin" />}
            </span>
            <span className="text-slate-500">
              The colleague receives a request: Accept or Decline (with a reason). Until they accept, nothing reaches them:
              the requests wait for the absent. Unticked = the delegation works at once.
            </span>
          </span>
        </label>}
    {current?.updated_by && <p className="mt-2 text-[11px] text-slate-400">Last change by {current.updated_by} · {formatDateTime(current.updated_at)}</p>}
    {error && current && <p role="alert" className="mt-2 text-[11px] font-medium text-red-600">{error}</p>}
  </section>
}
