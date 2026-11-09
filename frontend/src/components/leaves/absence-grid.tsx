'use client'

/*
 * La grille "qui est absent quand" (P2), partagée par les deux calendriers :
 * - sur la carte d'un congé dans Team approvals (les jours de la demande, l'équipe du demandeur) ;
 * - la page "Team calendar" (mon équipe, un mois entier).
 * Une ligne par personne, une colonne par jour. Les jours non travaillés (dimanche, férié) sont grisés ;
 * aujourd'hui est marqué ; les jours où plus de la moitié de l'équipe serait absente ont un point ambre.
 * Vie privée : seulement "absent" (accepté / en attente), jamais le type de congé (Django ne l'envoie pas).
 */
import { cn } from '@/lib/utils'
import { isoDate } from '@/lib/leaves'

export type GridCell = { state: 'THIS' | 'APPROVED' | 'IN_PROGRESS'; half: boolean }
export type GridDay = { date: string; off: boolean; holiday: string | null }
export type GridPerson = { id: number; name: string; cells: Record<string, GridCell>; is_requester?: boolean; is_me?: boolean }
export type GridBusy = { date: string; away: number; team: number }

// La couleur de chaque case : la demande qu'on valide (la couleur de la marque), accepté (foncé), en attente (hachuré).
export const CELL: Record<GridCell['state'], string> = {
  THIS: 'bg-[#23355d]',
  APPROVED: 'bg-slate-500',
  IN_PROGRESS: 'bg-[repeating-linear-gradient(45deg,#cbd5e1_0_3px,#f1f5f9_3px_6px)] ring-1 ring-inset ring-slate-300',
}
const LABEL: Record<GridCell['state'], string> = { THIS: 'this request', APPROVED: 'away (approved)', IN_PROGRESS: 'away (pending)' }

export const weekday = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })

/** La légende (seulement les couleurs utiles : "This request" n'existe que sur une carte de validation). */
export function GridLegend({ withThis }: { withThis?: boolean }) {
  return <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
    {withThis && <span className="flex items-center gap-1"><span className={cn('size-2.5 rounded-sm', CELL.THIS)} />This request</span>}
    <span className="flex items-center gap-1"><span className={cn('size-2.5 rounded-sm', CELL.APPROVED)} />Approved</span>
    <span className="flex items-center gap-1"><span className={cn('size-2.5 rounded-sm', CELL.IN_PROGRESS)} />Pending</span>
    <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-slate-100" />Sunday / holiday</span>
  </div>
}

export function AbsenceGrid({ days, people, busy, compact }: { days: GridDay[]; people: GridPerson[]; busy: GridBusy[]; compact?: boolean }) {
  const today = isoDate(new Date())
  const busyDays = new Set(busy.map((day) => day.date))
  const cellWidth = compact ? 'w-8 min-w-8' : 'w-7 min-w-7'
  return <div className="overflow-x-auto">
    <table className="border-separate border-spacing-x-0.5 border-spacing-y-1 text-[11px]">
      <thead>
        <tr>
          <th className="sticky left-0 z-10 w-40 min-w-40 bg-white text-left font-normal"><span className="sr-only">Person</span></th>
          {days.map((day) => <th key={day.date} scope="col" title={day.holiday ?? undefined}
            className={cn(cellWidth, 'rounded text-center font-medium leading-tight', day.off ? 'text-slate-300' : 'text-slate-500',
              day.date === today && 'bg-[#23355d]/10 text-[#192646]')}>
            <span className="block text-[9px] uppercase">{weekday(day.date).slice(0, compact ? 3 : 2)}</span>
            {Number(day.date.slice(8, 10))}
            {/* Plus de la moitié de l'équipe absente ce jour-là : un point ambre (le détail sous la grille). */}
            <span className={cn('mx-auto mt-0.5 block size-1 rounded-full', busyDays.has(day.date) ? 'bg-amber-500' : 'bg-transparent')} aria-hidden />
          </th>)}
        </tr>
      </thead>
      <tbody>
        {people.map((person) => <tr key={person.id}>
          <th scope="row" className="sticky left-0 z-10 max-w-40 truncate bg-white pr-2 text-left font-normal">
            <span className={cn(person.is_requester || person.is_me ? 'font-semibold text-[#192646]' : 'text-slate-600')}>{person.name}</span>
            {person.is_me && <span className="ml-1 text-[10px] text-slate-400">(me)</span>}
          </th>
          {days.map((day) => {
            const cell = person.cells[day.date]
            return <td key={day.date} className="p-0">
              <span title={cell ? `${person.name}: ${LABEL[cell.state]}${cell.half ? ', half day' : ''}` : day.holiday ?? undefined}
                className={cn('block h-5 rounded', cellWidth, day.off ? 'bg-slate-100' : cell ? CELL[cell.state] : 'bg-slate-50 ring-1 ring-inset ring-slate-100',
                  cell?.half && 'opacity-50')} />
            </td>
          })}
        </tr>)}
      </tbody>
    </table>
  </div>
}
