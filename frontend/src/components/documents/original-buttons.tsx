'use client'

/*
 * L'original papier (format "original" ou "PDF + original", 2026-11-13), côté RH. Deux boutons, l'un après l'autre :
 * - "Original ready" : imprimé, signé et tamponné, il attend au bureau RH -> le collaborateur est prévenu (🔔 + email) ;
 * - "Handed over" : remis en main propre. Le collaborateur a un manager : on choisit À QUI (2026-11-16, standard
 *   "remis à") : lui-même, ou son manager venu le chercher pour lui (un ouvrier qui ne passe pas au bureau RH) ;
 *   la trace le dit, et le collaborateur est prévenu s'il a été remis à son manager.
 * Partagés par Document requests, l'historique de la demande, le panneau d'un document et Team approvals.
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
  const [choosing, setChoosing] = useState(false)  // "Handed over" : à qui ?
  const [to, setTo] = useState<'employee' | 'manager'>('employee')
  if (!document.can_handle_original) return null
  const ready = document.original_state === 'PICKUP'  // déjà prêt : il reste à le remettre

  async function send(target: 'employee' | 'manager' = 'employee') {
    setBusy(true)
    setError('')
    const result = await sendChange<DocumentRequest>(
      () => apiFetch(`/api/documents/hr/${document.request}/${ready ? 'handed-over' : 'original-ready'}/`,
        { method: 'POST', body: JSON.stringify(ready ? { to: target } : {}) }),
      'Only HR of this employee\'s pôle can handle the original.')
    setBusy(false)
    if ('error' in result) setError(result.error)
    else { setChoosing(false); onDone(result.data) }
  }

  const button = cn(actionClass, 'bg-violet-600 text-white hover:bg-violet-700')

  // "Handed over" : à qui ? (seulement s'il a un manager ; sinon directement à lui).
  if (ready && choosing) {
    return <span className="flex flex-wrap items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1">
      <span className="text-[11px] font-semibold text-violet-800">Handed over to:</span>
      {([['employee', document.employee], ['manager', `${document.manager} (manager)`]] as const).map(([id, label]) =>
        <label key={id} className="flex items-center gap-1 text-[11px] text-slate-700">
          <input type="radio" name={`to-${document.request}`} checked={to === id} onChange={() => setTo(id)} className="accent-violet-600" /> {label}
        </label>)}
      <button type="button" onClick={() => setChoosing(false)} className="rounded-md px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-white">Cancel</button>
      <button type="button" disabled={busy} onClick={() => send(to)} className={button}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <HandHelping className="size-3.5" />} Confirm
      </button>
      {error && <span role="alert" className="w-full text-[11px] text-red-600">{error}</span>}
    </span>
  }

  return <>
    {error && <span role="alert" className="text-[11px] text-red-600">{error}</span>}
    <button type="button" disabled={busy} onClick={() => (ready && document.manager ? setChoosing(true) : send())}
      title={ready ? 'Handed over in person: to the employee, or to their manager who came for them' : 'Printed, signed and stamped: the employee is told to pick it up'}
      className={button}>
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : ready ? <HandHelping className="size-3.5" /> : <Stamp className="size-3.5" />}
      {ready ? 'Handed over' : 'Original ready'}
    </button>
  </>
}
