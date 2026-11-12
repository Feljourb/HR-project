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

/** Annuler en deux clics, par le moteur (comme un congé). Seuls le n° de demande et son statut servent :
 *  aussi pour une demande de document (page Administrative documents). */
export function CancelClaim({ claim, onCancelled }: { claim: Pick<ExpenseClaim, 'request' | 'status'>; onCancelled: () => void }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (claim.status !== 'IN_PROGRESS') return null

  async function cancel() {
    setBusy(true)
    const result = await sendChange(() => apiFetch(`/api/workflows/requests/${claim.request}/cancel/`, { method: 'POST' }),
      'Only the requester can cancel this claim.')
    if ('data' in result) onCancelled()
    else setError(result.error)
    setBusy(false)
    setAsking(false)
  }

  return <>
    {error && <span role="alert" className="text-[11px] text-red-600">{error}</span>}
    {asking
      ? <>
          <button type="button" onClick={() => setAsking(false)} className="rounded-md px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100">No</button>
          <button type="button" disabled={busy} onClick={cancel}
            className="flex items-center gap-1 rounded-md bg-red-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-red-700 disabled:opacity-60">
            {busy && <Loader2 className="size-3 animate-spin" />} Yes, cancel
          </button>
        </>
      : <button type="button" onClick={() => setAsking(true)} className="rounded-md px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50">Cancel</button>}
  </>
}
