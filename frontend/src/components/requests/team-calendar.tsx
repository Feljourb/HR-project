'use client'

/*
 * P2 step 2 : le calendrier de l'équipe, sur la carte d'un CONGÉ dans Team approvals.
 * Pour les jours de la demande : chaque personne du service, et qui est absent chaque jour
 * (cette demande, un congé accepté, ou en attente). Un avertissement quand plus de la moitié de l'équipe
 * serait absente : le valideur décide quand même (ce n'est qu'une aide).
 * Vie privée : seulement "absent", jamais le type de congé. Lu dans /api/leaves/team-calendar/?request=<id>.
 * La grille est partagée avec la page "Team calendar" (components/leaves/absence-grid.tsx).
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, Paperclip, UsersRound } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { formatDate } from '@/lib/leaves'
import { AbsenceGrid, GridLegend, weekday, type GridBusy, type GridDay, type GridPerson } from '@/components/leaves/absence-grid'

type Calendar = {
  department: string
  start: string
  end: string
  cut: boolean  // congé plus long qu'un mois : seul le premier mois est montré
  days: GridDay[]
  people: GridPerson[]
  busy: GridBusy[]
  document: { required: boolean; received: boolean }  // P2 step 4 : le N+1 voit seulement reçu / manquant
}

export function TeamCalendar({ requestId }: { requestId: number }) {
  const [calendar, setCalendar] = useState<Calendar | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    apiFetch(`/api/leaves/team-calendar/?request=${requestId}`)
      .then(async (response) => {
        if (!response.ok) throw new Error()
        setCalendar(await response.json())
      })
      .catch(() => setFailed(true))
  }, [requestId])

  if (failed) return null  // pas de calendrier (ex. une ancienne demande de démo sans dates) : la carte reste utilisable
  if (!calendar) return <p className="mb-3 text-[11px] text-slate-400">Loading the team calendar...</p>

  return <div className="mb-3 rounded-lg border border-slate-200 bg-white">
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
      <UsersRound className="size-3.5 text-slate-400" aria-hidden />
      <p className="text-xs font-semibold text-[#192646]">Team of {calendar.department}</p>
      <p className="text-[11px] text-slate-500">· {formatDate(calendar.start)} → {formatDate(calendar.end)}{calendar.cut && ' (first month)'}</p>
      {/* P2 step 4 : le certificat, reçu ou manquant (le N+1 ne l'ouvre pas : une donnée de santé, pour les RH). */}
      {calendar.document.required && (calendar.document.received
        ? <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700"><Paperclip className="size-3" aria-hidden />Document received</span>
        : <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700"><AlertTriangle className="size-3" aria-hidden />Document missing</span>)}
      <div className="ml-auto"><GridLegend withThis /></div>
    </div>
    <div className="px-3 py-2"><AbsenceGrid days={calendar.days} people={calendar.people} busy={calendar.busy} compact /></div>
    <BusyWarning busy={calendar.busy} />
  </div>
}

/** L'avertissement : plus de la moitié de l'équipe absente ces jours-là (le valideur / le manager décide). */
export function BusyWarning({ busy }: { busy: GridBusy[] }) {
  if (busy.length === 0) return null
  const maxAway = Math.max(...busy.map((day) => day.away))
  return <p className="flex items-start gap-1.5 border-t border-amber-100 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-800">
    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
    <span>
      More than half of the team would be away on {busy.map((day) => `${weekday(day.date)} ${formatDate(day.date).slice(0, 5)}`).join(', ')}
      {' '}(up to {maxAway} of {busy[0].team} people).
    </span>
  </p>
}
