'use client'

/*
 * La page "Reimbursements" (RH, Admin RH, IT) : les notes de frais du pôle (Admin RH : les deux pôles).
 * Par défaut "To reimburse" : validées par le N+1, pas encore payées. Le RH reçoit le PDF et les tickets
 * papier, paie, puis clique "Mark reimbursed" (POST /api/expenses/hr/<request>/reimburse/).
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, ReceiptText } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { STATUS_BADGE, claimStatus, formatMad, type ExpenseClaim } from '@/lib/expenses'
import { formatDate } from '@/lib/leaves'
import { cn } from '@/lib/utils'
import { sendChange } from '@/lib/workflows'
import { PdfButton, actionClass } from './claim-actions'

const FILTERS = [
  { id: 'to_reimburse', name: 'To reimburse' },
  { id: 'in_progress', name: 'In approval' },
  { id: 'reimbursed', name: 'Reimbursed' },
  { id: 'all', name: 'All' },
]

export function HrClaims() {
  const [filter, setFilter] = useState('to_reimburse')
  const [loaded, setLoaded] = useState<{ filter: string; claims: ExpenseClaim[] } | null>(null)
  const [failed, setFailed] = useState('')
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    apiFetch(`/api/expenses/hr/?status=${filter}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error()
        setLoaded({ filter, claims: await response.json() })
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(filter) })
    return () => controller.abort()
  }, [filter, version])

  const claims = loaded?.filter === filter ? loaded.claims : null
  const total = (claims ?? []).reduce((sum, claim) => sum + claim.total, 0)

  return <div className="flex flex-col gap-4">
    <div>
      <h1 className="text-lg font-semibold text-[#192646]">Reimbursements</h1>
      <p className="text-xs text-slate-500">Expense claims of your pôle. After the N+1 validation, the employee brings the PDF and the receipts: pay, then mark it reimbursed.</p>
    </div>

    <section className="rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
        {FILTERS.map((option) => (
          <button key={option.id} type="button" onClick={() => setFilter(option.id)} aria-pressed={filter === option.id}
            className={cn('rounded-full px-3 py-1 text-xs font-semibold', filter === option.id ? 'bg-[#23355d] text-white' : 'text-slate-600 hover:bg-slate-100')}>
            {option.name}
          </button>
        ))}
        {claims && <p className="ml-auto text-[11px] text-slate-500">{claims.length} claim{claims.length === 1 ? '' : 's'} · {formatMad(total)}</p>}
      </header>

      {claims === null
        ? <p className="px-4 py-10 text-center text-sm text-slate-500">{failed === filter ? 'Could not load the claims. Please try again later.' : 'Loading...'}</p>
        : claims.length === 0
          ? <p className="px-4 py-10 text-center text-sm text-slate-500"><ReceiptText className="mx-auto mb-2 size-6 text-[#8C6D52]" />No claim here.</p>
          : <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-xs">
                <thead>
                  <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2">Employee</th>
                    <th className="px-4 py-2">Service</th>
                    <th className="px-4 py-2">Purpose</th>
                    <th className="px-4 py-2">Sent</th>
                    <th className="px-4 py-2 text-right">Total</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2 text-right"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {claims.map((claim) => {
                    const status = claimStatus(claim)
                    return <tr key={claim.id} className="border-t border-slate-100">
                      <td className="px-4 py-2.5 font-semibold text-[#192646]">{claim.employee}</td>
                      <td className="px-4 py-2.5 text-slate-600">{claim.department}</td>
                      <td className="px-4 py-2.5 text-slate-700">{claim.title}</td>
                      <td className="px-4 py-2.5 text-slate-600">{formatDate(claim.created_at.slice(0, 10))}</td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-700">{formatMad(claim.total)}</td>
                      <td className="px-4 py-2.5"><span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS_BADGE[status.key])}>{status.label}</span></td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <Link href={`/expenses/${claim.request}?from=reimbursements`} className={actionClass}>View</Link>
                          <PdfButton claim={claim} />
                          {claim.status === 'APPROVED' && !claim.reimbursed_at && <ReimburseButton claim={claim} onDone={() => setVersion((v) => v + 1)} />}
                        </div>
                      </td>
                    </tr>
                  })}
                </tbody>
              </table>
            </div>}
    </section>
  </div>
}

// "Mark reimbursed" en deux clics (on ne revient pas en arrière).
function ReimburseButton({ claim, onDone }: { claim: ExpenseClaim; onDone: () => void }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function reimburse() {
    setBusy(true)
    const result = await sendChange(() => apiFetch(`/api/expenses/hr/${claim.request}/reimburse/`, { method: 'POST' }),
      'Only HR of the pôle can mark a reimbursement.')
    if ('data' in result) onDone()
    else setError(result.error)
    setBusy(false)
    setAsking(false)
  }

  return <>
    {error && <span role="alert" className="text-[11px] text-red-600">{error}</span>}
    {asking
      ? <>
          <button type="button" onClick={() => setAsking(false)} className="rounded-md px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100">No</button>
          <button type="button" disabled={busy} onClick={reimburse}
            className="flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
            {busy && <Loader2 className="size-3 animate-spin" />} Yes, paid
          </button>
        </>
      : <button type="button" onClick={() => setAsking(true)} className="rounded-md bg-[#192646] px-2 py-1 text-[11px] font-semibold text-white hover:bg-[#23355d]">Mark reimbursed</button>}
  </>
}
