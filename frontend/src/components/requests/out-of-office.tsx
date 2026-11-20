'use client'

/*
 * P2 step 1 : "Out of office" (en haut de Team approvals), comme le message d'absence d'Outlook.
 * - Je pars : je choisis QUI valide à ma place, et de quand à quand. "End now" l'arrête.
 * - Je remplace quelqu'un : une ligne me le dit (ses demandes arrivent dans ma liste, "On behalf of ...").
 * - Les RH le font aussi POUR quelqu'un (ex. une absence soudaine) : "For another employee".
 * Sans délégué, la règle du moteur s'applique toute seule (son responsable, sauf le DG, sinon les RH du pôle).
 * Lu dans /api/workflows/delegations/ ; la recherche de personnes passe par l'annuaire (ouvert à tous les rôles).
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Loader2, Plane, Search, UserRoundCheck, X } from 'lucide-react'
import { apiFetch, isHr, type Me } from '@/lib/api'
import { formatDate, isoDate } from '@/lib/leaves'
import type { Delegation } from '@/lib/requests'
import { cn } from '@/lib/utils'
import { controlClass } from '@/components/employees/form-fields'
import { DatePicker } from '@/components/ui/date-picker'
import { DelegationAnswer, DelegationBadge } from './delegation-answer'

const firstError = (data: Record<string, unknown>) => {
  const first = data.detail ?? Object.values(data)[0]
  return Array.isArray(first) ? String(first[0]) : String(first ?? 'Something went wrong. Please try again.')
}

export function OutOfOffice({ me }: { me: Me }) {
  const [delegations, setDelegations] = useState<Delegation[] | null>(null)
  const [version, setVersion] = useState(0)  // +1 après un changement : la liste est relue
  const [open, setOpen] = useState(false)

  useEffect(() => {
    apiFetch('/api/workflows/delegations/')
      .then((response) => (response.ok ? response.json() : []))
      .then(setDelegations)
      .catch(() => setDelegations([]))
  }, [version])

  const [answered, setAnswered] = useState('')  // "You accepted..." après ma réponse à une délégation
  const current = (delegations ?? []).filter((item) => item.state !== 'ENDED')
  const given = current.filter((item) => item.direction === 'GIVEN')
  // Une délégation que j'ai refusée ne me concerne plus (l'absent, lui, la voit "Declined").
  const received = current.filter((item) => item.direction === 'RECEIVED' && item.state !== 'DECLINED')
  const reload = () => setVersion((old) => old + 1)

  return <section className="rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <header className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span className="flex size-8 items-center justify-center rounded-lg bg-slate-100 text-[#23355d]" aria-hidden><Plane className="size-4" /></span>
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-[#192646]">Out of office</h2>
        <p className="text-[11px] text-slate-500">Going away? Choose who answers your team&apos;s requests while you are gone.</p>
      </div>
      {!open && <button type="button" onClick={() => setOpen(true)}
        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-[#23355d] hover:border-[#23355d]/40 hover:bg-slate-50">
        Set a delegate
      </button>}
    </header>

    {/* Mes délégations (en cours ou prévues), et celles où je remplace quelqu'un. */}
    {answered && <p role="status" className="border-t border-emerald-100 bg-emerald-50 px-4 py-2 text-xs font-medium text-emerald-800">{answered}</p>}
    {(given.length > 0 || received.length > 0) && <ul className="divide-y divide-slate-100 border-t border-slate-100 text-xs">
      {/* Mes délégations : en attente de la réponse du délégué, refusée (motif : choisir quelqu'un d'autre), ou valable. */}
      {given.map((item) => <DelegationLine key={item.id} item={item} onEnded={item.state === 'DECLINED' ? undefined : reload}
        text={item.state === 'WAITING'
          ? <>Waiting for <b className="font-semibold text-[#192646]">{item.delegate_label}</b> to accept. Until then, your requests wait for you</>
          : item.state === 'DECLINED'
            ? <><b className="font-semibold text-[#192646]">{item.delegate_label}</b> declined: “{item.decline_reason}”. Click “Set a delegate” to choose someone else</>
            : <>Your requests also go to <b className="font-semibold text-[#192646]">{item.delegate_label}</b></>} />)}
      {/* On me demande de remplacer quelqu'un : j'accepte ou je refuse ; accepté : ses demandes sont dans ma liste. */}
      {received.map((item) => <DelegationLine key={item.id} item={item}
        text={item.state === 'WAITING'
          ? <><b className="font-semibold text-[#192646]">{item.delegator_label}</b> asks you to answer their team&apos;s requests while they are away</>
          : <>You answer for <b className="font-semibold text-[#192646]">{item.delegator_label}</b>: their requests are in your list below</>}
        answer={item.state === 'WAITING' ? <DelegationAnswer delegation={item} onAnswered={(message) => { setAnswered(message); reload() }} /> : undefined} />)}
    </ul>}

    {open && <DelegationForm me={me} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); reload() }} />}
  </section>
}

function DelegationLine({ item, text, onEnded, answer }: { item: Delegation; text: ReactNode; onEnded?: () => void; answer?: ReactNode }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function end() {
    setBusy(true)
    const response = await apiFetch(`/api/workflows/delegations/${item.id}/end/`, { method: 'POST' }).catch(() => null)
    if (response?.ok) onEnded?.()
    else setError('Could not end it. Please try again.')
    setBusy(false)
  }

  return <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
    <DelegationBadge state={item.state} />
    <span className="min-w-0 flex-1 text-slate-600">{text} · {formatDate(item.start_date)} → {formatDate(item.end_date)}</span>
    {error && <span role="alert" className="text-[11px] text-red-600">{error}</span>}
    {answer}
    {onEnded && <button type="button" disabled={busy} onClick={end}
      className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-red-50 hover:text-red-600 disabled:opacity-60">
      {busy && <Loader2 className="size-3 animate-spin" />} {item.state === 'WAITING' ? 'Cancel' : 'End now'}
    </button>}
  </li>
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
      {/* N'importe qui du même pôle que l'absent (décision du 2026-11-12). Sans délégué, personne ne le remplace. */}
      <PersonPicker id="delegate" label="Who answers in their place (anyone of the pôle)" value={delegate} onChange={setDelegate}
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
