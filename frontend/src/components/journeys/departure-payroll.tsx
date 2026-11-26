'use client'

/*
 * "For payroll & CNSS" : TOUT ce que la paie et la CNSS doivent savoir quand quelqu'un part (2026-11-25, Code du
 * travail). Panneau d'Arrivals & departures, RH seulement (des éléments de paie ; le serveur répond 404 aux autres).
 * L'application ne connaît pas les salaires : elle donne les éléments en JOURS / HEURES, la paie fait l'argent.
 * - Congés à payer au dernier jour (art. 251) + les congés qui dépassent le dernier jour ;
 * - Préavis non respecté : les jours à retenir (art. 51) ;
 * - Indemnité de licenciement en heures (art. 52-53) ;
 * - Les données de la déclaration de sortie CNSS (Damancom).
 * "Copy for payroll" : tout en texte, à coller dans un email à la paie.
 * Django calcule tout (journeys/exit_summary.py) : la page n'affiche que le résultat.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Banknote, Copy, Palmtree, ShieldCheck, TriangleAlert } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { formatDays } from '@/lib/leaves'
import { cn } from '@/lib/utils'
import { frDate, NOTICE_STATUS, type NoticeStatus, type Payroll } from '@/lib/journeys'

const hours = (value: string) => `${Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} h`

export function DeparturePayroll({ departureId, version }: { departureId: number; version: string }) {
  const [data, setData] = useState<Payroll | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    apiFetch(`/api/journeys/departures/${departureId}/payroll/`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))  // pas RH : 404 -> rien à montrer
      .then(setData)
      .catch(() => { /* rien à montrer */ })
    return () => controller.abort()
  }, [departureId, version])

  if (!data) return null
  const { leave, notice, indemnity, cnss } = data
  const available = Number(leave.available)
  const adjusted = Number(leave.adjusted)

  async function copy() {
    const lines = [
      `Départ : ${cnss.name} (${cnss.u_number ?? '—'}) · CIN ${cnss.cin} · CNSS ${cnss.cnss_number || '—'}`,
      `Motif : ${cnss.reason} · Embauche : ${frDate(cnss.hire_date)} · Dernier jour : ${frDate(cnss.last_day)}`,
      `Congés à payer au dernier jour : ${leave.available} jour(s)`,
      `Préavis : ${notice.status_label || 'à décider'}${notice.days_to_deduct ? ` · ${notice.days_to_deduct} jour(s) à retenir` : ''}`,
      `Indemnité de licenciement : ${indemnity.applies ? `${indemnity.hours} heures de salaire (${indemnity.years} ans d'ancienneté)` : 'aucune'}`,
    ]
    try { await navigator.clipboard.writeText(lines.join('\n')); setCopied(true); setTimeout(() => setCopied(false), 2500) } catch { /* pas de presse-papiers */ }
  }

  return <section className="mt-3 flex flex-col gap-3 border-t border-slate-100 pt-3">
    <div className="flex flex-wrap items-center gap-2">
      <p className="flex flex-1 items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><Banknote className="size-3.5" aria-hidden /> For payroll &amp; CNSS</p>
      <button type="button" onClick={() => void copy()}
        className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-[#23355d] hover:border-[#23355d]/40">
        <Copy className="size-3.5" aria-hidden /> {copied ? 'Copied ✓' : 'Copy for payroll'}
      </button>
    </div>
    <p className="-mt-1 text-[11px] text-slate-500">The app gives days and hours; payroll turns them into money for the final pay (“solde de tout compte”).</p>

    {/* 1. Les congés à payer */}
    <div className="flex flex-col gap-1">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700"><Palmtree className="size-3.5 text-slate-400" aria-hidden /> Leave on the last day ({frDate(leave.on)})</p>
      <p className={cn('text-sm font-semibold', available > 0 ? 'text-emerald-700' : available < 0 ? 'text-amber-800' : 'text-slate-700')}>
        {available > 0 && <>{formatDays(available)} to pay</>}
        {available === 0 && <>Nothing to pay: every day earned was taken.</>}
        {available < 0 && <>{formatDays(-available)} taken too many: payroll deducts them</>}
      </p>
      <p className="text-[11px] text-slate-500">
        Earned {formatDays(Number(leave.acquired))}{adjusted !== 0 ? ` · HR corrections ${adjusted > 0 ? '+' : ''}${formatDays(adjusted)}` : ''}
        {' '}· taken {formatDays(Number(leave.taken))} · in approval {formatDays(Number(leave.pending))} · lost (expired) {formatDays(Number(leave.expired))}.
        {' '}Full months only, like the Leave module; payroll adds the last month if it is not complete.
      </p>
      {leave.leaves_after.length > 0 && <div className="flex flex-col gap-1 rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
        <p className="flex items-center gap-1.5 font-semibold"><TriangleAlert className="size-3.5" aria-hidden />
          {leave.leaves_after.length === 1 ? 'A leave goes past the last day' : `${leave.leaves_after.length} leaves go past the last day`}:
          {' '}cancel it, or ask the employee for a shorter one (they were told).</p>
        <ul className="flex flex-col gap-0.5 pl-5">
          {leave.leaves_after.map((row) => <li key={row.request}>
            <Link href={`/requests/${row.request}?from=onboarding`} className="underline underline-offset-2 hover:text-amber-950">
              {row.type}, {frDate(row.start_date)} → {frDate(row.end_date)} ({formatDays(Number(row.days))}, {row.status === 'APPROVED' ? 'approved' : 'in approval'})
            </Link>
          </li>)}
        </ul>
      </div>}
    </div>

    {/* 2. Le préavis à retenir */}
    <div className="text-xs">
      <p className="font-semibold text-slate-700">Notice</p>
      {/* En anglais comme la page (2026-11-26 : "Respecté" en français détonnait) ; le texte copié pour la paie reste en français. */}
      <p className="text-slate-600">{notice.status ? NOTICE_STATUS[notice.status as NoticeStatus] : 'To decide (see above)'}
        {notice.days_to_deduct > 0 && <span className="font-semibold text-amber-800"> · {formatDays(notice.days_to_deduct)} to deduct from the last pay (art. 51)</span>}
        {notice.days_to_deduct === 0 && notice.status && notice.status !== 'NOT_RESPECTED' && ' · nothing to deduct'}
      </p>
    </div>

    {/* 3. L'indemnité de licenciement */}
    <div className="text-xs">
      <p className="font-semibold text-slate-700">Dismissal indemnity</p>
      {indemnity.applies
        ? <>
            <p className="text-sm font-semibold text-[#192646]">{hours(indemnity.hours)} of salary <span className="text-xs font-normal text-slate-500">({indemnity.years} years of seniority · art. 53)</span></p>
            <p className="text-[11px] text-slate-500">{indemnity.detail.map((row) => `${row.years} y × ${hours(row.hours_per_year)}`).join(' + ')}. Payroll: hours × hourly salary.</p>
          </>
        : <p className="text-slate-500">None. {indemnity.reason}</p>}
    </div>

    {/* 4. La CNSS */}
    <div className="text-xs">
      <p className="flex items-center gap-1.5 font-semibold text-slate-700"><ShieldCheck className="size-3.5 text-slate-400" aria-hidden /> CNSS exit declaration (Damancom)</p>
      <p className="text-slate-600">CNSS n° <span className="font-semibold">{cnss.cnss_number || '— (missing in the employee file)'}</span> · CIN {cnss.cin} · hired {frDate(cnss.hire_date)} · last day {frDate(cnss.last_day)} · {cnss.reason}</p>
      <p className="text-[11px] text-slate-500">Damancom has no connection with other software: HR declare it there, then tick the task “Déclarer la sortie à la CNSS”.</p>
    </div>
  </section>
}
