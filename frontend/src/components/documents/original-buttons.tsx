'use client'

/*
 * L'original papier (format "original" ou "PDF + original", 2026-11-13), côté RH. Deux boutons, l'un après l'autre :
 * - "Original ready" : imprimé, signé et tamponné, il attend au bureau RH -> le collaborateur est prévenu (🔔 + email) ;
 * - "Handed over" : le collaborateur est venu, l'original lui est remis (la date et le RH sont gardés).
 * Partagés par Document requests, l'historique de la demande et Team approvals.
 */
import { useState } from 'react'
import { HandHelping, Loader2, Stamp } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import type { DocumentRequest } from '@/lib/documents'
import { cn } from '@/lib/utils'
import { sendChange } from '@/lib/workflows'
import { actionClass } from '@/components/expenses/claim-actions'

export function OriginalButtons({ document, onDone }: { document: DocumentRequest; onDone: (updated: DocumentRequest) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!document.can_handle_original) return null
  const ready = document.original_state === 'PICKUP'  // déjà prêt : il reste à le remettre

  async function send() {
    setBusy(true)
    setError('')
    const result = await sendChange<DocumentRequest>(
      () => apiFetch(`/api/documents/hr/${document.request}/${ready ? 'handed-over' : 'original-ready'}/`, { method: 'POST' }),
      'Only HR of this employee\'s pôle can handle the original.')
    setBusy(false)
    if ('error' in result) setError(result.error)
    else onDone(result.data)
  }

  return <>
    {error && <span role="alert" className="text-[11px] text-red-600">{error}</span>}
    <button type="button" disabled={busy} onClick={send}
      title={ready ? 'The employee came: the original is handed over' : 'Printed, signed and stamped: the employee is told to pick it up'}
      className={cn(actionClass, 'bg-violet-600 text-white hover:bg-violet-700')}>
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : ready ? <HandHelping className="size-3.5" /> : <Stamp className="size-3.5" />}
      {ready ? 'Handed over' : 'Original ready'}
    </button>
  </>
}
