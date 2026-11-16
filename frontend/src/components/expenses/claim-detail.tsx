'use client'

/*
 * UNE note de frais (/expenses/12, 12 = le numéro de sa demande) : qui, les dépenses, les justificatifs,
 * le total, le PDF. Pour tous ceux que la demande concerne (le demandeur, son N+1, les RH du pôle...) :
 * c'est ici que le N+1 regarde les tickets avant de valider. Sinon Django répond 404.
 */
import { Fragment, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, Paperclip } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { backLink } from '@/lib/back-links'
import { STATUS_BADGE, claimStatus, formatMad, getFile, type ExpenseClaim, type ExpenseLine } from '@/lib/expenses'
import { formatDate } from '@/lib/leaves'
import { cn } from '@/lib/utils'
import { sendChange } from '@/lib/workflows'
import { controlClass } from '@/components/employees/form-fields'
import { Message } from '@/components/leaves/leaves-page'
import { PdfButton, actionClass } from './claim-actions'

// Le lien "retour" : la page d'où l'on vient (?from=..., lib/back-links), sinon "Expense claims" (bug du
// 2026-11-11 : depuis My requests, le retour menait toujours à Expense claims).
const DEFAULT_BACK = { href: '/expenses', label: 'Expense claims' }

export function ClaimDetail({ requestId, from = null }: { requestId: number; from?: string | null }) {
  const [claim, setClaim] = useState<ExpenseClaim | null>(null)
  const [problem, setProblem] = useState('')

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
  const back = backLink(from, DEFAULT_BACK)

  return <div className="flex flex-col gap-4">
    <Link href={back.href} className="flex items-center gap-1 text-xs font-semibold text-[#23355d] hover:underline"><ArrowLeft className="size-3.5" /> {back.label}</Link>
    {/* onChanged : après une correction d'un montant, la note revient à jour (total, trace). */}
    <ClaimView claim={claim} onChanged={setClaim} />
  </div>
}

/** La note elle-même (qui, dépenses, justificatifs, total, PDF, historique) : dans cette page (lien d'une
 *  cloche, de Team approvals) ET dans le panneau de "My claims" (sans quitter la liste).
 *  Un valideur qui doit répondre (et qu'Admin RH autorise) voit "Correct" sur chaque dépense (2026-11-16). */
export function ClaimView({ claim, actions, onChanged }: { claim: ExpenseClaim; actions?: ReactNode; onChanged?: (claim: ExpenseClaim) => void }) {
  const [fileError, setFileError] = useState('')
  const [correcting, setCorrecting] = useState<number | null>(null)  // la dépense dont le formulaire est ouvert
  const status = claimStatus(claim)
  const canCorrect = claim.can_correct && onChanged !== undefined

  return <section className="rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
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
            {actions}
            <PdfButton claim={claim} />
            {/* L'historique du circuit : qui a validé, quand, avec quel commentaire. */}
            <Link href={`/requests/${claim.request}?from=claim-${claim.request}`} className={actionClass}>History</Link>
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
              <th className="px-4 py-2">Receipts</th>
              <th className="px-4 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {claim.lines.map((line) => <Fragment key={line.id}>
            <tr className="border-t border-slate-100">
              <td className="px-4 py-2.5 text-slate-600">{formatDate(line.date, true)}</td>
              <td className="px-4 py-2.5 text-slate-700">{line.category_label}</td>
              <td className="px-4 py-2.5 text-slate-600">
                {line.description || '—'}
                {/* Au-dessus du plafond (permis par Admin RH) : le N+1 et les RH voient de combien, et pourquoi. */}
                {line.above_ceiling !== null && <span className="mt-1 block">
                  <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
                    Above ceiling +{formatMad(line.above_ceiling)}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-amber-800">
                    Ceiling {formatMad(line.ceiling ?? 0)} · “{line.justification}”
                  </span>
                </span>}
                {/* Les corrections des valideurs : qui, à quel titre, pourquoi (la trace, pour tout le monde). */}
                {line.corrections.map((item) => <span key={item.id} className="mt-1 block text-[11px] text-slate-500">
                  Corrected {formatMad(item.old_amount)} → {formatMad(item.new_amount)} by <b className="font-semibold text-slate-700">{item.corrected_by ?? '?'}</b> ({item.as_role}) · “{item.reason}”
                </span>)}
              </td>
              <td className="px-4 py-2.5">
                {/* Chaque justificatif de la dépense (ex. la facture + le ticket de carte) : un clic l'ouvre. */}
                {line.receipts.length > 0
                  ? <div className="flex flex-col items-start gap-0.5">
                      {line.receipts.map((receipt) => <button key={receipt.id} type="button" className={cn(actionClass, 'px-0')}
                        onClick={async () => setFileError(await getFile(`/api/expenses/receipts/${receipt.id}/`, receipt.name, false))}>
                        <Paperclip className="size-3.5" /> <span className="max-w-40 truncate">{receipt.name || 'Open'}</span>
                      </button>)}
                    </div>
                  : <span className="text-slate-400">—</span>}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                {/* Corrigé : le montant demandé barré, puis le montant retenu. */}
                {/* Une autre devise : le montant du reçu et le taux appliqué (20,00 EUR × 10,9553). */}
                {line.currency_code && line.original_amount !== null && <span className="block text-[11px] text-slate-500">
                  {line.original_amount.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {line.currency_code} × {line.rate?.toLocaleString('fr-FR')}
                </span>}
                {line.corrections.length > 0 && <span className="block text-[11px] text-slate-400 line-through">{formatMad(line.corrections[0].old_amount)}</span>}
                <span className="font-semibold text-slate-700">{formatMad(line.amount)}</span>
                {canCorrect && line.amount > 0 && correcting !== line.id && <button type="button" onClick={() => setCorrecting(line.id)}
                  className="mt-0.5 block w-full text-right text-[11px] font-semibold text-[#23355d] hover:underline">Correct</button>}
              </td>
            </tr>
            {correcting === line.id && <tr>
              <td colSpan={5} className="px-4 pb-3">
                <CorrectForm line={line} onCancel={() => setCorrecting(null)}
                  onDone={(updated) => { setCorrecting(null); onChanged?.(updated) }} />
              </td>
            </tr>}
            </Fragment>)}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[#192646]/20">
              <td colSpan={4} className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600">Total to reimburse (MAD)</td>
              <td className="px-4 py-2.5 text-right text-sm font-semibold tabular-nums text-[#192646]">{formatMad(claim.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {fileError && <p role="alert" className="px-4 pb-3 text-xs font-medium text-red-600">{fileError}</p>}
    </section>
}

/** "Correct" : le valideur DIMINUE le montant d'une dépense (jamais plus haut ; 0 = refusée), avec un motif
 *  obligatoire. Django vérifie tout (c'est à lui de répondre, Admin RH le permet) ; le collaborateur est prévenu. */
function CorrectForm({ line, onCancel, onDone }: { line: ExpenseLine; onCancel: () => void; onDone: (claim: ExpenseClaim) => void }) {
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lower = amount !== '' && Number(amount) >= 0 && Number(amount) < line.amount

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const result = await sendChange<ExpenseClaim>(
      () => apiFetch(`/api/expenses/lines/${line.id}/correct/`, { method: 'POST', body: JSON.stringify({ amount, reason }) }),
      'You cannot correct this claim.')
    setBusy(false)
    if ('error' in result) return setError(result.error)
    onDone(result.data)
  }

  return <form onSubmit={submit} className="rounded-lg border border-[#23355d]/20 bg-[#E4E9F2]/40 p-3">
    <p className="text-[11px] font-semibold text-[#192646]">
      Correct {line.category_label} · {formatMad(line.amount)} — you can only lower it (0 = expense refused). The employee is notified.
    </p>
    <div className="mt-2 grid gap-2 sm:grid-cols-[140px_minmax(0,1fr)_auto]">
      <div>
        <label htmlFor={`correct-amount-${line.id}`} className="sr-only">New amount (MAD)</label>
        <input id={`correct-amount-${line.id}`} type="number" required min="0" max={line.amount} step="0.01" placeholder="New amount"
          value={amount} onChange={(e) => { setAmount(e.target.value); setError('') }} className={cn(controlClass, 'mt-0 bg-white')} />
      </div>
      <div>
        <label htmlFor={`correct-reason-${line.id}`} className="sr-only">Reason</label>
        <input id={`correct-reason-${line.id}`} required maxLength={300} placeholder="Reason (e.g. The receipt says 150 MAD)"
          value={reason} onChange={(e) => { setReason(e.target.value); setError('') }} className={cn(controlClass, 'mt-0 bg-white')} />
      </div>
      <div className="flex items-center gap-1">
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-white">Cancel</button>
        <button type="submit" disabled={busy || !lower || !reason.trim()}
          className="flex items-center gap-1.5 rounded-md bg-[#23355d] px-3 py-2 text-xs font-semibold text-white hover:bg-[#192646] disabled:opacity-50">
          {busy && <Loader2 className="size-3.5 animate-spin" />} Save
        </button>
      </div>
    </div>
    {amount !== '' && !lower && <p className="mt-1.5 text-[11px] font-medium text-red-600">Lower than {formatMad(line.amount)} only.</p>}
    {error && <p role="alert" className="mt-1.5 text-[11px] font-medium text-red-600">{error}</p>}
  </form>
}
