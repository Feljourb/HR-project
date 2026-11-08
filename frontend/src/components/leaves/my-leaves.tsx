'use client'

/*
 * "My leaves" : mes congés, le plus récent d'abord, avec le statut de leur circuit.
 * Un congé en cours peut être annulé : c'est le moteur qui annule (/api/workflows/requests/<id>/cancel/),
 * comme pour toutes les demandes. Le titre ouvre l'historique de la demande (/requests/<id>).
 */
import { useState } from 'react'
import Link from 'next/link'
import { CalendarDays, Loader2, RefreshCw } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { formatDate, formatDays, isoDate, type Leave } from '@/lib/leaves'
import { cn } from '@/lib/utils'
import { sendChange } from '@/lib/workflows'

// Les mêmes couleurs que les badges de "My requests".
const BADGE: Record<string, string> = {
  IN_PROGRESS: 'bg-amber-50 text-amber-700',
  APPROVED: 'bg-emerald-50 text-emerald-700',
  REJECTED: 'bg-red-50 text-red-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
}

export function MyLeaves({ leaves, onCancelled }: { leaves: Leave[]; onCancelled: () => void }) {
  return <section className="rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <header className="border-b border-slate-100 px-4 py-3">
      <h2 className="text-sm font-semibold text-[#192646]">My leaves</h2>
      <p className="text-[11px] text-slate-500">Open a leave to see who approved it and when.</p>
    </header>
    {leaves.length === 0
      ? <p className="px-4 py-10 text-center text-sm text-slate-500"><CalendarDays className="mx-auto mb-2 size-6 text-[#8C6D52]" />No leave yet.</p>
      : <ul className="divide-y divide-slate-100">
          {leaves.map((leave) => <LeaveLine key={leave.id} leave={leave} onCancelled={onCancelled} />)}
        </ul>}
  </section>
}

function LeaveLine({ leave, onCancelled }: { leave: Leave; onCancelled: () => void }) {
  return <li className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3">
    <div className="min-w-0 flex-1">
      <Link href={`/requests/${leave.request}`} className="text-sm font-semibold text-[#192646] hover:underline">{leave.leave_type_label}</Link>
      <p className="text-xs text-slate-600">
        {formatDate(leave.start_date, true)}{leave.starts_afternoon && ' (afternoon)'}
        {' → '}
        {formatDate(leave.end_date, true)}{leave.ends_noon && ' (noon)'}
        <span className="font-semibold text-slate-700"> · {formatDays(leave.days)}</span>
      </p>
      {leave.reason && <p className="mt-0.5 text-[11px] italic text-slate-500">“{leave.reason}”</p>}
      {/* Enregistré par les RH à ma place (ex. une maladie que je n'ai pas pu demander) : déjà accepté. */}
      {leave.recorded_by && <p className="mt-0.5 text-[11px] text-slate-500">Recorded by HR ({leave.recorded_by})</p>}
      <RecountNote leave={leave} />
    </div>
    <div className="flex flex-col items-end gap-1.5">
      <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', BADGE[leave.status])}>{leave.status_label}</span>
      {leave.status === 'IN_PROGRESS' && <CancelButton leave={leave} onCancelled={onCancelled} />}
      {/* Déjà accepté mais pas encore commencé : annulable avec un motif (Django vérifie aussi la date). */}
      {leave.status === 'APPROVED' && leave.start_date > isoDate(new Date()) &&
        <CancelApprovedButton url={`/api/leaves/mine/${leave.id}/cancel/`} onCancelled={onCancelled} />}
    </div>
  </li>
}

/** Un jour férié a changé après l'envoi : le DERNIER recalcul, en une ligne ("5 → 4 days · Jour férié ajouté..."). */
export function RecountNote({ leave }: { leave: Leave }) {
  const last = leave.recounts[leave.recounts.length - 1]
  if (!last) return null
  const earlier = leave.recounts.length - 1
  return <p className="mt-1 flex items-start gap-1.5 rounded-md bg-sky-50 px-2 py-1 text-[11px] text-sky-800">
    <RefreshCw className="mt-0.5 size-3 shrink-0" aria-hidden />
    <span>
      <b className="font-semibold">Recounted {formatDays(last.old_days)} → {formatDays(last.new_days)}</b>
      {' · '}{last.reason}{earlier > 0 && ` (+${earlier} earlier)`}
    </span>
  </p>
}

/**
 * P1 step 5 : annuler un congé DÉJÀ ACCEPTÉ, avant son premier jour. Un motif est obligatoire : il est écrit
 * dans l'historique, et ceux qui l'avaient validé sont prévenus. Utilisé dans "My leaves" (le collaborateur)
 * et dans le panneau "Leave balances" (les RH : `body` dit quel congé).
 */
export function CancelApprovedButton({ url, body = {}, onCancelled }: {
  url: string; body?: Record<string, unknown>; onCancelled: (data: unknown) => void
}) {
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function cancel() {
    setBusy(true)
    setError('')
    try {
      const response = await apiFetch(url, { method: 'POST', body: JSON.stringify({ ...body, reason }) })
      const data = await response.json().catch(() => ({}))
      if (response.ok) {
        setAsking(false)
        onCancelled(data)  // la page relit la liste et le solde (les jours sont rendus)
      } else {
        setError(data.detail ?? 'Something went wrong. Please try again.')  // ex. "Ce congé a déjà commencé..."
      }
    } catch {
      setError('Cannot reach the server. Please try again later.')
    }
    setBusy(false)
  }

  if (!asking) {
    return <button type="button" onClick={() => setAsking(true)} className="rounded-md px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50">Cancel</button>
  }
  return <div className="flex w-full flex-wrap items-center justify-end gap-1.5">
    <label htmlFor={`cancel-reason-${url}`} className="sr-only">Reason of the cancellation</label>
    <input id={`cancel-reason-${url}`} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)"
      maxLength={500} className="h-7 w-44 rounded-md border border-slate-200 bg-white px-2 text-[11px] outline-none focus:border-[#23355d]" />
    <button type="button" onClick={() => { setAsking(false); setError('') }} className="rounded-md px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100">No</button>
    <button type="button" disabled={busy || !reason.trim()} onClick={cancel}
      className="flex items-center gap-1 rounded-md bg-red-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-red-700 disabled:opacity-60">
      {busy && <Loader2 className="size-3 animate-spin" />} Cancel the leave
    </button>
    {error && <p role="alert" className="w-full text-right text-[11px] font-medium text-red-600">{error}</p>}
  </div>
}

// Annuler en deux clics ("Cancel" puis "Yes, cancel") pour ne pas annuler par erreur.
function CancelButton({ leave, onCancelled }: { leave: Leave; onCancelled: () => void }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function cancel() {
    setBusy(true)
    setError('')
    const result = await sendChange(
      () => apiFetch(`/api/workflows/requests/${leave.request}/cancel/`, { method: 'POST' }),
      'Only the requester can cancel this request.')
    if ('data' in result) onCancelled()   // la page relit la liste et le solde (les jours sont libérés)
    else setError(result.error)           // ex. "Cette demande est déjà terminée." (validée entre-temps)
    setBusy(false)
    setAsking(false)
  }

  return <div className="flex flex-wrap items-center justify-end gap-1.5">
    {error && <p role="alert" className="text-[11px] font-medium text-red-600">{error}</p>}
    {asking
      ? <>
          <button type="button" onClick={() => setAsking(false)} className="rounded-md px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100">No</button>
          <button type="button" disabled={busy} onClick={cancel}
            className="flex items-center gap-1 rounded-md bg-red-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-red-700 disabled:opacity-60">
            {busy && <Loader2 className="size-3 animate-spin" />} Yes, cancel
          </button>
        </>
      : <button type="button" onClick={() => setAsking(true)} className="rounded-md px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50">Cancel</button>}
  </div>
}
