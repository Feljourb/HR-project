'use client'

/*
 * "Arrivals & departures" (/onboarding, RH ; Admin RH et IT : les deux pôles) : les RH suivent chaque parcours.
 * - Une ligne par personne : qui, quand, où en est la checklist (barre 3/7), tâches en retard (rouge).
 * - Un clic : le panneau à droite avec TOUTES les tâches (les RH peuvent cocher n'importe laquelle) et "Cancel".
 * - "Start an arrival" (RH) : pour une fiche créée avant le module (une fiche NOUVELLE commence toute seule).
 * - "New departure" (step 2, comme NOOR) : le manager pour SON équipe, les RH pour leur pôle. En haut, les départs
 *   qui attendent la validation des RH ; validé = le parcours de départ (les tâches) commence.
 * Un manager voit les arrivées et départs de son équipe, et coche seulement SES tâches.
 */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ChevronRight, FileText, Loader2, LogOut, Plus, Search, X } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { getFile } from '@/lib/expenses'
import { cn } from '@/lib/utils'
import { SidePanel } from '@/components/ui/side-panel'
import { PersonPicker, type Person } from '@/components/requests/out-of-office'
import { errorOf, frDate, type Departure, type DepartureOptions, type Journey, type JourneyKind } from '@/lib/journeys'
import { DepartureForm } from './departure-form'
import { JourneyWho } from './journey-who'
import { DepartureNotice, NoticeDecision } from './notice'
import { TaskRow } from './task-row'

type Status = 'open' | 'done' | 'cancelled' | 'all'
const STATUSES: [Status, string][] = [['open', 'In progress'], ['done', 'Done'], ['cancelled', 'Cancelled'], ['all', 'All']]

// La légende sous la liste (règle "Don't Make Me Think").
const LEGEND: [string, string][] = [
  ['Progress', 'Tasks done / all tasks. E.g. 3/7 = 3 tasks done, 4 left.'],
  ['Late', 'A task not done after its date. The person gets a reminder in the bell.'],
  ['In progress', 'At least one task left. Done = every task is done.'],
]

export function JourneysPage() {
  const [status, setStatus] = useState<Status>('open')
  const [kind, setKind] = useState<'' | JourneyKind>('')
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<Journey[] | null>(null)
  const [failed, setFailed] = useState(false)
  // Le parcours ouvert dans le panneau : relu tout seul après chaque changement (il reste ouvert même s'il sort
  // de la liste, ex. sa dernière tâche faite pendant le filtre "In progress").
  const [opened, setOpened] = useState<Journey | null>(null)
  const [starting, setStarting] = useState(false)
  // Step 2 : le formulaire "New departure", et les demandes de départ qui attendent les RH.
  const [options, setOptions] = useState<DepartureOptions | null>(null)
  const [declaring, setDeclaring] = useState(false)
  const [pending, setPending] = useState<Departure[]>([])
  const [notice, setNotice] = useState('')

  const loadPending = useCallback(() => {
    apiFetch('/api/journeys/departures/?status=pending')
      .then((response) => (response.ok ? response.json() : []))
      .then(setPending)
      .catch(() => { /* la liste principale dit déjà si le serveur ne répond pas */ })
  }, [])

  useEffect(() => {
    loadPending()
    apiFetch('/api/journeys/departures/options/')
      .then((response) => (response.ok ? response.json() : null))
      .then(setOptions)
      .catch(() => { /* pas de bouton "New departure" */ })
  }, [loadPending])

  const query = `/api/journeys/journeys/?status=${status}${kind ? `&kind=${kind}` : ''}&search=${encodeURIComponent(search.trim())}`
  const load = useCallback(() => {
    apiFetch(query)
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data: Journey[]) => { setRows(data); setFailed(false) })
      .catch(() => setFailed(true))
  }, [query])

  // La recherche part 300 ms après la dernière touche (pas une requête par lettre).
  useEffect(() => {
    const timer = setTimeout(load, 300)
    return () => clearTimeout(timer)
  }, [load])

  // (2026-11-25) ouvert depuis "Open in Arrivals & departures" (après avoir validé un départ) : ?request=<n° de la
  // demande> -> le panneau de CE départ s'ouvre tout de suite (standard : le lien mène à la chose, pas à une liste).
  const fromRequest = useSearchParams().get('request')
  useEffect(() => {
    if (!fromRequest) return
    apiFetch(`/api/journeys/departures/request/${fromRequest}/`)
      .then((response) => (response.ok ? response.json() : null))
      .then((departure: Departure | null) => (departure?.journey ? apiFetch(`/api/journeys/journeys/${departure.journey}/`) : null))
      .then((response) => (response?.ok ? response.json() : null))
      .then((journey: Journey | null) => { if (journey) setOpened(journey) })
      .catch(() => { /* la liste reste affichée */ })
  }, [fromRequest])

  function refresh(journeyId: number) {
    load()
    apiFetch(`/api/journeys/journeys/${journeyId}/`)
      .then((response) => (response.ok ? response.json() : null))
      .then((journey: Journey | null) => { if (journey) setOpened(journey) })
      .catch(() => { /* le panneau garde l'ancienne version */ })
  }

  return <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
    <div className="flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-lg font-semibold text-[#192646]">Arrivals &amp; departures</h1>
        <p className="text-xs text-slate-500">The checklist of each person who arrives or leaves: who must do what, and before when. A new employee file starts its arrival by itself.</p>
      </div>
      {/* Un départ : le manager (son équipe) ou les RH. Une arrivée : les RH (une fiche nouvelle la commence seule). */}
      {options && (options.is_hr || options.team.length > 0) && <button type="button" onClick={() => setDeclaring(true)}
        className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-[#23355d] hover:border-[#23355d]/40">
        <LogOut className="size-3.5" /> New departure
      </button>}
      {options?.is_hr && <button type="button" onClick={() => setStarting(true)}
        className="flex items-center gap-1.5 rounded-lg bg-[#23355d] px-3 py-2 text-xs font-semibold text-white hover:bg-[#192646]">
        <Plus className="size-3.5" /> Start an arrival
      </button>}
    </div>

    {notice && <p role="status" className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800">
      <span className="flex-1">{notice}</span>
      <button type="button" onClick={() => setNotice('')} aria-label="Close" className="rounded p-0.5 hover:bg-emerald-100"><X className="size-3.5" /></button>
    </p>}

    {/* Les demandes de départ qui attendent la validation des RH (avant : pas encore de tâches). */}
    {pending.length > 0 && <section className="overflow-hidden rounded-xl border border-amber-200 bg-amber-50/40">
      <h2 className="border-b border-amber-200 px-4 py-2.5 text-xs font-semibold text-amber-900">Departures waiting for approval ({pending.length})</h2>
      <ul className="divide-y divide-amber-100">
        {pending.map((departure) => <li key={departure.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div className="min-w-0 flex-1"><JourneyWho employee={departure.employee} kind="DEPARTURE" day={departure.last_day} /></div>
          <p className="text-[11px] text-slate-600">{departure.type_label} · requested by {departure.requested_by_name}</p>
          <LetterButton departure={departure} />
          <Link href={options?.is_hr ? '/approvals' : `/requests/${departure.request}?from=onboarding`}
            className="rounded-md bg-[#23355d] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-[#192646]">
            {options?.is_hr ? 'Approve in Team approvals' : 'View'}
          </Link>
        </li>)}
      </ul>
    </section>}

    {/* Les filtres, sur une ligne. */}
    <div className="flex flex-wrap items-center gap-2">
      {STATUSES.map(([id, label]) => {
        const selected = status === id
        return <button key={id} type="button" aria-pressed={selected} onClick={() => { if (!selected) { setStatus(id); setRows(null) } }}
          className={cn('rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
            selected ? 'border-[#23355d] bg-[#23355d] text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-[#23355d]/40 hover:text-[#23355d]')}>
          {label}
        </button>
      })}
      <label htmlFor="journey-kind" className="sr-only">Arrivals or departures</label>
      <select id="journey-kind" value={kind} onChange={(e) => setKind(e.target.value as '' | JourneyKind)}
        className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-[#23355d]">
        <option value="">Arrivals and departures</option>
        <option value="ARRIVAL">Arrivals</option>
        <option value="DEPARTURE">Departures</option>
      </select>
      <div className="relative ml-auto w-full sm:w-60">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
        <label htmlFor="journey-search" className="sr-only">Search a name</label>
        <input id="journey-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or employee n°"
          className="h-8 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs outline-none focus:border-[#23355d]" />
      </div>
    </div>

    <section className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      {failed && <p role="alert" className="px-4 py-6 text-xs text-red-700">Could not load the list: refresh the page.</p>}
      {!failed && rows === null && <p className="px-4 py-6 text-xs text-slate-500">Loading...</p>}
      {!failed && rows?.length === 0 && <p className="px-4 py-8 text-center text-xs text-slate-500">Nobody here. A new employee file starts an arrival by itself.</p>}
      <ul className="divide-y divide-slate-100">
        {rows?.map((journey) => {
          const done = journey.tasks.filter((task) => task.done_at).length
          const total = journey.tasks.length
          const late = journey.tasks.filter((task) => task.late).length
          return <li key={journey.id}>
            <button type="button" onClick={() => setOpened(journey)}
              className={cn('flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-left hover:bg-slate-50', journey.status === 'cancelled' && 'opacity-60')}>
              <div className="min-w-0 flex-1"><JourneyWho employee={journey.employee} kind={journey.kind} day={journey.day} /></div>
              {journey.status === 'cancelled'
                ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Cancelled</span>
                : <Progress done={done} total={total} />}
              {late > 0 && journey.status === 'open' && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">{late} late</span>}
              <ChevronRight className="size-4 text-slate-400" aria-hidden />
            </button>
          </li>
        })}
      </ul>
    </section>

    <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-[11px] text-slate-500 sm:grid-cols-3">
      {LEGEND.map(([term, text]) => <div key={term}><dt className="inline font-semibold text-slate-700">{term}: </dt><dd className="inline">{text}</dd></div>)}
    </dl>

    <SidePanel open={opened !== null} onClose={() => setOpened(null)} width={600}
      title={opened ? `${opened.kind === 'ARRIVAL' ? 'Arrival' : 'Departure'} of ${opened.employee.name}` : ''}
      description={opened ? `${opened.employee.u_number} · ${opened.employee.position} · ${opened.employee.department} · ${opened.employee.direction}` : ''}>
      {opened && <JourneyDetail journey={opened} onChanged={() => refresh(opened.id)} />}
    </SidePanel>

    <SidePanel open={declaring} onClose={() => setDeclaring(false)} width={520} title="New departure"
      description={options?.is_hr ? 'Any employee of your pôle.' : 'Someone of your team. HR approve it, then the tasks start.'}>
      {options && <DepartureForm options={options} onDone={(departure) => {
        setDeclaring(false)
        loadPending()
        load()
        setNotice(departure.status === 'APPROVED'
          ? `Departure of ${departure.employee.name} recorded: the departure tasks have started.`
          : `Departure of ${departure.employee.name} sent to HR. The tasks start once HR approve it.`)
      }} />}
    </SidePanel>

    <SidePanel open={starting} onClose={() => setStarting(false)} width={480} title="Start an arrival"
      description="For an employee file created before this page existed. A new file starts its arrival by itself.">
      <StartArrival onStarted={(journey) => { setStarting(false); setStatus('open'); setKind(''); setSearch(''); setOpened(journey) }} />
    </SidePanel>
  </div>
}

/** La lettre de départ (démission...) : ouverte dans un nouvel onglet ; jamais une adresse publique (l'API vérifie qui). */
function LetterButton({ departure }: { departure: Departure }) {
  const [error, setError] = useState('')
  if (!departure.has_letter) return null
  return <span className="inline-flex items-center gap-2">
    <button type="button" onClick={async () => setError(await getFile(`/api/journeys/departures/${departure.id}/letter/`, departure.letter_name || 'lettre.pdf', true))}
      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-[#23355d] hover:bg-slate-50">
      <FileText className="size-3.5" /> Letter
    </button>
    {error && <span role="alert" className="text-[11px] text-red-600">{error}</span>}
  </span>
}

/** La barre "3/7" : vert quand tout est fait. */
function Progress({ done, total }: { done: number; total: number }) {
  const percent = total ? Math.round((done / total) * 100) : 0
  return <div className="flex w-32 items-center gap-2" title={`${done} of ${total} tasks done`}>
    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
      <div className={cn('h-full rounded-full', done === total ? 'bg-emerald-500' : 'bg-[#23355d]')} style={{ width: `${percent}%` }} />
    </div>
    <span className="text-[11px] font-semibold text-slate-600">{done}/{total}</span>
  </div>
}

/** Le panneau d'un parcours : la barre, toutes les tâches (les RH cochent n'importe laquelle), et "Cancel". */
function JourneyDetail({ journey, onChanged }: { journey: Journey; onChanged: () => void }) {
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const done = journey.tasks.filter((task) => task.done_at).length
  const cancelled = journey.status === 'cancelled'

  async function cancel() {
    setBusy(true)
    setError('')
    const response = await apiFetch(`/api/journeys/journeys/${journey.id}/cancel/`, { method: 'POST', body: JSON.stringify({ reason }) }).catch(() => null)
    setBusy(false)
    if (response?.ok) { setCancelling(false); onChanged() } else setError(response ? await errorOf(response) : 'The server does not answer. Try again.')
  }

  return <div className="flex flex-col gap-4">
    <div className="rounded-xl border border-slate-200/80 bg-white p-4">
      <p className="text-xs text-slate-500">{journey.kind === 'ARRIVAL' ? 'First day' : 'Last day'}</p>
      <p className="text-sm font-semibold text-[#192646]">{frDate(journey.day)}</p>
      {!cancelled && <div className="mt-3"><Progress done={done} total={journey.tasks.length} /></div>}
      {cancelled && <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700">
        Cancelled by {journey.cancelled_by_name ?? '?'} on {frDate(journey.cancelled_at!.slice(0, 10))}. Reason: {journey.cancel_reason}
      </p>}
      {/* Un départ : la demande d'où il vient (comme l'en-tête de NOOR). */}
      {journey.departure && <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 border-t border-slate-100 pt-3 text-xs sm:grid-cols-2">
        <div><dt className="text-slate-500">Type of departure</dt><dd className="font-semibold text-slate-800">{journey.departure.type_label}</dd></div>
        <div><dt className="text-slate-500">Requested by</dt><dd className="font-semibold text-slate-800">{journey.departure.requested_by_name}</dd></div>
        {journey.departure.informed.length > 0 && <div className="sm:col-span-2"><dt className="text-slate-500">People informed</dt>
          <dd className="text-slate-800">{journey.departure.informed.join(', ')}</dd></div>}
        {journey.departure.comment && <div className="sm:col-span-2"><dt className="text-slate-500">Comment</dt>
          <dd className="text-slate-800">“{journey.departure.comment}”</dd></div>}
        {journey.departure.has_letter && <div className="sm:col-span-2"><LetterButton departure={journey.departure} /></div>}
      </dl>}
      {/* Le préavis (2026-11-25) : ce que dit la loi, et la décision des RH (sert au solde de tout compte). */}
      {journey.departure && <div className="mt-3 flex flex-col gap-2 border-t border-slate-100 pt-3">
        <DepartureNotice departure={journey.departure} />
        {!cancelled && <NoticeDecision key={`${journey.departure.notice_status}-${journey.departure.notice_start}`} departure={journey.departure} onChanged={onChanged} />}
      </div>}
    </div>

    <section className="overflow-hidden rounded-xl border border-slate-200/80 bg-white">
      <h3 className="border-b border-slate-100 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Tasks</h3>
      <ul className="divide-y divide-slate-100">
        {/* Un manager voit tout, mais coche seulement SES tâches (can_handle). */}
        {journey.tasks.map((task) => <TaskRow key={task.id} task={task} readOnly={cancelled || !task.can_handle} onChanged={onChanged} />)}
      </ul>
    </section>

    <p className="text-[11px] text-slate-500">Started {journey.created_by_name ? `by ${journey.created_by_name} ` : 'automatically '}on {frDate(journey.created_at.slice(0, 10))}.
      {' '}The tasks come from the model in Reference lists → Arrivals &amp; departures.</p>

    {journey.can_cancel && (cancelling
      ? <div className="flex flex-col gap-2 rounded-xl border border-red-200 bg-red-50/50 p-3">
          <label htmlFor="cancel-reason" className="text-xs font-semibold text-slate-700">Why cancel? <span className="text-red-600">*</span></label>
          <input id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} autoFocus placeholder="e.g. The person finally did not come"
            className="h-9 rounded-md border border-slate-200 bg-white px-2.5 text-sm outline-none focus:border-[#23355d]" />
          {error && <p role="alert" className="text-[11px] font-medium text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => void cancel()} disabled={busy || !reason.trim()}
              className="flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50">
              {busy && <Loader2 className="size-3.5 animate-spin" />} Cancel this {journey.kind === 'ARRIVAL' ? 'arrival' : 'departure'}
            </button>
            <button type="button" onClick={() => setCancelling(false)} className="rounded-md px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200">Keep it</button>
          </div>
        </div>
      : <button type="button" onClick={() => setCancelling(true)} className="flex items-center gap-1 self-start text-xs font-semibold text-red-600 hover:underline">
          <X className="size-3.5" /> Cancel this {journey.kind === 'ARRIVAL' ? 'arrival' : 'departure'}
        </button>)}
  </div>
}

/** Commencer l'arrivée d'un collaborateur (le premier jour = sa date d'embauche, lue dans la fiche). */
function StartArrival({ onStarted }: { onStarted: (journey: Journey) => void }) {
  const [employee, setEmployee] = useState<Person | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function start() {
    if (!employee) return
    setBusy(true)
    setError('')
    const response = await apiFetch('/api/journeys/journeys/', { method: 'POST', body: JSON.stringify({ employee: employee.id, kind: 'ARRIVAL' }) }).catch(() => null)
    setBusy(false)
    if (response?.ok) onStarted(await response.json())
    else setError(response ? await errorOf(response) : 'The server does not answer. Try again.')
  }

  return <div className="flex flex-col gap-4">
    <PersonPicker id="arrival-employee" label="Employee" value={employee} onChange={(person) => { setEmployee(person); setError('') }}
      source={(search) => `/api/employees/directory/?search=${search}`} />
    <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
      The first day is the <span className="font-semibold">hire date</span> of the employee file. Each task gets its date from it (e.g. “3 days before”), and each person gets a bell 🔔.
    </p>
    {error && <p role="alert" className="text-xs font-medium text-red-600">{error}</p>}
    <button type="button" onClick={() => void start()} disabled={!employee || busy}
      className="flex items-center justify-center gap-1.5 rounded-lg bg-[#23355d] px-3 py-2 text-sm font-semibold text-white hover:bg-[#192646] disabled:opacity-50">
      {busy && <Loader2 className="size-4 animate-spin" />} Start the arrival
    </button>
  </div>
}
