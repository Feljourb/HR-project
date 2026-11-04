'use client'

/*
 * Le panneau d'UN collaborateur, ouvert par un clic dans "Leave balances" (comme les grands logiciels RH) :
 * - son solde ; - les jours gagnés ANNÉE PAR ANNÉE (les tirelires) ; - son droit annuel et ses changements
 *   (P1 step 2 : "30 jours à partir du 01/09/2026") ; - tous ses congés.
 * Lu dans /api/leaves/balances/<employee>/ ; un changement du droit : POST .../right/ (Django répond le panneau à jour).
 * Un vrai <dialog> : Échap ferme, le focus reste dans le panneau.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { Loader2, Plus, X } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { formatDate, formatDays, isoDate, type BalanceDetail, type YearPool } from '@/lib/leaves'
import { cn } from '@/lib/utils'
import { controlClass } from '@/components/employees/form-fields'

const BADGE: Record<string, string> = {
  IN_PROGRESS: 'bg-amber-50 text-amber-700',
  APPROVED: 'bg-emerald-50 text-emerald-700',
  REJECTED: 'bg-red-50 text-red-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
}

const STATE: Record<YearPool['state'], { label: string; className: string }> = {
  VALID: { label: 'Valid', className: 'bg-emerald-50 text-emerald-700' },
  EXPIRING: { label: 'Lost on 31/12', className: 'bg-amber-50 text-amber-700' },
  EXPIRED: { label: 'Expired', className: 'bg-slate-100 text-slate-500' },
}

const days = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/, ''))

export function BalancePanel({ employeeId, onClose, onChanged }: {
  employeeId: number | null; onClose: () => void; onChanged: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  // On ouvre / ferme le vrai <dialog> quand le collaborateur choisi change.
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (employeeId !== null && !dialog.open) dialog.showModal()
    if (employeeId === null && dialog.open) dialog.close()
  }, [employeeId])

  return <dialog ref={dialogRef} onClose={onClose} aria-label="Leave balance details"
    onClick={(e) => { if (e.target === dialogRef.current) onClose() }}  // clic sur le fond grisé : on ferme
    className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-dvh w-[min(100vw,600px)] max-w-none overflow-y-auto border-l border-slate-200 bg-[#F8FAFC] p-0 shadow-2xl backdrop:bg-slate-900/40">
    {/* Le contenu n'existe que si le panneau est ouvert : il repart propre pour chaque collaborateur. */}
    {employeeId !== null && <PanelContent key={employeeId} employeeId={employeeId} onClose={onClose} onChanged={onChanged} />}
  </dialog>
}

function PanelContent({ employeeId, onClose, onChanged }: { employeeId: number; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<BalanceDetail | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    apiFetch(`/api/leaves/balances/${employeeId}/`)
      .then(async (response) => {
        if (!response.ok) throw new Error()
        setDetail(await response.json())
      })
      .catch(() => setFailed(true))
  }, [employeeId])

  return <div className="flex min-h-full flex-col">
    <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-slate-200 bg-white px-5 py-4">
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-semibold text-[#192646]">{detail?.employee ?? 'Leave balance'}</h2>
        {detail && <p className="text-xs text-slate-500">{detail.department} · {detail.pole} · hired {formatDate(detail.hire_date)}</p>}
      </div>
      <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="size-4" /></button>
    </header>

    {!detail
      ? <p className="px-5 py-12 text-center text-sm text-slate-500">{failed ? 'Could not load this balance. Please try again later.' : 'Loading...'}</p>
      : <div className="flex flex-col gap-4 p-5">
          {/* Le solde, en 4 chiffres (le plus important en premier). */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: 'Available', value: detail.available, strong: true },
              { label: 'Earned', value: detail.acquired },
              { label: 'Taken', value: detail.taken },
              { label: 'Pending', value: detail.pending },
            ].map((tile) => <div key={tile.label} className={cn('rounded-lg border px-3 py-2.5', tile.strong ? 'border-[#192646] bg-[#192646] text-white' : 'border-slate-200 bg-white')}>
              <p className={cn('text-[10px] font-semibold uppercase tracking-wide', tile.strong ? 'text-slate-300' : 'text-slate-500')}>{tile.label}</p>
              <p className={cn('text-lg font-semibold tabular-nums', !tile.strong && 'text-[#192646]', tile.strong && tile.value < 0 && 'text-red-300')}>{days(tile.value)}</p>
            </div>)}
          </div>

          <YearsCard years={detail.years} />
          <RightCard detail={detail} onSaved={(next) => { setDetail(next); onChanged() }} />
          <LeavesCard detail={detail} />
        </div>}
  </div>
}

const cardClass = 'rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]'

// Les tirelires : chaque année, ce qui a été gagné, utilisé, ce qui reste et jusqu'à quand.
function YearsCard({ years }: { years: YearPool[] }) {
  return <section className={cardClass}>
    <header className="border-b border-slate-100 px-4 py-3">
      <h3 className="text-sm font-semibold text-[#192646]">Days by year</h3>
      <p className="text-[11px] text-slate-500">Days earned in a year can be taken until December 31 of the next year. The oldest days are used first.</p>
    </header>
    {years.length === 0
      ? <p className="px-4 py-6 text-center text-xs text-slate-500">No full month worked yet.</p>
      : <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-4 py-2">Year</th><th className="px-2 py-2 text-right">Earned</th><th className="px-2 py-2 text-right">Used</th>
              <th className="px-2 py-2 text-right">Left</th><th className="px-4 py-2">Until</th>
            </tr>
          </thead>
          <tbody>
            {years.map((pool) => <tr key={pool.year} className="border-t border-slate-100">
              <td className="px-4 py-2 font-semibold text-[#192646]">{pool.year}</td>
              <td className="px-2 py-2 text-right tabular-nums text-slate-600">{days(pool.earned)}</td>
              <td className="px-2 py-2 text-right tabular-nums text-slate-600">{days(pool.used)}</td>
              <td className="px-2 py-2 text-right font-semibold tabular-nums text-[#192646]">{days(pool.left)}</td>
              <td className="px-4 py-2">
                <span className="text-slate-600">{formatDate(pool.valid_until)}</span>
                <span className={cn('ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold', STATE[pool.state].className)}>{STATE[pool.state].label}</span>
              </td>
            </tr>)}
          </tbody>
        </table>}
  </section>
}

// Le droit annuel : celui de la fiche depuis l'embauche, puis chaque changement à partir de sa date.
function RightCard({ detail, onSaved }: { detail: BalanceDetail; onSaved: (detail: BalanceDetail) => void }) {
  const [open, setOpen] = useState(false)
  const firstOfNextMonth = (() => { const now = new Date(); return isoDate(new Date(now.getFullYear(), now.getMonth() + 1, 1)) })()
  const [annualDays, setAnnualDays] = useState('')
  const [from, setFrom] = useState(firstOfNextMonth)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const response = await apiFetch(`/api/leaves/balances/${detail.employee_id}/right/`, {
        method: 'POST', body: JSON.stringify({ annual_days: annualDays, effective_from: from, reason }),
      })
      const data = await response.json().catch(() => ({}))
      if (response.ok) {
        onSaved(data)
        setOpen(false)
        setAnnualDays('')
        setReason('')
      } else {
        // 400 : {"detail": "La date est avant l'embauche."} ou {"reason": ["..."]} ; 403 : pas le droit.
        const first = data.detail ?? Object.values(data)[0]
        setError(Array.isArray(first) ? String(first[0]) : String(first ?? 'Something went wrong. Please try again.'))
      }
    } catch {
      setError('Cannot reach the server. Please try again later.')
    }
    setBusy(false)
  }

  return <section className={cardClass}>
    <header className="flex flex-wrap items-start gap-3 border-b border-slate-100 px-4 py-3">
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-[#192646]">Annual right</h3>
        <p className="text-[11px] text-slate-500">Today: <b className="font-semibold text-slate-700">{days(detail.yearly_right)} days / year</b> (with seniority). A change counts from its date only, never back.</p>
      </div>
      {detail.can_change_right && !open && <button type="button" onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg bg-[#23355d] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#192646]">
        <Plus className="size-3.5" /> Change
      </button>}
    </header>

    {/* L'histoire du droit : la fiche (depuis l'embauche), puis chaque changement. */}
    <ol className="px-4 py-3 text-xs">
      <li className="flex items-baseline gap-2 py-1">
        <span className="w-28 shrink-0 text-slate-500">From {formatDate(detail.hire_date)}</span>
        <span className="font-semibold text-[#192646]">{days(detail.base_right)} days</span>
        <span className="text-slate-400">· hire date (employee file)</span>
      </li>
      {detail.right_changes.map((change) => <li key={change.id} className="flex items-baseline gap-2 border-t border-slate-100 py-1">
        <span className="w-28 shrink-0 text-slate-500">From {formatDate(change.effective_from)}</span>
        <span className="font-semibold text-[#192646]">{days(change.annual_days)} days</span>
        <span className="min-w-0 text-slate-500">· {change.reason}{change.changed_by && <span className="text-slate-400"> · by {change.changed_by}</span>}</span>
      </li>)}
    </ol>

    {open && <form onSubmit={save} className="grid gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-3 sm:grid-cols-2">
      <div>
        <label htmlFor="right-days" className="block text-xs font-semibold text-slate-700">New right (days / year) <span className="text-red-500" aria-hidden>*</span></label>
        <input id="right-days" type="number" required min="0" step="0.5" value={annualDays} onChange={(e) => setAnnualDays(e.target.value)} placeholder="e.g. 30" className={controlClass} />
      </div>
      <div>
        <label htmlFor="right-from" className="block text-xs font-semibold text-slate-700">From <span className="text-red-500" aria-hidden>*</span></label>
        <input id="right-from" type="date" required min={detail.hire_date} value={from} onChange={(e) => setFrom(e.target.value)} className={controlClass} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="right-reason" className="block text-xs font-semibold text-slate-700">Reason <span className="text-red-500" aria-hidden>*</span></label>
        <input id="right-reason" required maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Promotion to manager" className={controlClass} />
      </div>
      {error && <p role="alert" className="text-xs font-medium text-red-600 sm:col-span-2">{error}</p>}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <button type="button" onClick={() => { setOpen(false); setError('') }} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
        <button type="submit" disabled={busy} className="flex items-center gap-1.5 rounded-lg bg-[#23355d] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#192646] disabled:opacity-60">
          {busy && <Loader2 className="size-3.5 animate-spin" />} Save
        </button>
      </div>
    </form>}
  </section>
}

// Tous ses congés (tous les types et statuts) : chaque ligne ouvre l'historique de la demande.
function LeavesCard({ detail }: { detail: BalanceDetail }) {
  return <section className={cardClass}>
    <header className="border-b border-slate-100 px-4 py-3">
      <h3 className="text-sm font-semibold text-[#192646]">Leaves</h3>
      <p className="text-[11px] text-slate-500">Every request, the most recent first. Only the annual leave is taken from the balance.</p>
    </header>
    {detail.leaves.length === 0
      ? <p className="px-4 py-6 text-center text-xs text-slate-500">No leave yet.</p>
      : <ul className="divide-y divide-slate-100">
          {detail.leaves.map((leave) => <li key={leave.id} className="flex items-center gap-3 px-4 py-2.5 text-xs">
            <div className="min-w-0 flex-1">
              <Link href={`/requests/${leave.request}`} className="font-semibold text-[#192646] hover:underline">{leave.leave_type_label}</Link>
              <p className="text-slate-500">{formatDate(leave.start_date)} → {formatDate(leave.end_date)} · {formatDays(leave.days)}</p>
            </div>
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', BADGE[leave.status])}>{leave.status_label}</span>
          </li>)}
        </ul>}
  </section>
}
