'use client'

/*
 * P2 step 1 : "Out of office", comme le message d'absence d'Outlook. Depuis le 2026-11-27 (choix A de l'utilisatrice,
 * standard Workday "Delegations") : une PAGE à part (/out-of-office, menu My space) avec l'historique ; Team approvals
 * ne garde qu'une petite pastille qui y mène (OutOfOfficeLine). 2e version le même jour (l'utilisatrice : "moderne,
 * simple, nafs theme") : mon état en UNE carte, "You stand in for", puis un tableau "Past delegations" + légende.
 * - Je pars : je choisis QUI valide à ma place, et de quand à quand. "End now" l'arrête.
 * - Je remplace quelqu'un : une ligne me le dit (ses demandes arrivent dans ma liste, "On behalf of ...").
 * - Les RH le font aussi POUR quelqu'un (ex. une absence soudaine) : "For another employee".
 * Sans délégué, la règle du moteur s'applique toute seule (son responsable, sauf le DG, sinon les RH du pôle).
 * Lu dans /api/workflows/delegations/ ; la recherche de personnes passe par l'annuaire (ouvert à tous les rôles).
 */
import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { ChevronRight, Loader2, Plane, Plus, Search, UserRoundCheck, X } from 'lucide-react'
import { apiFetch, isHr, type Me } from '@/lib/api'
import { formatDate, isoDate } from '@/lib/leaves'
import type { Delegation } from '@/lib/requests'
import { cn } from '@/lib/utils'
import { controlClass } from '@/components/employees/form-fields'
import { DatePicker } from '@/components/ui/date-picker'
import { DelegationAnswer } from './delegation-answer'

const firstError = (data: Record<string, unknown>) => {
  const first = data.detail ?? Object.values(data)[0]
  return Array.isArray(first) ? String(first[0]) : String(first ?? 'Something went wrong. Please try again.')
}

const card = 'rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]'

/** "2026-11-21" -> "21/11" : une date courte, pour une phrase ("until 21/11"). */
const short = (day: string) => formatDate(day).slice(0, 5)

/**
 * La page /out-of-office (2e version, 2026-11-27, l'utilisatrice : "moderne, simple, pas fatigant pour les yeux") :
 * 1. MON état en une carte (au bureau / absent jusqu'au... / en attente de réponse / refusé) + "Set a delegate" ;
 * 2. "You stand in for" : ceux que je remplace (Accept / Decline si on me le demande) ;
 * 3. "Past delegations" : un tableau Dates | Away | Delegate | Status, avec une légende.
 */
export function OutOfOfficePage({ me }: { me: Me }) {
  const [delegations, setDelegations] = useState<Delegation[] | null>(null)
  const [version, setVersion] = useState(0)  // +1 après un changement : la liste est relue
  const [open, setOpen] = useState(false)
  const [answered, setAnswered] = useState('')  // "You accepted..." après ma réponse à une délégation

  useEffect(() => {
    apiFetch('/api/workflows/delegations/')
      .then((response) => (response.ok ? response.json() : []))
      .then(setDelegations)
      .catch(() => setDelegations([]))
  }, [version])
  const reload = () => setVersion((old) => old + 1)

  const current = (delegations ?? []).filter((item) => item.state !== 'ENDED')
  // MA délégation du moment : en cours, sinon prévue, sinon en attente du délégué, sinon refusée (à remplacer).
  const mine = ['ACTIVE', 'PLANNED', 'WAITING', 'DECLINED']
    .map((state) => current.find((item) => item.direction === 'GIVEN' && item.state === state)).find(Boolean)
  // Une délégation que j'ai refusée ne me concerne plus (l'absent, lui, la voit "Refused").
  const standIn = current.filter((item) => item.direction === 'RECEIVED' && item.state !== 'DECLINED')
  const past = (delegations ?? []).filter((item) => item.state === 'ENDED' || (item.direction === 'RECEIVED' && item.state === 'DECLINED'))
  const canSet = !mine || mine.state === 'DECLINED'

  return <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
    <div>
      <h1 className="text-lg font-semibold text-[#192646]">Out of office</h1>
      <p className="text-xs text-slate-500">Away (leave, mission, training)? Someone answers your team&apos;s requests for you.</p>
    </div>

    {answered && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">{answered}</p>}

    {/* 1. Mon état. */}
    {delegations === null
      ? <div className={cn(card, 'h-24 animate-pulse')} />
      : <section className={card}>
          <div className="flex flex-wrap items-center gap-4 p-5">
            <MyState item={mine} />
            {canSet && !open && <button type="button" onClick={() => setOpen(true)}
              className="flex items-center gap-1.5 rounded-lg bg-[#23355d] px-4 py-2 text-xs font-semibold text-white hover:bg-[#192646]">
              <Plus className="size-3.5" aria-hidden /> Set a delegate
            </button>}
            {mine && mine.state !== 'DECLINED' && <EndButton item={mine} onEnded={reload} />}
          </div>
          {open && <DelegationForm me={me} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); reload() }} />}
        </section>}

    {/* 2. Ceux que je remplace. */}
    {standIn.length > 0 && <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-[#192646]">You stand in for</h2>
      {standIn.map((item) => <div key={item.id} className={cn(card, 'flex flex-wrap items-center gap-3 p-4')}>
        <Avatar name={item.delegator_label} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[#192646]">{item.delegator_label}</p>
          <p className="text-xs text-slate-500">
            {formatDate(item.start_date)} → {formatDate(item.end_date)}
            {item.state === 'WAITING' ? ' · asks you to answer their team’s requests' : item.state === 'PLANNED' ? ' · starts soon' : ' · their requests are in Team approvals'}
          </p>
        </div>
        {item.state === 'WAITING'
          ? <DelegationAnswer delegation={item} onAnswered={(message) => { setAnswered(message); reload() }} />
          : <Link href="/approvals" className="flex items-center gap-1 text-xs font-semibold text-[#23355d] hover:underline">
              Team approvals <ChevronRight className="size-3.5" aria-hidden />
            </Link>}
      </div>)}
    </section>}

    {/* 3. L'historique. */}
    {delegations !== null && <DelegationHistory items={past} />}
  </div>
}

/** Une pastille ronde avec les initiales (comme le reste de l'application). */
function Avatar({ name }: { name: string }) {
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
  return <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-[#23355d]">{initials}</span>
}

/** Mon état en une phrase claire, avec une couleur : vert = au bureau, bleu = absent / prévu, ambre = en attente, rouge = refusé. */
function MyState({ item }: { item?: Delegation }) {
  const [dot, title, text] = !item
    ? ['bg-emerald-500', 'You are in the office', 'Your team’s requests come to you.']
    : item.state === 'ACTIVE'
      ? ['bg-sky-500', `You are away until ${short(item.end_date)}`, <><b className="font-semibold text-[#192646]">{item.delegate_label}</b> answers your team’s requests.</>]
      : item.state === 'PLANNED'
        ? ['bg-sky-400', `Away from ${short(item.start_date)} to ${short(item.end_date)}`, <><b className="font-semibold text-[#192646]">{item.delegate_label}</b> will answer for you.</>]
        : item.state === 'WAITING'
          ? ['bg-amber-500', `Waiting for ${item.delegate_label} to accept`, `${short(item.start_date)} → ${short(item.end_date)}. Until they accept, your requests come to you.`]
          : ['bg-red-500', `${item.delegate_label} said no`, `“${item.decline_reason}”. Choose someone else.`]
  return <div className="flex min-w-0 flex-1 items-start gap-3">
    <span className={cn('mt-1.5 size-2.5 shrink-0 rounded-full', dot)} aria-hidden />
    <div className="min-w-0">
      <p className="text-base font-semibold text-[#192646]">{title}</p>
      <p className="mt-0.5 text-xs text-slate-500">{text}</p>
    </div>
  </div>
}

/** "End now" (en cours) ou "Cancel" (prévue / en attente) : la délégation s'arrête, rien n'est supprimé. */
function EndButton({ item, onEnded }: { item: Delegation; onEnded: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function end() {
    setBusy(true)
    const response = await apiFetch(`/api/workflows/delegations/${item.id}/end/`, { method: 'POST' }).catch(() => null)
    if (response?.ok) onEnded()
    else setError('Could not stop it. Please try again.')
    setBusy(false)
  }
  return <div className="flex flex-col items-end gap-1">
    <button type="button" disabled={busy} onClick={end}
      className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:opacity-60">
      {busy && <Loader2 className="size-3.5 animate-spin" />} {item.state === 'ACTIVE' ? 'I’m back (end now)' : 'Cancel'}
    </button>
    {error && <span role="alert" className="text-[11px] text-red-600">{error}</span>}
  </div>
}

/** Team approvals : une seule ligne qui dit où j'en suis et mène à la page (2026-11-27). */
export function OutOfOfficeLine() {
  const [delegations, setDelegations] = useState<Delegation[] | null>(null)
  useEffect(() => {
    apiFetch('/api/workflows/delegations/')
      .then((response) => (response.ok ? response.json() : []))
      .then(setDelegations)
      .catch(() => setDelegations([]))
  }, [])
  if (delegations === null) return null
  // D'abord ce qui demande une réponse de MOI, puis mon absence en cours / prévue, sinon l'invitation.
  const asked = delegations.find((item) => item.direction === 'RECEIVED' && item.state === 'WAITING')
  const away = delegations.find((item) => item.direction === 'GIVEN' && ['ACTIVE', 'PLANNED', 'WAITING'].includes(item.state))
  const text = asked
    ? <><b className="font-semibold">{asked.delegator_label}</b> asks you to stand in · Answer</>
    : away
      ? <>Away until {short(away.end_date)} · {away.delegate_label}{away.state === 'WAITING' ? ' (waiting)' : ''}</>
      : <>Away soon? Set a delegate</>
  // Une petite pastille cliquable (pas une barre sur toute la largeur), ambre quand on attend MA réponse.
  return <Link href="/out-of-office" className={cn('inline-flex items-center gap-1.5 self-start rounded-full border px-3 py-1 text-xs hover:border-[#23355d]/40',
    asked ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-600')}>
    <Plane className="size-3.5 shrink-0 text-[#23355d]" aria-hidden />
    {text}
    <ChevronRight className="size-3.5 shrink-0 text-slate-400" aria-hidden />
  </Link>
}

// Ce qui est fini, avec les MÊMES pastilles que "My leaves" / "My requests" (couleur + contour).
const END: Record<string, { label: string; className: string }> = {
  Ended: { label: 'Ended', className: 'bg-slate-100 text-slate-600 ring-slate-200' },
  Refused: { label: 'Refused', className: 'bg-red-50 text-red-700 ring-red-200' },
  Cancelled: { label: 'Cancelled', className: 'bg-slate-100 text-slate-500 ring-slate-200' },
}
function endLabel(item: Delegation) {
  if (item.answer === 'DECLINED') return 'Refused'
  if (item.ended_at && item.ended_at.slice(0, 10) < item.start_date) return 'Cancelled'
  return 'Ended'
}

const FIRST = 5  // combien de lignes avant "Show all" (comme "My leaves")
const SHORT_MONTH = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { month: 'short' })

// Les pastilles de filtre (le même style que "My leaves" / "My documents").
const TABS = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'given', label: 'My delegates', match: (item: Delegation) => item.direction === 'GIVEN' },
  { id: 'received', label: 'I stood in', match: (item: Delegation) => item.direction === 'RECEIVED' },
]

// L'historique (4e version, 2026-11-27, l'utilisatrice : "comme les autres pages, même thème") : le MÊME concept que
// "My leaves" = une carte avec titre, des pastilles avec leur nombre, une puce calendrier par ligne, l'état à droite,
// 5 lignes puis "Show all". Des mots neutres (vrais aussi pour "Refused" / "Cancelled").
function DelegationHistory({ items }: { items: Delegation[] }) {
  const [tab, setTab] = useState('all')
  const [all, setAll] = useState(false)
  if (items.length === 0) return null
  const current = TABS.find((item) => item.id === tab) ?? TABS[0]
  const sorted = items.filter(current.match).sort((a, b) => b.start_date.localeCompare(a.start_date))
  const shown = all ? sorted : sorted.slice(0, FIRST)
  // "I stood in" seulement si j'ai déjà remplacé quelqu'un.
  const tabs = TABS.filter((item) => item.id !== 'received' || items.some(item.match))

  return <section className={card}>
    <header className="px-4 pt-3">
      <h2 className="text-sm font-semibold text-[#192646]">Past delegations</h2>
      <p className="text-[11px] text-slate-500">The latest first.</p>
    </header>
    {tabs.length > 2 && <div role="group" aria-label="Filter" className="flex flex-wrap gap-1.5 px-4 pt-2">
      {tabs.map((item) => {
        const selected = item.id === tab
        return <button key={item.id} type="button" aria-pressed={selected} onClick={() => { setTab(item.id); setAll(false) }}
          className={cn('flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors',
            selected ? 'border-[#23355d] bg-[#23355d] text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-[#23355d]/40 hover:text-[#23355d]')}>
          {item.label}<span className={cn('tabular-nums', selected ? 'text-white/70' : 'text-slate-400')}>{items.filter(item.match).length}</span>
        </button>
      })}
    </div>}
    <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
      {shown.map((item) => {
        const end = END[endLabel(item)]
        const given = item.direction === 'GIVEN'
        return <li key={item.id} className={cn('flex items-start gap-3 px-4 py-3', end.label !== 'Ended' && 'opacity-70')}>
          {/* La puce calendrier : le premier jour, lisible d'un coup d'œil (comme "My leaves"). */}
          <span className="flex w-11 shrink-0 flex-col items-center rounded-lg border border-slate-200 bg-slate-50 py-1" aria-hidden>
            <span className="text-[9px] font-bold uppercase tracking-wide text-[#8C6D52]">{SHORT_MONTH(item.start_date)}</span>
            <span className="text-base font-semibold leading-tight text-[#192646]">{Number(item.start_date.slice(8, 10))}</span>
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-[#192646]">{given ? item.delegate_label : item.delegator_label}</p>
            <p className="text-xs text-slate-600">{formatDate(item.start_date)} → {formatDate(item.end_date)}</p>
            <p className="truncate text-[11px] text-slate-400">
              {given ? 'Your delegate' : 'You were their delegate'}
              {item.answer === 'DECLINED' && item.decline_reason && <> · <span className="italic">“{item.decline_reason}”</span></>}
            </p>
          </div>
          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', end.className)}>{end.label}</span>
        </li>
      })}
    </ul>
    {sorted.length > FIRST && <button type="button" onClick={() => setAll((old) => !old)}
      className="w-full border-t border-slate-100 px-4 py-2.5 text-xs font-semibold text-[#23355d] hover:bg-slate-50">
      {all ? 'Show less' : `Show all (${sorted.length})`}
    </button>}
    <p className="border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-500">
      <b className="font-semibold">Ended</b> = the dates are over · <b className="font-semibold">Refused</b> = the delegate said no ·{' '}
      <b className="font-semibold">Cancelled</b> = stopped before the first day.
    </p>
  </section>
}

// Le formulaire : le délégué, les dates ; pour les RH, "For another employee" (l'absent n'est pas moi).
function DelegationForm({ me, onClose, onSaved }: { me: Me; onClose: () => void; onSaved: () => void }) {
  const today = isoDate(new Date())
  const [forOther, setForOther] = useState(false)
  const [delegator, setDelegator] = useState<Person | null>(null)
  const [delegate, setDelegate] = useState<Person | null>(null)
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!delegate) return setError('Choose who answers in your place.')
    if (forOther && !delegator) return setError('Choose the employee who is away.')
    setBusy(true)
    setError('')
    try {
      const body = { delegate: delegate.id, start_date: from, end_date: to, ...(forOther && delegator ? { delegator: delegator.id } : {}) }
      const response = await apiFetch('/api/workflows/delegations/', { method: 'POST', body: JSON.stringify(body) })
      const data = await response.json().catch(() => ({}))
      if (response.ok) onSaved()
      else setError(firstError(data))  // ex. "Une délégation existe déjà sur ces dates..."
    } catch {
      setError('Cannot reach the server. Please try again later.')
    }
    setBusy(false)
  }

  return <form onSubmit={save} className="grid grid-cols-1 gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-3 sm:grid-cols-2">
    {isHr(me) && <label className="flex items-center gap-2 text-xs text-slate-700 sm:col-span-2">
      <input type="checkbox" checked={forOther} onChange={(e) => setForOther(e.target.checked)} className="size-3.5 accent-[#192646]" />
      For another employee (HR: someone away who cannot do it)
    </label>}
    {forOther && <div className="sm:col-span-2">
      <PersonPicker id="delegator" label="Employee who is away" value={delegator}
        onChange={(person) => { setDelegator(person); setDelegate(null) }} source={(search) => `/api/employees/directory/?search=${search}`} />
    </div>}
    <div className="sm:col-span-2">
      {/* N'importe qui, de SBD ou de Riaya (2026-11-23, comme le responsable d'un service). Sans délégué, personne
          ne le remplace. */}
      <PersonPicker id="delegate" label="Who answers in their place (anyone, SBD or Riaya)" value={delegate} onChange={setDelegate}
        source={(search) => `/api/workflows/delegations/candidates/?search=${search}${forOther && delegator ? `&delegator=${delegator.id}` : ''}`} />
    </div>
    <div>
      <label htmlFor="delegation-from" className="block text-xs font-semibold text-slate-700">From</label>
      <DatePicker id="delegation-from" required min={today} value={from}
        onChange={(value) => { setFrom(value); if (value && to < value) setTo(value) }} />
    </div>
    <div>
      <label htmlFor="delegation-to" className="block text-xs font-semibold text-slate-700">To</label>
      <DatePicker id="delegation-to" required min={from || today} value={to} onChange={setTo} />
    </div>
    {error && <p role="alert" className="text-xs font-medium text-red-600 sm:col-span-2">{error}</p>}
    <div className="flex justify-end gap-2 sm:col-span-2">
      <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
      <button type="submit" disabled={busy} className="flex items-center gap-1.5 rounded-lg bg-[#23355d] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#192646] disabled:opacity-60">
        {busy && <Loader2 className="size-3.5 animate-spin" />} Save
      </button>
    </div>
  </form>
}

export type Person = { id: number; first_name: string; last_name: string; position?: string | null; department?: string | null; role?: string }

// Chercher une personne : on tape 2 lettres, on choisit. `source` = l'adresse de la recherche
// (l'annuaire pour l'absent ; les personnes PERMISES pour le délégué). Les deux réponses sont lues : liste ou page.
// (Aussi dans la page Administrative documents : un RH demande un document POUR un collaborateur.)
export function PersonPicker({ id, label, value, onChange, source }: {
  id: string; label: string; value: Person | null; onChange: (person: Person | null) => void; source: (search: string) => string
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ query: string; rows: Person[] } | null>(null)
  const search = query.trim()
  const url = source(encodeURIComponent(search))

  useEffect(() => {
    if (search.length < 2) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      apiFetch(url, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : []))
        .then((data: Person[] | { results: Person[] }) => setResults({ query: search, rows: (Array.isArray(data) ? data : data.results).slice(0, 8) }))
        .catch(() => { /* annulé : une autre recherche a commencé */ })
    }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [search, url])

  const rows = results && results.query === search ? results.rows : []

  if (value) {
    return <div>
      <p className="text-xs font-semibold text-slate-700">{label}</p>
      <p className="mt-1.5 flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm">
        <UserRoundCheck className="size-4 text-emerald-600" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{value.first_name} {value.last_name}</span>
        <button type="button" onClick={() => onChange(null)} aria-label="Change" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="size-3.5" /></button>
      </p>
    </div>
  }
  return <div className="relative">
    <label htmlFor={`${id}-search`} className="block text-xs font-semibold text-slate-700">{label}</label>
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 mt-0.5 size-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
      <input id={`${id}-search`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type a name..." autoComplete="off"
        className={cn(controlClass, 'pl-8')} />
    </div>
    {search.length >= 2 && <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg">
      {rows.length === 0
        ? <li className="px-3 py-2 text-xs text-slate-500">No one found.</li>
        : rows.map((person) => <li key={person.id}>
            <button type="button" onClick={() => { onChange(person); setQuery('') }} className="w-full px-3 py-2 text-left hover:bg-slate-50">
              <span className="font-medium text-[#192646]">{person.first_name} {person.last_name}</span>
              {(person.position || person.department || person.role) && <span className="block text-[11px] text-slate-500">
                {[person.role, person.position, person.department].filter(Boolean).join(' · ')}
              </span>}
            </button>
          </li>)}
    </ul>}
  </div>
}
