'use client'

/*
 * "My leaves" : mes congés, la DERNIÈRE DEMANDE d'abord (décision du 2026-11-09 : pas l'ordre des dates de congé).
 * Une ligne calme par congé : une puce calendrier (le 1er jour), le type et le nombre de jours, les dates, et
 * en petit gris ce qui est en plus (demandé le..., enregistré par les RH, recalculé). Le statut et les actions à droite.
 * Des onglets par statut, et seulement les 5 dernières demandes (puis "Show all") : l'œil n'est pas noyé.
 * Un congé en cours s'annule par le moteur ; un congé accepté pas encore commencé, avec un motif.
 * Le type ouvre l'historique de la demande (/requests/<id>).
 */
import { useState } from 'react'
import Link from 'next/link'
import { CalendarDays, Loader2, RefreshCw } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { formatDate, formatDays, isoDate, type Leave } from '@/lib/leaves'
import { cn } from '@/lib/utils'
import { sendChange } from '@/lib/workflows'

// Le statut en anglais (la page est en anglais), avec les mêmes couleurs que "My requests".
const STATUS: Record<string, { label: string; badge: string }> = {
  IN_PROGRESS: { label: 'In progress', badge: 'bg-amber-50 text-amber-700 ring-amber-200' },
  APPROVED: { label: 'Approved', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  REJECTED: { label: 'Refused', badge: 'bg-red-50 text-red-700 ring-red-200' },
  CANCELLED: { label: 'Cancelled', badge: 'bg-slate-100 text-slate-500 ring-slate-200' },
}

// Les onglets : "Closed" regroupe refusés et annulés (ce qui ne compte plus).
const TABS = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'pending', label: 'In progress', match: (leave: Leave) => leave.status === 'IN_PROGRESS' },
  { id: 'approved', label: 'Approved', match: (leave: Leave) => leave.status === 'APPROVED' },
  { id: 'closed', label: 'Closed', match: (leave: Leave) => leave.status === 'REJECTED' || leave.status === 'CANCELLED' },
]
const FIRST = 5  // combien de lignes avant "Show all"

export function MyLeaves({ leaves, onCancelled }: { leaves: Leave[]; onCancelled: () => void }) {
  const [tab, setTab] = useState('all')
  const [all, setAll] = useState(false)
  const current = TABS.find((item) => item.id === tab) ?? TABS[0]
  // La dernière demande d'abord (la date d'ENVOI, pas la date du congé).
  const sorted = leaves.filter(current.match).sort((a, b) => b.created_at.localeCompare(a.created_at))
  const shown = all ? sorted : sorted.slice(0, FIRST)

  return <section className="rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <header className="px-4 pt-3">
      <h2 className="text-sm font-semibold text-[#192646]">My leaves</h2>
      <p className="text-[11px] text-slate-500">The latest request first. Open one to see who approved it and when.</p>
    </header>
    {leaves.length === 0
      ? <p className="px-4 py-10 text-center text-sm text-slate-500"><CalendarDays className="mx-auto mb-2 size-6 text-[#8C6D52]" />No leave yet.</p>
      : <>
          {/* Les filtres, en pastilles avec leur nombre (le même style que "My requests"). */}
          <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1.5 border-b border-slate-100 px-4 pb-3 pt-2">
            {TABS.map((item) => {
              const selected = item.id === tab
              return <button key={item.id} type="button" aria-pressed={selected} onClick={() => { setTab(item.id); setAll(false) }}
                className={cn('flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors',
                  selected ? 'border-[#23355d] bg-[#23355d] text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-[#23355d]/40 hover:text-[#23355d]')}>
                {item.label}<span className={cn('tabular-nums', selected ? 'text-white/70' : 'text-slate-400')}>{leaves.filter(item.match).length}</span>
              </button>
            })}
          </div>
          {shown.length === 0
            ? <p className="px-4 py-8 text-center text-xs text-slate-500">Nothing here.</p>
            : <ul className="divide-y divide-slate-100">
                {shown.map((leave) => <LeaveLine key={leave.id} leave={leave} onCancelled={onCancelled} />)}
              </ul>}
          {sorted.length > FIRST && <button type="button" onClick={() => setAll((old) => !old)}
            className="w-full border-t border-slate-100 px-4 py-2.5 text-xs font-semibold text-[#23355d] hover:bg-slate-50">
            {all ? 'Show less' : `Show all (${sorted.length})`}
          </button>}
        </>}
  </section>
}

const SHORT_MONTH = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { month: 'short' })

/** "Mon 16/11 → Thu 19/11/2026" (l'année une seule fois si c'est la même), ou un seul jour "Mon 16/11/2026". */
function dateRange(start: string, end: string) {
  if (start === end) return formatDate(start, true)
  const from = start.slice(0, 4) === end.slice(0, 4) ? formatDate(start, true).slice(0, -5) : formatDate(start, true)
  return `${from} → ${formatDate(end, true)}`
}

function LeaveLine({ leave, onCancelled }: { leave: Leave; onCancelled: () => void }) {
  const ended = leave.status === 'REJECTED' || leave.status === 'CANCELLED'
  // Ce qui est "en plus", en petit gris sur une ligne (le détail complet est dans l'historique).
  const extras = [
    `requested ${formatDate(leave.created_at.slice(0, 10))}`,
    leave.starts_afternoon && 'starts in the afternoon',
    leave.ends_noon && 'ends at noon',
    leave.recorded_by && `recorded by HR (${leave.recorded_by})`,
  ].filter(Boolean)

  return <li className={cn('flex items-start gap-3 px-4 py-3', ended && 'opacity-60')}>
    {/* La puce calendrier : le premier jour du congé, lisible d'un coup d'œil. */}
    <span className="flex w-11 shrink-0 flex-col items-center rounded-lg border border-slate-200 bg-slate-50 py-1" aria-hidden>
      <span className="text-[9px] font-bold uppercase tracking-wide text-[#8C6D52]">{SHORT_MONTH(leave.start_date)}</span>
      <span className="text-base font-semibold leading-tight text-[#192646]">{Number(leave.start_date.slice(8, 10))}</span>
    </span>

    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <Link href={`/requests/${leave.request}`} className="truncate text-sm font-semibold text-[#192646] hover:underline">{leave.leave_type_label}</Link>
        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-600">{formatDays(leave.days)}</span>
      </div>
      <p className="text-xs text-slate-600">{dateRange(leave.start_date, leave.end_date)}</p>
      <p className="truncate text-[11px] text-slate-400" title={leave.reason || undefined}>
        {extras.join(' · ')}{leave.reason && <> · <span className="italic">“{leave.reason}”</span></>}
      </p>
      <RecountNote leave={leave} />
    </div>

    <div className="flex shrink-0 flex-col items-end gap-1">
      <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', (STATUS[leave.status] ?? STATUS.CANCELLED).badge)}>
        {(STATUS[leave.status] ?? STATUS.CANCELLED).label}
      </span>
      {leave.status === 'IN_PROGRESS' && <CancelButton leave={leave} onCancelled={onCancelled} />}
      {/* Déjà accepté mais pas encore commencé : annulable avec un motif (Django vérifie aussi la date). */}
      {leave.status === 'APPROVED' && leave.start_date > isoDate(new Date()) &&
        <CancelApprovedButton url={`/api/leaves/mine/${leave.id}/cancel/`} onCancelled={onCancelled} />}
    </div>
  </li>
}

/** Un jour férié a changé après l'envoi : le DERNIER recalcul, en une petite ligne ("5 → 4 days · Jour férié ajouté..."). */
export function RecountNote({ leave }: { leave: Leave }) {
  const last = leave.recounts[leave.recounts.length - 1]
  if (!last) return null
  const earlier = leave.recounts.length - 1
  return <p className="mt-1 flex items-start gap-1.5 text-[11px] text-sky-700" title={last.reason}>
    <RefreshCw className="mt-0.5 size-3 shrink-0" aria-hidden />
    <span className="truncate">
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
