'use client'

/*
 * Le PRÉAVIS d'un départ (2026-11-25, Code du travail art. 43 + décret 2004) : UN composant partagé (règle "one shared
 * thing = one component"), affiché dans le formulaire (avant d'envoyer), la carte de Team approvals et le panneau
 * d'Arrivals & departures. Django calcule tout (journeys/notice.py) : la page ne fait que l'afficher.
 * - NoticeFacts : "Legal notice: 1 month (Employees and workers · 3 years) → last day at the earliest 25/12/2026",
 *   puis vert "Respected" ou ambre "15 days short" (jamais bloquant : les RH décident).
 * - NoticeDecision : les RH choisissent le statut (respecté / dispensé par l'employeur / non respecté) et peuvent
 *   corriger le début (ex. la date de la lettre).
 */
import { useEffect, useState } from 'react'
import { CheckCircle2, Hourglass, Loader2, TriangleAlert } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import { DatePicker } from '@/components/ui/date-picker'
import { controlClass } from '@/components/ui/control-class'
import { errorOf, frDate, NOTICE_STATUS, noticeLabel, type Departure, type NoticePreview, type NoticeStatus } from '@/lib/journeys'

// Les groupes de la loi, en anglais comme la page.
const GROUP: Record<string, string> = { EXECUTIVE: 'Managers (cadres)', OTHER: 'Employees and workers' }

type Facts = {
  amount: number | null; unit: string; group: string; years: number | null; until: string | null; lastDay: string
  status?: '' | NoticeStatus; statusLabel?: string; decidedBy?: string | null
  serious?: boolean   // licenciement pour faute grave : le préavis tombe à cause de la faute, pas du type
}

/** Le préavis en une ou deux lignes : la durée légale, le dernier jour au plus tôt, et si le dernier jour choisi va. */
export function NoticeFacts({ amount, unit, group, years, until, lastDay, status, decidedBy, serious }: Facts) {
  if (!until) {
    // (2026-11-26) Faute grave : dire POURQUOI il n'y a pas de préavis (un licenciement en a un d'habitude).
    return <p className="flex items-center gap-1.5 text-xs text-slate-500">
      <Hourglass className="size-3.5 shrink-0 text-slate-400" aria-hidden />
      {serious ? 'No notice: serious misconduct (art. 39).' : 'No notice period for this type of departure.'}
    </p>
  }
  const short = lastDay && lastDay < until ? daysBetween(lastDay, until) : 0
  return <div className="flex flex-col gap-1 text-xs">
    <p className="flex items-start gap-1.5 text-slate-700">
      <Hourglass className="mt-0.5 size-3.5 shrink-0 text-slate-400" aria-hidden />
      <span>Legal notice: <span className="font-semibold text-[#192646]">{noticeLabel(amount, unit)}</span>
        <span className="text-slate-500"> ({GROUP[group] ?? group}{years !== null ? ` · ${years} year${years === 1 ? '' : 's'} of seniority` : ''})</span>
        {' '}→ last day at the earliest <span className="font-semibold text-[#192646]">{frDate(until)}</span>.</span>
    </p>
    {/* Ce que les RH ont décidé, sinon ce que dit le calcul. */}
    {status && status !== 'NONE'
      ? <p className={cn('flex items-center gap-1.5 font-medium', status === 'RESPECTED' ? 'text-emerald-700' : 'text-amber-800')}>
          {status === 'RESPECTED' ? <CheckCircle2 className="size-3.5" aria-hidden /> : <TriangleAlert className="size-3.5" aria-hidden />}
          {NOTICE_STATUS[status]}{short > 0 ? ` (${short} day${short > 1 ? 's' : ''} short)` : ''}{decidedBy ? ` · decided by ${decidedBy}` : ''}
        </p>
      : short > 0
        ? <p className="flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 font-medium text-amber-800">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            The last day is {short} day{short > 1 ? 's' : ''} before the end of the notice. HR decide: waived by the company, or not respected by the employee.
          </p>
        : lastDay
          ? <p className="flex items-center gap-1.5 font-medium text-emerald-700"><CheckCircle2 className="size-3.5" aria-hidden /> The notice is respected.</p>
          : null}
  </div>
}

/** Le préavis d'une demande de départ (carte de validation, panneau) : les faits enregistrés à la demande. */
export function DepartureNotice({ departure }: { departure: Departure }) {
  return <NoticeFacts amount={departure.notice_amount} unit={departure.notice_unit} group={departure.notice_group}
    years={departure.notice_years} until={departure.notice_until} lastDay={departure.last_day}
    status={departure.notice_status} decidedBy={departure.notice_decided_by_name}
    serious={departure.departure_type === 'DISMISSAL' && departure.serious_misconduct} />
}

/** Les RH du pôle : choisir le statut du préavis (et corriger son début). Sert au solde de tout compte (la paie). */
export function NoticeDecision({ departure, onChanged }: { departure: Departure; onChanged: () => void }) {
  const [status, setStatus] = useState<string>(departure.notice_status === 'NONE' ? '' : departure.notice_status)
  const [start, setStart] = useState(departure.notice_start ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  if (!departure.can_decide_notice || !departure.notice_until) return null
  const changed = status !== departure.notice_status || start !== (departure.notice_start ?? '')

  async function save() {
    setBusy(true)
    setError('')
    setSaved(false)
    const response = await apiFetch(`/api/journeys/departures/${departure.id}/notice/`, {
      method: 'POST', body: JSON.stringify({ status, start: start || null }),
    }).catch(() => null)
    setBusy(false)
    if (response?.ok) { setSaved(true); onChanged() } else setError(response ? await errorOf(response) : 'The server does not answer. Try again.')
  }

  return <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
    <p className="text-xs font-semibold text-slate-700">HR decision on the notice</p>
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <label className="text-[11px] font-semibold text-slate-600">Notice
        <select value={status} onChange={(e) => { setStatus(e.target.value); setSaved(false) }} className={controlClass}>
          <option value="">To decide…</option>
          {(['RESPECTED', 'WAIVED', 'NOT_RESPECTED'] as NoticeStatus[]).map((value) => <option key={value} value={value}>{NOTICE_STATUS[value]}</option>)}
        </select>
      </label>
      <div>
        <label htmlFor={`notice-start-${departure.id}`} className="text-[11px] font-semibold text-slate-600">Notice starts on</label>
        <DatePicker id={`notice-start-${departure.id}`} value={start} onChange={(value) => { setStart(value); setSaved(false) }} max={departure.last_day} />
      </div>
    </div>
    {/* (2026-11-25) mots réécrits : "payroll takes the missing days into account" n'était pas clair. */}
    <ul className="flex flex-col gap-0.5 text-[11px] text-slate-500">
      <li><span className="font-medium text-slate-600">Respected</span> = the employee works until the end of the notice. Nothing to do.</li>
      <li><span className="font-medium text-slate-600">Waived</span> = the company agrees to let the employee leave earlier. Nobody pays anything.</li>
      <li><span className="font-medium text-slate-600">Not respected</span> = the employee leaves earlier without the company’s agreement. The missing days are taken from the last pay (e.g. 10 days ≈ 1/3 of a monthly salary; payroll computes the amount).</li>
      <li><span className="font-medium text-slate-600">Notice starts on</span> = the day of the request. Change it if the letter arrived earlier.</li>
    </ul>
    {error && <p role="alert" className="text-[11px] font-medium text-red-600">{error}</p>}
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => void save()} disabled={busy || !status || !changed}
        className="flex items-center gap-1.5 rounded-md bg-[#23355d] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#192646] disabled:opacity-50">
        {busy && <Loader2 className="size-3.5 animate-spin" />} Save
      </button>
      {saved && <span role="status" className="text-xs font-medium text-emerald-700">✓ Saved</span>}
    </div>
  </div>
}

/** MON préavis, si je démissionnais aujourd'hui (2026-11-25, transparence : connaître ses règles AVANT de décider).
 *  undefined = en chargement ; null = pas de fiche / erreur (rien à montrer). */
export function useMyNotice() {
  const [mine, setMine] = useState<NoticePreview | null | undefined>(undefined)
  useEffect(() => {
    const controller = new AbortController()
    apiFetch('/api/journeys/departures/my-notice/', { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then(setMine)
      .catch(() => { if (!controller.signal.aborted) setMine(null) })
    return () => controller.abort()
  }, [])
  return mine
}

/** "1 month (Employees and workers · 3 years). If you resigned today: last day at the earliest 25/12/2026." */
export function MyNoticeText({ mine }: { mine: NoticePreview }) {
  if (!mine.applies) return <>No notice period.</>
  return <>
    <span className="font-semibold">{noticeLabel(mine.amount, mine.unit)}</span>
    <span className="text-slate-500"> ({GROUP[mine.group] ?? mine.group} · {mine.years} year{mine.years === 1 ? '' : 's'} of seniority).</span>
    {' '}If you resigned today: last day at the earliest <span className="font-semibold">{frDate(mine.until)}</span>.
  </>
}

/** Le nombre de jours entre deux dates "AAAA-MM-JJ" (b après a). */
function daysBetween(a: string, b: string) {
  const toDay = (value: string) => { const [y, m, d] = value.split('-').map(Number); return Date.UTC(y, m - 1, d) }
  return Math.round((toDay(b) - toDay(a)) / 86_400_000)
}
