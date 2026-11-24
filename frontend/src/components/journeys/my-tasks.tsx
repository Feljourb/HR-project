'use client'

/*
 * "My tasks" (/my-tasks, tout le monde) : MES tâches pour préparer une arrivée ou un départ (standard Workday
 * "My tasks" : une seule boîte). Ex. l'IT : "Préparer le PC de Sara avant le 28/11" ; le manager : "Préparer
 * le bureau" ; la nouvelle recrue : "Apporter CIN, RIB...".
 * Groupées par personne (qui arrive / part), la plus proche d'abord. Deux pilules : To do / Done.
 */
import { useCallback, useEffect, useState } from 'react'
import { ListTodo } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { MyTask } from '@/lib/journeys'
import { JourneyWho } from './journey-who'
import { TaskRow } from './task-row'

type Filter = 'open' | 'done'

export function MyTasks() {
  const [filter, setFilter] = useState<Filter>('open')
  const [tasks, setTasks] = useState<MyTask[] | null>(null)
  const [failed, setFailed] = useState(false)
  // (2026-11-24) "Request my departure" n'est plus ici : un départ est une DEMANDE, pas une tâche -> page "My departure".

  const load = useCallback((which: Filter) => {
    apiFetch(`/api/journeys/tasks/?status=${which}`)
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((rows: MyTask[]) => { setTasks(rows); setFailed(false) })
      .catch(() => setFailed(true))
  }, [])

  useEffect(() => { load(filter) }, [filter, load])

  // Une carte par parcours (Sara arrive, Karim part...), dans l'ordre : la plus proche d'abord.
  const groups = new Map<number, MyTask[]>()
  for (const task of tasks ?? []) groups.set(task.journey.id, [...(groups.get(task.journey.id) ?? []), task])
  const cards = [...groups.values()].sort((a, b) => (filter === 'open'
    ? a[0].journey.day.localeCompare(b[0].journey.day) : b[0].journey.day.localeCompare(a[0].journey.day)))
  const late = (tasks ?? []).filter((task) => task.late).length

  return <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
    <div>
      <h1 className="text-lg font-semibold text-[#192646]">My tasks</h1>
      <p className="text-xs text-slate-500">What you must do so that a new colleague’s first day goes well, or a colleague leaves properly. Click “Mark done” when it is done.</p>
    </div>

    <div className="flex flex-wrap items-center gap-2">
      {([['open', 'To do'], ['done', 'Done']] as [Filter, string][]).map(([id, label]) => {
        const selected = filter === id
        return <button key={id} type="button" aria-pressed={selected} onClick={() => { if (!selected) { setFilter(id); setTasks(null) } }}
          className={cn('rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
            selected ? 'border-[#23355d] bg-[#23355d] text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-[#23355d]/40 hover:text-[#23355d]')}>
          {label}{selected && tasks ? ` (${tasks.length})` : ''}
        </button>
      })}
      {filter === 'open' && late > 0 && <span className="rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700">{late} late</span>}
    </div>

    {failed && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">Could not load your tasks: refresh the page.</p>}
    {!failed && tasks === null && <p className="text-xs text-slate-500">Loading...</p>}
    {!failed && tasks !== null && cards.length === 0 && <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center">
      <ListTodo className="size-8 text-slate-300" aria-hidden />
      <p className="text-sm font-semibold text-[#192646]">{filter === 'open' ? 'Nothing to do' : 'No task done yet'}</p>
      <p className="max-w-sm text-xs text-slate-500">When someone arrives or leaves and you have something to prepare, it appears here (and in the bell 🔔).</p>
    </div>}

    {cards.map((group) => {
      const { journey } = group[0]
      return <section key={journey.id} className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <header className="border-b border-slate-100 px-4 py-3"><JourneyWho employee={journey.employee} kind={journey.kind} day={journey.day} /></header>
        <ul className="divide-y divide-slate-100">
          {group.map((task) => <TaskRow key={task.id} task={task} showWho={false} onChanged={() => load(filter)} />)}
        </ul>
      </section>
    })}
  </div>
}
