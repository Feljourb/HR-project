'use client'

/*
 * UNE note de frais (/expenses/12, 12 = le numéro de sa demande) : qui, les dépenses, les justificatifs,
 * le total, le PDF. Pour tous ceux que la demande concerne (le demandeur, son N+1, les RH du pôle...) :
 * c'est ici que le N+1 regarde les tickets avant de valider. Sinon Django répond 404.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Paperclip } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { STATUS_BADGE, claimStatus, formatMad, getFile, type ExpenseClaim } from '@/lib/expenses'
import { formatDate } from '@/lib/leaves'
import { cn } from '@/lib/utils'
import { Message } from '@/components/leaves/leaves-page'
import { PdfButton, actionClass } from './claim-actions'

export function ClaimDetail({ requestId }: { requestId: number }) {
  const [claim, setClaim] = useState<ExpenseClaim | null>(null)
  const [problem, setProblem] = useState('')
  const [fileError, setFileError] = useState('')

  useEffect(() => {
    apiFetch(`/api/expenses/claims/${requestId}/`)
      .then(async (response) => {
        if (response.status === 404) return setProblem('This expense claim does not exist, or it does not concern you.')
        if (!response.ok) throw new Error()
        setClaim(await response.json())
      })
      .catch(() => setProblem('Could not load the expense claim. Please try again later.'))
  }, [requestId])

  if (!claim) return <Message>{problem || 'Loading...'}</Message>
  const status = claimStatus(claim)

  return <div className="flex flex-col gap-4">
    <Link href="/expenses" className="flex items-center gap-1 text-xs font-semibold text-[#23355d] hover:underline"><ArrowLeft className="size-3.5" /> Expense claims</Link>

    <section className="rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <header className="flex flex-wrap items-start gap-3 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8C6D52]">Expense claim n° {claim.request}</p>
          <h1 className="text-lg font-semibold text-[#192646]">{claim.title}</h1>
          <p className="text-xs text-slate-500">
            {claim.employee} · {claim.department} · {claim.grade ?? 'no grade'} · sent {formatDate(claim.created_at.slice(0, 10))}
            {claim.waiting_for && <> · waiting for {claim.waiting_for}</>}
            {claim.reimbursed_at && <> · reimbursed on {formatDate(claim.reimbursed_at)}{claim.reimbursed_by ? ` by ${claim.reimbursed_by}` : ''}</>}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS_BADGE[status.key])}>{status.label}</span>
          <div className="flex items-center gap-1">
            <PdfButton claim={claim} />
            {/* L'historique du circuit : qui a validé, quand, avec quel commentaire. */}
            <Link href={`/requests/${claim.request}`} className={actionClass}>History</Link>
          </div>
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2">Category</th>
              <th className="px-4 py-2">Detail</th>
              <th className="px-4 py-2">Receipt</th>
              <th className="px-4 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {claim.lines.map((line) => <tr key={line.id} className="border-t border-slate-100">
              <td className="px-4 py-2.5 text-slate-600">{formatDate(line.date, true)}</td>
              <td className="px-4 py-2.5 text-slate-700">{line.category_label}</td>
              <td className="px-4 py-2.5 text-slate-600">{line.description || '—'}</td>
              <td className="px-4 py-2.5">
                {line.has_receipt
                  ? <button type="button" className={cn(actionClass, 'px-0')}
                      onClick={async () => setFileError(await getFile(`/api/expenses/lines/${line.id}/receipt/`, line.receipt_name, false))}>
                      <Paperclip className="size-3.5" /> <span className="max-w-40 truncate">{line.receipt_name || 'Open'}</span>
                    </button>
                  : <span className="text-slate-400">—</span>}
              </td>
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-700">{formatMad(line.amount)}</td>
            </tr>)}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[#192646]/20">
              <td colSpan={4} className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600">Total</td>
              <td className="px-4 py-2.5 text-right text-sm font-semibold tabular-nums text-[#192646]">{formatMad(claim.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {fileError && <p role="alert" className="px-4 pb-3 text-xs font-medium text-red-600">{fileError}</p>}
    </section>
  </div>
}
