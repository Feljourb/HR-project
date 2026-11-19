'use client'

/*
 * UNE note de frais (/expenses/12, 12 = le numéro de sa demande) : qui, les dépenses, les justificatifs,
 * le total, le PDF. Pour tous ceux que la demande concerne (le demandeur, son N+1, les RH du pôle...) :
 * c'est ici que le N+1 regarde les tickets avant de valider. Sinon Django répond 404.
 * 2026-11-18 (demande de l'utilisatrice : "plus simple et clair") : le valideur voit en haut que la note
 * attend SA réponse, chaque dépense au-dessus du maximum dit le maximum ET la raison de l'employé, un vrai
 * bouton "Lower the amount" par dépense, une légende sous le tableau, et Approve / Reject en bas de la page.
 */
import { Fragment, useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft, CheckCircle2, Clock, Loader2, Paperclip, Pencil, TriangleAlert } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { backLink } from '@/lib/back-links'
import { STATUS_BADGE, claimStatus, formatMad, getFile, type ExpenseClaim, type ExpenseLine } from '@/lib/expenses'
import { formatDate } from '@/lib/leaves'
import type { Approval } from '@/lib/requests'
import { cn } from '@/lib/utils'
import { sendChange } from '@/lib/workflows'
import { controlClass } from '@/components/employees/form-fields'
import { Message } from '@/components/leaves/leaves-page'
import { roleOf } from '@/components/requests/request-history'
import { Decision } from '@/components/requests/decision'
import { PdfButton, ReimburseButton, actionClass } from './claim-actions'

// Le lien "retour" : la page d'où l'on vient (?from=..., lib/back-links), sinon "Expense claims" (bug du
// 2026-11-11 : depuis My requests, le retour menait toujours à Expense claims).
const DEFAULT_BACK = { href: '/expenses', label: 'Expense claims' }

// Les statuts en anglais, comme le reste de la page (Django envoie "En cours"...).
const STATUS_LABEL: Record<string, string> = {
  IN_PROGRESS: 'In progress', APPROVED: 'Approved', REIMBURSED: 'Reimbursed', REJECTED: 'Refused', CANCELLED: 'Cancelled',
}

export function ClaimDetail({ requestId, from = null }: { requestId: number; from?: string | null }) {
  const [claim, setClaim] = useState<ExpenseClaim | null>(null)
  const [problem, setProblem] = useState('')
  const [approval, setApproval] = useState<Approval | null>(null)  // l'étape qui attend MA réponse, ou null
  const [answered, setAnswered] = useState('')

  const load = useCallback(() => {
    apiFetch(`/api/expenses/claims/${requestId}/`)
      .then(async (response) => {
        if (response.status === 404) return setProblem('This expense claim does not exist, or it does not concern you.')
        if (!response.ok) throw new Error()
        setClaim(await response.json())
      })
      .catch(() => setProblem('Could not load the expense claim. Please try again later.'))
    // Est-ce que cette note attend MA réponse ? (les mêmes étapes que Team approvals)
    apiFetch('/api/workflows/approvals/')
      .then(async (response) => {
        if (!response.ok) return
        const steps: Approval[] = await response.json()
        setApproval(steps.find((step) => step.request.id === requestId) ?? null)
      })
      .catch(() => undefined)
  }, [requestId])

  useEffect(load, [load])

  if (!claim) return <Message>{problem || 'Loading...'}</Message>
  const back = backLink(from, DEFAULT_BACK)

  return <div className="flex flex-col gap-4">
    <Link href={back.href} className="flex items-center gap-1 text-xs font-semibold text-[#23355d] hover:underline"><ArrowLeft className="size-3.5" /> {back.label}</Link>
    {answered && <p role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-800">
      <CheckCircle2 className="size-4 shrink-0" aria-hidden /> {answered}
    </p>}
    {/* onChanged : après une correction d'un montant, la note revient à jour (total, trace). */}
    <ClaimView claim={claim} onChanged={setClaim} waitingForMe={approval ? roleOf(approval) : null} />
    {/* Ma réponse, en bas de la note : après avoir regardé chaque dépense (plus besoin de revenir à Team approvals). */}
    {approval && <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <h2 className="text-sm font-semibold text-[#192646]">Your answer</h2>
      <p className="mb-3 text-xs text-slate-500">Approve = the claim goes to the next step. Reject = the claim is closed (say why in the comment).</p>
      <Decision approval={approval} onAnswered={(verb) => {
        setAnswered(verb === 'Approved' ? 'You approved this claim.' : 'You rejected this claim. The employee is told.')
        setApproval(null)
        load()
      }} />
    </section>}
  </div>
}

/** La note elle-même (qui, dépenses, justificatifs, total, PDF, historique) : dans cette page (lien d'une
 *  cloche, de Team approvals) ET dans le panneau de "My claims" (sans quitter la liste).
 *  waitingForMe : le rôle ("N+1", "RH du pôle") quand la note attend MA réponse, sinon null.
 *  Un valideur qui doit répondre (et qu'Admin RH autorise) voit "Lower the amount" sur chaque dépense (2026-11-16). */
export function ClaimView({ claim, actions, onChanged, waitingForMe = null }: {
  claim: ExpenseClaim; actions?: ReactNode; onChanged?: (claim: ExpenseClaim) => void; waitingForMe?: string | null
}) {
  const [fileError, setFileError] = useState('')
  const [correcting, setCorrecting] = useState<number | null>(null)  // la dépense dont le formulaire est ouvert
  const status = claimStatus(claim)
  const canCorrect = claim.can_correct && onChanged !== undefined
  const above = claim.lines.filter((line) => line.above_ceiling !== null).length
  const corrected = claim.lines.some((line) => line.corrections.length > 0)

  return <section className="rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <header className="flex flex-wrap items-start gap-3 px-5 pt-4">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8C6D52]">Expense claim n° {claim.request}</p>
          <h1 className="text-lg font-semibold text-[#192646]">{claim.title}</h1>
          <p className="text-xs text-slate-500">
            {claim.employee} · {claim.department} · {claim.grade ?? 'no grade'} · sent {formatDate(claim.created_at.slice(0, 10))}
            {claim.reimbursed_at && <> · reimbursed on {formatDate(claim.reimbursed_at)}{claim.reimbursed_by ? ` by ${claim.reimbursed_by}` : ''}</>}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-semibold', STATUS_BADGE[status.key])}>{STATUS_LABEL[status.key] ?? status.label}</span>
          <div className="flex items-center gap-1">
            {actions}
            <PdfButton claim={claim} />
            {/* Les RH paient : "Mark reimbursed" ici aussi (pas seulement dans la page Reimbursements). */}
            {claim.can_reimburse && onChanged && <ReimburseButton claim={claim} onDone={onChanged} />}
            {/* L'historique du circuit : qui a validé, quand, avec quel commentaire. */}
            <Link href={`/requests/${claim.request}?from=claim-${claim.request}`} className={actionClass}>History</Link>
          </div>
        </div>
      </header>

      {/* Ce qu'il faut savoir d'abord : qui doit répondre, et les dépenses au-dessus du maximum. */}
      <div className="flex flex-col gap-2 px-5 pb-4 pt-3">
        {waitingForMe
          ? <p className="flex items-start gap-2 rounded-lg border border-[#23355d]/15 bg-[#E4E9F2]/50 px-3 py-2 text-xs text-[#192646]">
              <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span><b className="font-semibold">Waiting for your answer ({waitingForMe}).</b> Check each expense{canCorrect ? ', change an amount if needed' : ''}, then answer at the bottom of the page.</span>
            </p>
          : claim.waiting_for && <p className="flex items-center gap-2 text-xs text-slate-600">
              <Clock className="size-3.5 shrink-0 text-slate-400" aria-hidden /> Waiting for {claim.waiting_for}
            </p>}
        {above > 0 && <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span><b className="font-semibold">{above} expense{above > 1 ? 's are' : ' is'} above the maximum</b> of {claim.grade ?? 'the grade'}: read the employee&apos;s reason under {above > 1 ? 'each one' : 'it'}.</span>
        </p>}
      </div>

      <div className="overflow-x-auto border-t border-slate-100">
        <table className="w-full min-w-[680px] text-xs">
          <thead>
            <tr className="bg-slate-50/70 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-5 py-2.5">Date</th>
              <th className="px-3 py-2.5">Expense</th>
              <th className="px-3 py-2.5">Receipts</th>
              <th className="px-3 py-2.5 text-right">Amount</th>
              {canCorrect && <th className="px-5 py-2.5 text-right"><span className="sr-only">Action</span></th>}
            </tr>
          </thead>
          <tbody>
            {claim.lines.map((line) => {
              const asked = line.corrections[0]?.old_amount ?? line.amount  // le montant demandé par l'employé
              return <Fragment key={line.id}>
              <tr className={cn('border-t border-slate-100 align-top', line.above_ceiling !== null && 'bg-amber-50/30')}>
                <td className="whitespace-nowrap px-5 py-3 text-slate-600">{formatDate(line.date, true)}</td>
                <td className="px-3 py-3">
                  <p className="font-medium text-slate-800">{line.category_label}</p>
                  {line.description && <p className="mt-0.5 text-slate-500">{line.description}</p>}
                  {/* Au-dessus du maximum (permis par Admin RH) : le maximum, le montant demandé, et la raison de l'employé. */}
                  {line.above_ceiling !== null && <div className="mt-1.5 rounded-md border border-amber-200 bg-white px-2.5 py-1.5 text-[11px] text-amber-900">
                    <p className="flex items-center gap-1 font-semibold">
                      <TriangleAlert className="size-3 shrink-0" aria-hidden />
                      {line.ceiling !== null
                        ? <>Maximum {formatMad(line.ceiling)} · asked {formatMad(asked)} (+{formatMad(line.above_ceiling)})</>
                        : <>Above the maximum by {formatMad(line.above_ceiling)}</>}
                    </p>
                    <p className="mt-0.5">Employee&apos;s reason: “{line.justification}”</p>
                  </div>}
                  {/* Les montants baissés par un valideur : qui, à quel titre, pourquoi (la trace, pour tout le monde). */}
                  {line.corrections.map((item) => <p key={item.id} className="mt-1 text-[11px] text-slate-500">
                    {item.new_amount < item.old_amount ? 'Lowered' : 'Raised'} {formatMad(item.old_amount)} → {formatMad(item.new_amount)} by <b className="font-semibold text-slate-700">{item.corrected_by ?? '?'}</b> ({item.as_role}) · Why: “{item.reason}”
                  </p>)}
                </td>
                <td className="px-3 py-3">
                  {/* Chaque justificatif de la dépense (ex. la facture + le ticket de carte) : un clic l'ouvre. */}
                  {line.receipts.length > 0
                    ? <div className="flex flex-col items-start gap-0.5">
                        {line.receipts.map((receipt) => <button key={receipt.id} type="button" className={cn(actionClass, 'px-0')}
                          onClick={async () => setFileError(await getFile(`/api/expenses/receipts/${receipt.id}/`, receipt.name, false))}>
                          <Paperclip className="size-3.5" /> <span className="max-w-40 truncate">{receipt.name || 'Open'}</span>
                        </button>)}
                      </div>
                    : <span className="text-slate-400">No receipt</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                  {/* Une autre devise : le montant du reçu et le taux appliqué (20,00 EUR × 10,9553). */}
                  {line.currency_code && line.original_amount !== null && <span className="block text-[11px] text-slate-500">
                    {line.original_amount.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {line.currency_code} × {line.rate?.toLocaleString('fr-FR')}
                  </span>}
                  {/* Baissé : le montant demandé barré, puis le montant retenu. */}
                  {asked !== line.amount && <span className="block text-[11px] text-slate-400 line-through">{formatMad(asked)}</span>}
                  <span className={cn('text-sm font-semibold', line.amount === 0 ? 'text-red-600' : 'text-slate-800')}>{formatMad(line.amount)}</span>
                </td>
                {canCorrect && <td className="whitespace-nowrap px-5 py-3 text-right">
                  {correcting !== line.id && <button type="button" onClick={() => setCorrecting(line.id)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#23355d] hover:border-[#23355d]/40 hover:bg-[#E4E9F2]/40">
                    <Pencil className="size-3" aria-hidden /> Change the amount
                  </button>}
                </td>}
              </tr>
              {correcting === line.id && <tr>
                <td colSpan={canCorrect ? 5 : 4} className="px-5 pb-3">
                  <CorrectForm line={line} onCancel={() => setCorrecting(null)}
                    onDone={(updated) => { setCorrecting(null); onChanged?.(updated) }} />
                </td>
              </tr>}
              </Fragment>
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[#192646]/15 bg-slate-50/70">
              <td colSpan={3} className="px-5 py-3 text-right text-xs font-semibold text-slate-600">Total to reimburse</td>
              <td className="whitespace-nowrap px-3 py-3 text-right text-base font-semibold tabular-nums text-[#192646]">{formatMad(claim.total)}</td>
              {canCorrect && <td />}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* La légende : ce que veut dire chaque signe du tableau (seulement ceux qui sont utiles ici). */}
      {(above > 0 || canCorrect || corrected) && <ul className="flex flex-col gap-1 border-t border-slate-100 px-5 py-3 text-[11px] text-slate-500">
        {above > 0 && <li><TriangleAlert className="mr-1 inline size-3 text-amber-700" aria-hidden /><b className="font-semibold text-slate-600">Above the maximum</b> = more than the maximum of the employee&apos;s grade. Admin RH allows it for this category, with a reason.</li>}
        {canCorrect && <li><Pencil className="mr-1 inline size-3 text-[#23355d]" aria-hidden /><b className="font-semibold text-slate-600">Change the amount</b> = pay less than asked (0 = this expense is refused), or put it back after a mistake. Never more than the employee asked. The employee is told.</li>}
        {corrected && <li><b className="font-semibold text-slate-600">Crossed-out amount</b> = the amount the employee asked.</li>}
      </ul>}
      {fileError && <p role="alert" className="px-5 pb-3 text-xs font-medium text-red-600">{fileError}</p>}
    </section>
}

/** "Lower the amount" : le valideur DIMINUE le montant d'une dépense (jamais plus haut ; 0 = refusée), avec un motif
 *  obligatoire. Django vérifie tout (c'est à lui de répondre, Admin RH le permet) ; le collaborateur est prévenu. */
function CorrectForm({ line, onCancel, onDone }: { line: ExpenseLine; onCancel: () => void; onDone: (claim: ExpenseClaim) => void }) {
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Entre 0 et le montant DEMANDÉ par l'employé (2026-11-19 : on peut remonter après une erreur), et différent d'aujourd'hui.
  const asked = line.corrections[0]?.old_amount ?? line.amount
  const valid = amount !== '' && Number(amount) >= 0 && Number(amount) <= asked && Number(amount) !== line.amount

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const result = await sendChange<ExpenseClaim>(
      () => apiFetch(`/api/expenses/lines/${line.id}/correct/`, { method: 'POST', body: JSON.stringify({ amount, reason }) }),
      'You cannot change this claim.')
    setBusy(false)
    if ('error' in result) return setError(result.error)
    onDone(result.data)
  }

  const labelClass = 'text-[11px] font-semibold text-slate-700'
  return <form onSubmit={submit} className="rounded-lg border border-[#23355d]/20 bg-[#E4E9F2]/40 p-3">
    <p className="text-xs font-semibold text-[#192646]">Change the amount of “{line.category_label}” (now {formatMad(line.amount)})</p>
    <div className="mt-2 grid gap-2 sm:grid-cols-[170px_minmax(0,1fr)_auto] sm:items-end">
      <div>
        <label htmlFor={`correct-amount-${line.id}`} className={labelClass}>New amount (MAD)</label>
        <input id={`correct-amount-${line.id}`} type="number" required min="0" max={asked} step="0.01" placeholder="e.g. 400" autoFocus
          value={amount} onChange={(e) => { setAmount(e.target.value); setError('') }} className={cn(controlClass, 'bg-white')} />
      </div>
      <div>
        <label htmlFor={`correct-reason-${line.id}`} className={labelClass}>Why? <span className="font-normal text-slate-500">(the employee reads it)</span></label>
        <input id={`correct-reason-${line.id}`} required maxLength={300} placeholder="e.g. The receipt says 400 MAD"
          value={reason} onChange={(e) => { setReason(e.target.value); setError('') }} className={cn(controlClass, 'bg-white')} />
      </div>
      <div className="flex items-center gap-1">
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-white">Cancel</button>
        <button type="submit" disabled={busy || !valid || !reason.trim()}
          className="flex items-center gap-1.5 rounded-md bg-[#23355d] px-3 py-2 text-xs font-semibold text-white hover:bg-[#192646] disabled:opacity-50">
          {busy && <Loader2 className="size-3.5 animate-spin" />} Save
        </button>
      </div>
    </div>
    <p className={cn('mt-1.5 text-[11px]', amount !== '' && !valid ? 'font-medium text-red-600' : 'text-slate-500')}>
      From 0 to {formatMad(asked)} (what the employee asked) · 0 = this expense is refused.
    </p>
    {error && <p role="alert" className="mt-1 text-[11px] font-medium text-red-600">{error}</p>}
  </form>
}
