'use client'

/*
 * P2 step 2 : le calendrier de l'équipe, sur la carte d'un CONGÉ dans Team approvals.
 * Pour les jours de la demande : chaque personne du service, et qui est absent chaque jour
 * (cette demande, un congé accepté, ou en attente). Un avertissement quand plus de la moitié de l'équipe
 * serait absente : le valideur décide quand même (ce n'est qu'une aide).
 * Vie privée : seulement "absent", jamais le type de congé. Lu dans /api/leaves/team-calendar/?request=<id>.
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, UsersRound } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { formatDate } from '@/lib/leaves'
import { cn } from '@/lib/utils'

type Cell = { state: 'THIS' | 'APPROVED' | 'IN_PROGRESS'; half: boolean }
type Calendar = {
  department: string
  start: string
  end: string
  cut: boolean  // congé plus long qu'un mois : seul le premier mois est montré
  days: { date: string; off: boolean; holiday: string | null }[]
  people: { id: number; name: string; is_requester: boolean; cells: Record<string, Cell> }[]
  busy: { date: string; away: number; team: number }[]
}

// La couleur de chaque case : cette demande (la couleur de la marque), accepté (foncé), en attente (hachuré clair).
const CELL: Record<Cell['state'], string> = {
  THIS: 'bg-[#23355d]',
  APPROVED: 'bg-slate-500',
  IN_PROGRESS: 'bg-[repeating-linear-gradient(45deg,#cbd5e1_0_3px,#f1f5f9_3px_6px)] ring-1 ring-inset ring-slate-300',
}

const weekday = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })

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

  const maxAway = Math.max(0, ...calendar.busy.map((day) => day.away))
  return <div className="mb-3 rounded-lg border border-slate-200 bg-white">
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
      <UsersRound className="size-3.5 text-slate-400" aria-hidden />
      <p className="text-xs font-semibold text-[#192646]">Team of {calendar.department}</p>
      <p className="text-[11px] text-slate-500">· {formatDate(calendar.start)} → {formatDate(calendar.end)}{calendar.cut && ' (first month)'}</p>
      {/* La légende, discrète, à droite. */}
      <div className="ml-auto flex items-center gap-3 text-[10px] text-slate-500">
        <span className="flex items-center gap-1"><span className={cn('size-2.5 rounded-sm', CELL.THIS)} />This request</span>
        <span className="flex items-center gap-1"><span className={cn('size-2.5 rounded-sm', CELL.APPROVED)} />Approved</span>
        <span className="flex items-center gap-1"><span className={cn('size-2.5 rounded-sm', CELL.IN_PROGRESS)} />Pending</span>
      </div>
    </div>

    <div className="overflow-x-auto px-3 py-2">
      <table className="border-separate border-spacing-x-0.5 border-spacing-y-1 text-[11px]">
        <thead>
          <tr>
            <th className="w-36 min-w-36 text-left font-normal"><span className="sr-only">Person</span></th>
            {calendar.days.map((day) => <th key={day.date} scope="col" title={day.holiday ?? undefined}
              className={cn('w-8 min-w-8 text-center font-medium leading-tight', day.off ? 'text-slate-300' : 'text-slate-500')}>
              <span className="block text-[9px] uppercase">{weekday(day.date)}</span>{Number(day.date.slice(8, 10))}
            </th>)}
          </tr>
        </thead>
        <tbody>
          {calendar.people.map((person) => <tr key={person.id}>
            <th scope="row" className="max-w-36 truncate pr-2 text-left font-normal">
              <span className={cn(person.is_requester ? 'font-semibold text-[#192646]' : 'text-slate-600')}>{person.name}</span>
            </th>
            {calendar.days.map((day) => {
              const cell = person.cells[day.date]
              // Un jour non travaillé (dimanche, férié) : une case grisée, personne n'y "manque".
              return <td key={day.date} className="p-0">
                <span title={cell ? `${person.name}: ${cell.state === 'THIS' ? 'this request' : cell.state === 'APPROVED' ? 'away (approved)' : 'away (pending)'}${cell.half ? ', half day' : ''}` : undefined}
                  className={cn('block h-5 w-8 rounded', day.off ? 'bg-slate-100' : cell ? CELL[cell.state] : 'bg-slate-50 ring-1 ring-inset ring-slate-100',
                    cell?.half && 'opacity-50')} />
              </td>
            })}
          </tr>)}
        </tbody>
      </table>
    </div>

    {/* L'avertissement : plus de la moitié de l'équipe absente ces jours-là (le valideur décide). */}
    {calendar.busy.length > 0 && <p className="flex items-start gap-1.5 border-t border-amber-100 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-800">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        More than half of the team would be away on {calendar.busy.map((day) => `${weekday(day.date)} ${formatDate(day.date).slice(0, 5)}`).join(', ')}
        {' '}(up to {maxAway} of {calendar.busy[0].team} people).
      </span>
    </p>}
  </div>
}
