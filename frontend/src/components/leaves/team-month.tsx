'use client'

/*
 * P2 step 2b : la page "Team calendar" (managers) : MON équipe sur un mois, à tout moment.
 * Pour PRÉVOIR (qui est absent ce mois-ci ? quel jour pour une réunion ?), pas seulement quand une demande arrive
 * (pour ça : le petit calendrier sur la carte, dans Team approvals).
 * Mon équipe = les personnes dont je suis le N+1 (la règle du moteur), et moi en premier.
 * Vie privée : seulement "absent", jamais le type de congé. Lu dans /api/leaves/team-calendar/month/?month=AAAA-MM.
 */
import { useEffect, useState } from 'react'
import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import { BusyWarning } from '@/components/requests/team-calendar'
import { AbsenceGrid, GridLegend, type GridBusy, type GridDay, type GridPerson } from './absence-grid'

type Month = { month: string; team_size: number; days: GridDay[]; people: GridPerson[]; busy: GridBusy[] }

const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`

export function TeamMonth() {
  const [month, setMonth] = useState(() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1) })
  const key = monthKey(month)
  const [loaded, setLoaded] = useState<Month | null>(null)
  const [failedKey, setFailedKey] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    apiFetch(`/api/leaves/team-calendar/month/?month=${key}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error()
        setLoaded(await response.json())
      })
      .catch(() => { if (!controller.signal.aborted) setFailedKey(key) })
    return () => controller.abort()
  }, [key])

  const current = loaded?.month === key ? loaded : null
  const monthName = month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  // Combien de personnes ont au moins un jour d'absence ce mois-ci (moi compris).
  const awayPeople = current ? current.people.filter((person) => Object.keys(person.cells).length > 0).length : 0
  const move = (months: number) => setMonth((old) => new Date(old.getFullYear(), old.getMonth() + months, 1))

  return <div className="flex flex-col gap-4">
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-lg font-semibold text-[#192646]">Team calendar</h1>
        <p className="text-xs text-slate-500">Who in your team is away, month by month. Plan meetings and approvals ahead.</p>
      </div>
      <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-1 py-0.5">
        <button type="button" aria-label="Previous month" onClick={() => move(-1)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"><ChevronLeft className="size-4" /></button>
        <h2 aria-live="polite" className="min-w-36 text-center text-sm font-semibold capitalize text-[#192646]">{monthName}</h2>
        <button type="button" aria-label="Next month" onClick={() => move(1)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"><ChevronRight className="size-4" /></button>
      </div>
    </div>

    <section className="rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      {current === null
        ? <p className="px-4 py-12 text-center text-sm text-slate-500">{failedKey === key ? 'Could not load the calendar. Please try again later.' : 'Loading...'}</p>
        : current.people.length === 0
          ? <div className="px-4 py-12 text-center text-sm text-slate-500">
              <CalendarRange className="mx-auto mb-2 size-6 text-[#8C6D52]" aria-hidden />
              You have no team: nobody has you as their N+1.
            </div>
          : <>
              <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
                <p className="text-xs text-slate-600">
                  <b className="font-semibold text-[#192646]">{current.team_size}</b> {current.team_size === 1 ? 'person' : 'people'} in your team ·{' '}
                  <b className={cn('font-semibold', awayPeople ? 'text-[#192646]' : 'text-slate-400')}>{awayPeople}</b> away at least one day this month
                </p>
                <div className="ml-auto"><GridLegend /></div>
              </div>
              <div className="px-4 py-3"><AbsenceGrid days={current.days} people={current.people} busy={current.busy} /></div>
              <BusyWarning busy={current.busy} />
            </>}
    </section>
  </div>
}
