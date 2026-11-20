'use client'

/*
 * Settings -> "Company notifications" (B1, 2026-11-20, Admin RH et IT seulement) : la règle de la société.
 * LE MÊME tableau que "Notifications" (une ligne par famille, une colonne par canal), mais pour TOUT LE MONDE :
 * chaque case est "Forced" (toujours active, cadenas dans les Settings de chacun) ou "Each person chooses".
 * Standard : la politique imposée par l'admin (Slack, Microsoft 365). Chaque choix s'enregistre tout de suite
 * (PATCH /api/employees/notifications/policy/).
 */
import { useEffect, useState } from 'react'
import { CheckCircle2, Lock } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import { formatDateTime } from '@/components/employees/history-changes'
import { ROWS, type Field } from './notification-settings'

type Policy = Record<`force_${Field}`, boolean> & { updated_at: string; updated_by: string | null }

export function CompanyNotifications() {
  const [policy, setPolicy] = useState<Policy | null>(null)
  const [failed, setFailed] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    apiFetch('/api/employees/notifications/policy/')
      .then(async (response) => {
        if (!response.ok) throw new Error()
        setPolicy(await response.json())
      })
      .catch(() => setFailed(true))
  }, [])

  async function change(field: Field, forced: boolean) {
    if (!policy) return
    const before = policy
    setPolicy({ ...policy, [`force_${field}`]: forced })
    setMessage(null)
    try {
      const response = await apiFetch('/api/employees/notifications/policy/',
        { method: 'PATCH', body: JSON.stringify({ [`force_${field}`]: forced }) })
      if (!response.ok) throw new Error()
      setPolicy(await response.json())
      setMessage({ ok: true, text: 'Saved for everybody' })
    } catch {
      setPolicy(before)
      setMessage({ ok: false, text: 'Could not save. Please try again.' })
    }
  }

  return <section className="rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <header className="flex flex-wrap items-start gap-3 border-b border-slate-100 px-5 py-4">
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-[#192646]">Company notifications</h2>
        <p className="text-xs text-slate-500">For EVERYBODY: what is imposed, and what each person can switch off in their Settings.</p>
      </div>
      {message && <p role="status" className={cn('flex items-center gap-1 text-xs font-medium', message.ok ? 'text-emerald-700' : 'text-red-600')}>
        {message.ok && <CheckCircle2 className="size-3.5" />}{message.text}
      </p>}
    </header>

    {!policy
      ? <p className="px-5 py-10 text-center text-sm text-slate-500">{failed ? 'Could not load the company rules (Admin RH only).' : 'Loading...'}</p>
      : <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-2.5">Notification</th>
                  <th className="w-44 px-2 py-2.5">In app</th>
                  <th className="w-44 px-5 py-2.5">Email</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => <tr key={row.title} className="border-t border-slate-100">
                  <td className="px-5 py-3.5">
                    <p className="font-semibold text-slate-800">{row.title}</p>
                    <p className="text-xs text-slate-500">{row.text}</p>
                  </td>
                  {[row.app, row.email].map((field, index) => {
                    const forced = policy[`force_${field}`]
                    return <td key={field} className={cn('py-3.5', index === 0 ? 'px-2' : 'px-5')}>
                      <label className="sr-only" htmlFor={`policy-${field}`}>{row.title}, {index === 0 ? 'in app' : 'email'}</label>
                      <select id={`policy-${field}`} value={forced ? 'forced' : 'choice'} onChange={(e) => change(field, e.target.value === 'forced')}
                        className={cn('h-9 w-full rounded-lg border px-2 text-xs font-medium outline-none focus:border-[#23355d]',
                          forced ? 'border-[#23355d]/30 bg-[#E4E9F2]/60 text-[#192646]' : 'border-slate-200 bg-white text-slate-600')}>
                        <option value="forced">🔒 Forced</option>
                        <option value="choice">Each person chooses</option>
                      </select>
                    </td>
                  })}
                </tr>)}
              </tbody>
            </table>
          </div>
          {/* La légende (règle "Don't Make Me Think"). */}
          <div className="flex flex-col gap-1 border-t border-slate-100 bg-slate-50/60 px-5 py-3 text-xs text-slate-500">
            <p className="flex items-start gap-1.5"><Lock className="mt-0.5 size-3 shrink-0" aria-hidden />
              <span><b className="font-semibold text-slate-700">Forced</b> = always on for everybody: the box is locked in their Settings. Recommended for “Requests to approve”, so that no request gets stuck.</span></p>
            <p className="pl-[18px]"><b className="font-semibold text-slate-700">Each person chooses</b> = everybody ticks or unticks it in Settings → Notifications (on by default).</p>
            {policy.updated_by && <p className="pl-[18px] text-[11px] text-slate-400">Last change by {policy.updated_by} · {formatDateTime(policy.updated_at)}</p>}
          </div>
        </>}
  </section>
}
