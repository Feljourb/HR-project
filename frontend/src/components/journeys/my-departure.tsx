'use client'

/*
 * "My departure" (/my-departure, 2026-11-24) : MA demande de départ, une page à part (avant : un bouton dans
 * "My tasks", mais un départ n'est pas une tâche, c'est une demande ; choix de l'utilisatrice : clair et simple).
 * Le lien du menu n'existe que si Admin RH le permet (NON par défaut, comme NOOR : on passe par son manager).
 * - pas de demande en cours : le formulaire (le composant partagé DepartureForm) ;
 * - une demande envoyée : son état en mots simples (en attente des RH / validée / refusée), sans formulaire.
 */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { CalendarDays, ChevronRight, DoorOpen } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import { frDate, type Departure, type DepartureOptions } from '@/lib/journeys'
import { DepartureForm } from './departure-form'

// L'état de la demande, dit simplement (la couleur suit : ambre = on attend, vert = validé, gris = fermé).
const STATUS: Record<Departure['status'], { label: string; text: string; tone: string }> = {
  IN_PROGRESS: { label: 'Waiting for HR', text: 'HR have your request. You will get a 🔔 and an email when they answer.', tone: 'bg-amber-50 text-amber-800' },
  APPROVED: { label: 'Approved', text: 'HR approved your departure. The departure tasks have started (give back the PC, the badge…): you may get some in My tasks.', tone: 'bg-emerald-50 text-emerald-700' },
  REJECTED: { label: 'Refused', text: 'HR refused this request. See their reason in the history.', tone: 'bg-slate-100 text-slate-600' },
  CANCELLED: { label: 'Cancelled', text: 'This request was cancelled.', tone: 'bg-slate-100 text-slate-600' },
}

export function MyDeparture() {
  const [options, setOptions] = useState<DepartureOptions | null>(null)
  const [mine, setMine] = useState<Departure[] | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(() => {
    Promise.all([
      apiFetch('/api/journeys/departures/options/').then((response) => (response.ok ? response.json() : Promise.reject())),
      apiFetch('/api/journeys/departures/?status=all').then((response) => (response.ok ? response.json() : Promise.reject())),
    ])
      .then(([opts, rows]: [DepartureOptions, Departure[]]) => {
        setOptions(opts)
        // Seulement MES départs (un manager voit aussi ceux de son équipe dans cette liste), le plus récent d'abord.
        setMine(rows.filter((row) => row.employee.id === opts.me).sort((a, b) => b.created_at.localeCompare(a.created_at)))
        setFailed(false)
      })
      .catch(() => setFailed(true))
  }, [])

  useEffect(() => { load() }, [load])

  // Une demande encore vivante (en attente ou validée) : on montre son état, pas un 2e formulaire.
  const current = mine?.find((row) => row.status === 'IN_PROGRESS' || row.status === 'APPROVED')
  const past = (mine ?? []).filter((row) => row !== current)

  return <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
    <div>
      <h1 className="text-lg font-semibold text-[#192646]">My departure</h1>
      <p className="text-xs text-slate-500">You are leaving the company: tell HR here. HR approve it, then everything is prepared for your last day.</p>
    </div>

    {failed && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">Could not load this page: refresh it.</p>}
    {!failed && (options === null || mine === null) && <p className="text-xs text-slate-500">Loading...</p>}

    {current && <DepartureCard departure={current} />}

    {options && mine && !current && (options.can_request_own
      ? <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <h2 className="mb-3 text-sm font-semibold text-[#192646]">Request my departure</h2>
          <DepartureForm options={options} self onDone={load} />
        </section>
      : <p className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">Please ask your manager: he declares the departure for you.</p>)}

    {past.length > 0 && <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Earlier requests</h2>
      <div className="flex flex-col gap-2">{past.map((row) => <DepartureCard key={row.id} departure={row} small />)}</div>
    </section>}
  </div>
}

/** Une demande de départ : le type, le dernier jour, l'état en mots simples, et le lien vers son historique. */
function DepartureCard({ departure, small }: { departure: Departure; small?: boolean }) {
  const status = STATUS[departure.status]
  return <section className={cn('rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]', small && 'opacity-70')}>
    <div className="flex flex-wrap items-start gap-3">
      <span className="flex size-9 items-center justify-center rounded-lg bg-[#23355d]/5 text-[#23355d]"><DoorOpen className="size-4" aria-hidden /></span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[#192646]">{departure.type_label}</p>
        <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
          <CalendarDays className="size-3.5" aria-hidden /> Last day: <span className="font-medium text-slate-700">{frDate(departure.last_day)}</span>
          <span className="text-slate-300">·</span> sent on {frDate(departure.created_at.slice(0, 10))}
        </p>
      </div>
      <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-semibold', status.tone)}>{status.label}</span>
    </div>
    {!small && <p className="mt-3 text-xs text-slate-600">{status.text}</p>}
    <Link href={`/requests/${departure.request}?from=requests`} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[#23355d] hover:underline">
      View the history <ChevronRight className="size-3.5" />
    </Link>
  </section>
}
