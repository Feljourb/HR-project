'use client'

/*
 * Les boutons d'une note de frais, partagés par "My claims", la page d'une note et la page des RH :
 * le PDF (une fois validée), l'annulation (tant qu'elle est en cours, par le demandeur).
 */
import { useState } from 'react'
import { FileDown, Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { getFile, type ExpenseClaim } from '@/lib/expenses'
import { sendChange } from '@/lib/workflows'

export const actionClass = 'flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-[#23355d] hover:bg-slate-100 disabled:opacity-50'

/** Le PDF à imprimer pour les RH : seulement après la validation (Django refuse avant). */
export function PdfButton({ claim }: { claim: ExpenseClaim }) {
  const [error, setError] = useState('')
  if (claim.status !== 'APPROVED') return null
  return <>
    <button type="button" className={actionClass}
      onClick={async () => setError(await getFile(`/api/expenses/claims/${claim.request}/pdf/`, `note-de-frais-${claim.request}.pdf`, true))}>
      <FileDown className="size-3.5" /> PDF
    </button>
    {error && <span role="alert" className="text-[11px] text-red-600">{error}</span>}
  </>
}

/** "Mark reimbursed" en deux clics (on ne revient pas en arrière) : la page Reimbursements ET la note elle-même
 *  (2026-11-19 : les RH le cherchaient dans la note). Django vérifie que c'est un RH du pôle. */
export function ReimburseButton({ claim, onDone }: { claim: ExpenseClaim; onDone: (claim: ExpenseClaim) => void }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function reimburse() {
    setBusy(true)
    const result = await sendChange<ExpenseClaim>(() => apiFetch(`/api/expenses/hr/${claim.request}/reimburse/`, { method: 'POST' }),
      'Only HR of the pôle can mark a reimbursement.')
    if ('data' in result) onDone(result.data)
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

/** Annuler en deux clics, par le moteur (comme un congé). Seuls le n° de demande et son statut servent :
 *  aussi pour une demande de document (page Administrative documents).
 *  needReason (2026-11-16, standard) : annuler la demande d'un AUTRE (un manager pour son équipe) demande un motif,
 *  que le demandeur lit dans sa notification ; pour sa propre demande, il n'en faut pas. */
export function CancelClaim({ claim, onCancelled, needReason = false }: {
  claim: Pick<ExpenseClaim, 'request' | 'status'>; onCancelled: () => void; needReason?: boolean
}) {
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (claim.status !== 'IN_PROGRESS') return null

  async function cancel() {
    setBusy(true)
    const result = await sendChange(() => apiFetch(`/api/workflows/requests/${claim.request}/cancel/`,
      { method: 'POST', body: JSON.stringify({ reason }) }), 'Only the requester can cancel this request.')
    if ('data' in result) onCancelled()
    else setError(result.error)
    setBusy(false)
    setAsking(false)
  }

  return <>
    {error && <span role="alert" className="text-[11px] text-red-600">{error}</span>}
    {asking
      ? <>
          {needReason && <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300}
            placeholder="Reason (the employee is told)" aria-label="Reason for cancelling"
            className="h-7 w-48 rounded-md border border-slate-200 px-2 text-[11px] outline-none focus:border-[#23355d]" />}
          <button type="button" onClick={() => setAsking(false)} className="rounded-md px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100">No</button>
          <button type="button" disabled={busy || (needReason && !reason.trim())} onClick={cancel}
            className="flex items-center gap-1 rounded-md bg-red-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-red-700 disabled:opacity-60">
            {busy && <Loader2 className="size-3 animate-spin" />} Yes, cancel
          </button>
        </>
      : <button type="button" onClick={() => setAsking(true)} className="rounded-md px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50">Cancel</button>}
  </>
}
