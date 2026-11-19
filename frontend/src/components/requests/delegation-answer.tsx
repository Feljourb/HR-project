'use client'

/*
 * Une délégation : son état en pastille, et la réponse du délégué (2026-11-19, remarque de la réunion : le délégué
 * ACCEPTE ou REFUSE ; il peut être en congé, ou ne pas vouloir). Un seul composant pour les deux pages où le délégué
 * la voit : "Out of office" (Team approvals : manager, RH) et "Stand-in requests" (un collaborateur).
 */
import { useState } from 'react'
import { Check, Loader2, X } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import type { Delegation } from '@/lib/requests'
import { cn } from '@/lib/utils'
import { sendChange } from '@/lib/workflows'

const BADGE: Record<Delegation['state'], { label: string; className: string }> = {
  ACTIVE: { label: 'Active', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  PLANNED: { label: 'Planned', className: 'bg-sky-50 text-sky-700 ring-sky-200' },
  WAITING: { label: 'Waiting for an answer', className: 'bg-amber-50 text-amber-700 ring-amber-200' },
  DECLINED: { label: 'Declined', className: 'bg-red-50 text-red-700 ring-red-200' },
  ENDED: { label: 'Ended', className: 'bg-slate-100 text-slate-500 ring-slate-200' },
}

export function DelegationBadge({ state }: { state: Delegation['state'] }) {
  const badge = BADGE[state]
  return <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset', badge.className)}>{badge.label}</span>
}

/** Accept, ou Decline avec un motif obligatoire (l'absent le lit dans sa notification). */
export function DelegationAnswer({ delegation, onAnswered }: { delegation: Delegation; onAnswered: (message: string) => void }) {
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null)
  const [error, setError] = useState('')

  async function send(action: 'accept' | 'decline') {
    setBusy(action)
    setError('')
    const result = await sendChange(() => apiFetch(`/api/workflows/delegations/${delegation.id}/${action}/`,
      { method: 'POST', body: JSON.stringify(action === 'decline' ? { reason } : {}) }), 'You cannot answer this delegation.')
    setBusy(null)
    if ('error' in result) return setError(result.error)
    onAnswered(action === 'accept'
      ? `You accepted: you answer for ${delegation.delegator_label} from the first day.`
      : `You declined. ${delegation.delegator_label} is told and will choose someone else.`)
  }

  return <div className="flex flex-col gap-2">
    {declining
      ? <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`decline-${delegation.id}`} className="sr-only">Why do you decline?</label>
          <input id={`decline-${delegation.id}`} autoFocus value={reason} maxLength={300} onChange={(e) => { setReason(e.target.value); setError('') }}
            placeholder="Why? (e.g. I am on leave these days)"
            className="h-8 min-w-0 flex-1 rounded-md border border-slate-200 px-2.5 text-xs outline-none focus:border-[#23355d]" />
          <button type="button" onClick={() => setDeclining(false)} className="rounded-md px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100">Back</button>
          <button type="button" disabled={busy !== null || !reason.trim()} onClick={() => send('decline')}
            className="flex items-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50">
            {busy === 'decline' && <Loader2 className="size-3 animate-spin" />} Decline
          </button>
        </div>
      : <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy !== null} onClick={() => setDeclining(true)}
            className="flex items-center gap-1 rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60">
            <X className="size-3.5" aria-hidden /> Decline
          </button>
          <button type="button" disabled={busy !== null} onClick={() => send('accept')}
            className="flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
            {busy === 'accept' ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3.5" aria-hidden />} Accept
          </button>
        </div>}
    {error && <p role="alert" className="text-[11px] font-medium text-red-600">{error}</p>}
  </div>
}
