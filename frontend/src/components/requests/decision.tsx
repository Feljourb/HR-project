'use client'

/*
 * Le commentaire et les deux boutons Approve / Reject d'une étape qui attend MA réponse.
 * Le commentaire est obligatoire pour refuser : Django le vérifie et renvoie "Un commentaire est obligatoire
 * pour refuser.", affiché sous les boutons.
 * Utilisé par Team approvals, la page "Stand-in requests", la page d'une note de frais et son panneau.
 * (Dans son propre fichier depuis le 2026-11-18 : sinon team-approvals et la note de frais s'importaient l'un l'autre.)
 */
import { useState } from 'react'
import { Check, Loader2, X } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import type { Approval, WorkflowRequest } from '@/lib/requests'
import { sendChange } from '@/lib/workflows'

export function Decision({ approval, onAnswered }: { approval: Approval; onAnswered: (verb: string) => void }) {
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  const [error, setError] = useState('')

  async function send(action: 'approve' | 'reject') {
    setBusy(action)
    setError('')
    const result = await sendChange<WorkflowRequest>(
      () => apiFetch(`/api/workflows/approvals/${approval.id}/${action}/`, { method: 'POST', body: JSON.stringify({ comment }) }),
      'You cannot answer this request.')
    if ('data' in result) onAnswered(action === 'approve' ? 'Approved' : 'Rejected')
    else setError(result.error)
    setBusy(null)
  }

  const id = `comment-${approval.id}`
  return <div className="flex flex-col gap-2">
    <label htmlFor={id} className="text-xs font-semibold text-slate-700">Comment <span className="font-normal text-slate-500">(required to reject)</span></label>
    <textarea id={id} rows={2} value={comment} maxLength={1000} onChange={(e) => { setComment(e.target.value); setError('') }}
      aria-invalid={error ? true : undefined}
      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-[#23355d] focus:bg-white focus:ring-3 focus:ring-[#23355d]/15 aria-invalid:border-red-300" />
    <div className="flex flex-wrap items-center justify-end gap-2">
      {error && <p role="alert" className="mr-auto text-[11px] font-medium text-red-600">{error}</p>}
      <button type="button" disabled={busy !== null} onClick={() => send('reject')}
        className="flex items-center gap-1.5 rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60">
        {busy === 'reject' ? <Loader2 className="size-3 animate-spin" /> : <X className="size-3.5" />} Reject
      </button>
      <button type="button" disabled={busy !== null} onClick={() => send('approve')}
        className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
        {busy === 'approve' ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3.5" />} Approve
      </button>
    </div>
  </div>
}
