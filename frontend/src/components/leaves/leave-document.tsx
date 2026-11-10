'use client'

/*
 * P2 step 4 : le justificatif d'un congé (certificat médical...), sur une ligne de congé :
 * - reçu      -> "📎 Certificate" : l'ouvre dans un nouvel onglet (le collaborateur et les RH seulement ;
 *               Django refuse le N+1 : une donnée de santé) ;
 * - manquant  -> "⚠ Certificate missing" + "Add" (envoyer le fichier, même après la demande : prévenir en 48 h).
 * Utilisé dans "My leaves" (le collaborateur) et dans le panneau Leave balances (les RH).
 */
import { useId, useState } from 'react'
import { AlertTriangle, Loader2, Paperclip } from 'lucide-react'
import { getFile } from '@/lib/expenses'
import { uploadDocument, type Leave } from '@/lib/leaves'

export function LeaveDocument({ leave, onChanged }: { leave: Leave; onChanged: () => void }) {
  const inputId = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const active = leave.status === 'IN_PROGRESS' || leave.status === 'APPROVED'
  if (!leave.has_document && !(leave.document_required && active)) return null

  async function send(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setError('')
    const problem = await uploadDocument(leave.id, file)
    setBusy(false)
    if (problem) setError(problem)  // ex. "Le justificatif dépasse 5 Mo..."
    else onChanged()
  }

  async function open() {
    const problem = await getFile(`/api/leaves/documents/${leave.id}/`, leave.document_name || 'document', false)
    if (problem) setError(problem)
  }

  return <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
    {leave.has_document
      ? <button type="button" onClick={open} title={leave.document_name}
          className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700 hover:bg-emerald-100">
          <Paperclip className="size-3" aria-hidden /> Document
        </button>
      : <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700">
          <AlertTriangle className="size-3" aria-hidden /> Document missing
        </span>}
    {/* Envoyer (ou remplacer) : un vrai <input type="file"> caché derrière un petit bouton lisible. */}
    {active && <label htmlFor={inputId} className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold text-[#23355d] hover:bg-slate-100">
      {busy && <Loader2 className="size-3 animate-spin" />}{leave.has_document ? 'Replace' : 'Add'}
    </label>}
    <input id={inputId} type="file" accept=".pdf,.jpg,.jpeg,.png" className="sr-only" disabled={busy}
      onChange={(e) => { send(e.target.files?.[0]); e.target.value = '' }} />
    {error && <span role="alert" className="w-full font-medium text-red-600">{error}</span>}
  </div>
}
