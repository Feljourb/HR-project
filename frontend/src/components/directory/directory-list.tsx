'use client'

/*
 * L'annuaire : retrouver un collègue des deux pôles (nom, poste, service, email, téléphone).
 * Ouvert à tous les rôles. Django n'envoie que les champs publics (jamais CIN ni adresse).
 *
 * Version "pro" (2026-11-11, le standard de Microsoft 365 People / BambooHR) :
 * - recherche + filtres Direction -> Service (les choix viennent de directory/filters/) ;
 * - deux affichages : Cartes ou Liste (le choix est gardé dans ce navigateur) ;
 * - des actions rapides : écrire, appeler, copier l'email, discuter dans Teams (la société utilise Microsoft 365) ;
 * - un clic sur une personne ouvre sa "carte de visite" (panneau à droite), avec les MÊMES champs publics.
 */
import { useEffect, useRef, useState } from 'react'
import {
  Building2, Check, ChevronLeft, ChevronRight, Copy, LayoutGrid, List, Mail, MessageSquare, Phone, RotateCw, Search,
  SearchX, UsersRound, X,
} from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { PAGE_SIZE, type DirectoryPerson } from '@/lib/employees'
import { usePaged } from '@/lib/use-paged'
import { cn } from '@/lib/utils'

// Les choix des filtres (GET /api/employees/directory/filters/) : les directions et leurs services.
type DirectionOption = { id: number; name: string; entity: string; count: number; departments: { id: number; name: string; count: number }[] }
type View = 'cards' | 'list'

const VIEW_KEY = 'directory-view'

// Les couleurs des avatars : calmes, toujours la même pour une même personne (calculée depuis son nom).
const AVATAR_COLORS = [
  'bg-[#E4E9F2] text-[#23355d]',
  'bg-[#F3EAE2] text-[#8C6D52]',
  'bg-[#E3F0EC] text-[#2F6B5A]',
  'bg-[#EDE7F3] text-[#5B4A7A]',
  'bg-[#F5E6E8] text-[#8A4452]',
  'bg-[#E2EEF5] text-[#2F5F7A]',
]

function initialsOf(person: DirectoryPerson) {
  return `${person.first_name.charAt(0)}${person.last_name.charAt(0)}`.toUpperCase()
}

function colorOf(person: DirectoryPerson) {
  let hash = 0
  for (const letter of `${person.first_name}${person.last_name}`) hash = (hash * 31 + letter.charCodeAt(0)) % 997
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

/** "+212612345678" -> "+212 6 12 34 56 78" (plus facile à lire et à dicter). */
function formatPhone(phone: string) {
  const match = /^\+212(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(phone)
  return match ? `+212 ${match.slice(1).join(' ')}` : phone
}

// Le lien officiel de Microsoft Teams pour ouvrir une discussion avec cette adresse.
const teamsChat = (email: string) => `https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(email)}`

// initialSearch : la recherche tapée dans la barre du haut (ex. /directory?search=karim).
export function DirectoryList({ initialSearch = '' }: { initialSearch?: string }) {
  // Ce qu'on tape, et ce qu'on envoie à l'API 300 ms après la dernière touche.
  const [query, setQuery] = useState(initialSearch)
  const [search, setSearch] = useState(initialSearch)
  const [direction, setDirection] = useState('')
  const [department, setDepartment] = useState('')
  const [page, setPage] = useState(1)
  // L'affichage choisi la dernière fois (seulement un confort : stockage bloqué -> "Cartes").
  // (La page s'affiche après la connexion, dans le navigateur : localStorage existe ici.)
  const [view, setView] = useState<View>(() => {
    try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'cards' } catch { return 'cards' }
  })
  const [options, setOptions] = useState<DirectionOption[]>([])
  const [opened, setOpened] = useState<DirectoryPerson | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = query.trim()
      if (next !== search) {
        setSearch(next)
        setPage(1)  // une nouvelle recherche repart de la page 1
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [query, search])

  // Les choix des filtres, une seule fois.
  useEffect(() => {
    apiFetch('/api/employees/directory/filters/')
      .then(async (response) => { if (response.ok) setOptions(await response.json()) })
      .catch(() => { /* sans filtres, la recherche marche quand même */ })
  }, [])

  function chooseView(next: View) {
    setView(next)
    try { localStorage.setItem(VIEW_KEY, next) } catch { /* rien */ }
  }

  function chooseDirection(id: string) {
    setDirection(id)
    setDepartment('')  // les services dépendent de la direction
    setPage(1)
  }

  function clearAll() {
    setQuery('')
    setSearch('')
    chooseDirection('')
  }

  const params = new URLSearchParams({ page: String(page) })
  if (search) params.set('search', search)
  if (direction) params.set('direction', direction)
  if (department) params.set('department', department)
  const { data, loading, failed, retry } = usePaged<DirectoryPerson>('/api/employees/directory/', params)

  const pageCount = data ? Math.max(1, Math.ceil(data.count / PAGE_SIZE)) : 1
  const departments = options.find((item) => String(item.id) === direction)?.departments ?? []
  const filtered = Boolean(search || direction)
  const first = data && data.count > 0 ? (page - 1) * PAGE_SIZE + 1 : 0
  const last = data ? Math.min(page * PAGE_SIZE, data.count) : 0

  return <div className="flex flex-col gap-4">
    <PersonPanel person={opened} onClose={() => setOpened(null)} />

    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-[#192646]"><UsersRound className="size-5 text-[#8C6D52]" aria-hidden /> Employee Directory</h1>
        <p className="text-xs text-slate-500">Find a colleague in SBD and Riaya: write, call or chat in one click.</p>
      </div>
      {data && <p className="text-xs text-slate-500"><b className="font-semibold tabular-nums text-[#192646]">{data.count}</b> colleague{data.count === 1 ? '' : 's'}{filtered ? ' found' : ''}</p>}
    </div>

    {/* La barre d'outils : recherche, filtres, affichage. */}
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/80 bg-white p-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="relative min-w-[220px] flex-1">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <label htmlFor="directory-search" className="sr-only">Search a colleague</label>
        <input id="directory-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, position or department..."
          className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-8 text-[13px] outline-none placeholder:text-slate-400 focus:border-[#23355d] focus:bg-white" />
        {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear the search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700"><X className="size-3.5" /></button>}
      </div>

      <label htmlFor="directory-direction" className="sr-only">Direction</label>
      <select id="directory-direction" value={direction} onChange={(e) => chooseDirection(e.target.value)} className={selectClass}>
        <option value="">All directions</option>
        {options.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.entity} ({item.count})</option>)}
      </select>

      <label htmlFor="directory-department" className="sr-only">Department</label>
      <select id="directory-department" value={department} disabled={!direction} onChange={(e) => { setDepartment(e.target.value); setPage(1) }} className={selectClass}>
        <option value="">{direction ? 'All departments' : 'Department'}</option>
        {departments.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.count})</option>)}
      </select>

      {filtered && <button type="button" onClick={clearAll} className="rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-[#23355d]">Clear</button>}

      {/* Cartes / Liste. */}
      <div role="group" aria-label="Display" className="ml-auto flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
        {([['cards', LayoutGrid, 'Cards'], ['list', List, 'List']] as const).map(([id, Icon, label]) =>
          <button key={id} type="button" onClick={() => chooseView(id)} aria-pressed={view === id} title={label}
            className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold',
              view === id ? 'bg-white text-[#23355d] shadow-sm' : 'text-slate-500 hover:text-[#23355d]')}>
            <Icon className="size-3.5" aria-hidden /><span className="hidden sm:inline">{label}</span>
          </button>)}
      </div>
    </div>

    {!data && failed ? (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-slate-200/80 bg-white px-4 py-12 text-center">
        <p className="text-sm text-slate-600">Could not load the directory. Please try again.</p>
        <button type="button" onClick={retry} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"><RotateCw className="size-3.5" /> Try again</button>
      </div>
    ) : !data ? (
      <Skeleton view={view} />
    ) : data.results.length === 0 ? (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-slate-200/80 bg-white px-4 py-14 text-center">
        <SearchX className="size-8 text-slate-300" aria-hidden />
        <p className="text-sm font-semibold text-slate-700">No colleague found</p>
        <p className="text-xs text-slate-500">Try another name, or clear the filters.</p>
        {filtered && <button type="button" onClick={clearAll} className="mt-1 text-xs font-semibold text-[#23355d] hover:underline">Clear the search and filters</button>}
      </div>
    ) : (
      <div aria-busy={loading} className={cn('flex flex-col gap-3 transition-opacity', loading && 'opacity-60')}>
        {view === 'cards'
          ? <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {data.results.map((person) => <PersonCard key={person.id} person={person} onOpen={() => setOpened(person)} />)}
            </ul>
          : <PeopleTable people={data.results} onOpen={setOpened} />}

        {/* Pagination : "1–25 of 48". */}
        <footer className="flex items-center justify-end gap-1 text-[11px] text-slate-500">
          <span className="mr-2 tabular-nums">{first}–{last} of {data.count}</span>
          <button type="button" aria-label="Previous page" disabled={!data.previous || loading} onClick={() => setPage(page - 1)} className={pagerClass}><ChevronLeft className="size-4" /></button>
          <span className="tabular-nums">Page {page} / {pageCount}</span>
          <button type="button" aria-label="Next page" disabled={!data.next || loading} onClick={() => setPage(page + 1)} className={pagerClass}><ChevronRight className="size-4" /></button>
        </footer>
      </div>
    )}
  </div>
}

const selectClass = 'h-9 max-w-[240px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700 outline-none focus:border-[#23355d] disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400'
const pagerClass = 'rounded-md p-1 text-slate-500 hover:bg-white hover:text-[#23355d] disabled:opacity-40 disabled:hover:bg-transparent'

function PersonAvatar({ person, size = 'md' }: { person: DirectoryPerson; size?: 'sm' | 'md' | 'lg' }) {
  return <span aria-hidden className={cn('flex shrink-0 items-center justify-center rounded-full font-bold', colorOf(person),
    size === 'sm' && 'size-8 text-[11px]', size === 'md' && 'size-11 text-sm', size === 'lg' && 'size-20 text-2xl')}>
    {initialsOf(person)}
  </span>
}

/** La carte d'un collègue : un clic ouvre sa carte de visite ; en bas, les actions rapides. */
function PersonCard({ person, onOpen }: { person: DirectoryPerson; onOpen: () => void }) {
  return <li className="group flex flex-col rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-slate-300 hover:shadow-md">
    <button type="button" onClick={onOpen} className="flex flex-1 items-start gap-3 rounded-t-xl p-4 text-left focus-visible:outline-2 focus-visible:outline-[#23355d]">
      <PersonAvatar person={person} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-[#192646] group-hover:text-[#23355d]">{person.first_name} {person.last_name.toUpperCase()}</span>
        <span className="block truncate text-xs text-slate-600">{person.position}</span>
        <span className="mt-1.5 flex items-center gap-1 truncate text-[11px] text-slate-400">
          <Building2 className="size-3 shrink-0" aria-hidden /><span className="truncate">{person.department} · {person.direction}</span>
        </span>
      </span>
    </button>
    <QuickActions person={person} className="border-t border-slate-100 px-3 py-2" />
  </li>
}

/** La vue Liste : plus dense, pour parcourir beaucoup de monde. */
function PeopleTable({ people, onOpen }: { people: DirectoryPerson[]; onOpen: (person: DirectoryPerson) => void }) {
  return <div className="overflow-x-auto rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <table className="w-full min-w-[760px] text-xs">
      <thead>
        <tr className="border-b border-slate-100 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          <th className="px-4 py-2.5">Name</th><th className="px-3 py-2.5">Department</th><th className="px-3 py-2.5">Email</th>
          <th className="px-3 py-2.5">Phone</th><th className="px-3 py-2.5"><span className="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        {people.map((person) => <tr key={person.id} className="border-t border-slate-100 first:border-t-0 hover:bg-slate-50/70">
          <td className="px-4 py-2">
            <button type="button" onClick={() => onOpen(person)} className="flex items-center gap-2.5 text-left">
              <PersonAvatar person={person} size="sm" />
              <span className="min-w-0">
                <span className="block font-semibold text-[#192646] hover:underline">{person.first_name} {person.last_name.toUpperCase()}</span>
                <span className="block text-[11px] text-slate-500">{person.position}</span>
              </span>
            </button>
          </td>
          <td className="px-3 py-2 text-slate-600">{person.department}<span className="block text-[11px] text-slate-400">{person.direction}</span></td>
          <td className="px-3 py-2"><a href={`mailto:${person.professional_email}`} className="text-[#23355d] hover:underline">{person.professional_email}</a></td>
          <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-600">{person.phone ? <a href={`tel:${person.phone}`} className="hover:underline">{formatPhone(person.phone)}</a> : '—'}</td>
          <td className="px-3 py-2"><QuickActions person={person} className="justify-end" withoutMail /></td>
        </tr>)}
      </tbody>
    </table>
  </div>
}

/** Les actions rapides : écrire (Outlook), appeler, copier l'email, discuter dans Teams. */
function QuickActions({ person, className, withoutMail = false }: { person: DirectoryPerson; className?: string; withoutMail?: boolean }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(person.professional_email)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* presse-papiers refusé par le navigateur : rien à faire */ }
  }

  const name = `${person.first_name} ${person.last_name}`
  const iconClass = 'flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-[#23355d]'
  return <div className={cn('flex items-center gap-1', className)}>
    {!withoutMail && <a href={`mailto:${person.professional_email}`} title="Send an email" aria-label={`Email ${name}`} className={iconClass}><Mail className="size-4" /></a>}
    {person.phone && <a href={`tel:${person.phone}`} title={`Call ${formatPhone(person.phone)}`} aria-label={`Call ${name}`} className={iconClass}><Phone className="size-4" /></a>}
    <a href={teamsChat(person.professional_email)} target="_blank" rel="noopener noreferrer" title="Chat in Microsoft Teams" aria-label={`Chat with ${name} in Teams`} className={iconClass}><MessageSquare className="size-4" /></a>
    <button type="button" onClick={copy} title={copied ? 'Copied' : 'Copy the email'} aria-label={`Copy the email of ${name}`}
      className={cn(iconClass, copied && 'text-emerald-600 hover:text-emerald-600')}>
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
    </button>
    <span role="status" className="sr-only">{copied ? 'Email copied' : ''}</span>
  </div>
}

/** La carte de visite (panneau à droite) : les mêmes champs publics, en grand, avec les boutons de contact. */
function PersonPanel({ person, onClose }: { person: DirectoryPerson | null; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const shown = person

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (person && !dialog.open) dialog.showModal()
    if (!person && dialog.open) dialog.close()
  }, [person])

  return <dialog ref={dialogRef} onClose={onClose} aria-label="Colleague"
    onClick={(e) => { if (e.target === dialogRef.current) onClose() }}  // clic sur le fond grisé : on ferme
    className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-dvh w-[min(100vw,420px)] max-w-none overflow-y-auto border-l border-slate-200 bg-white p-0 shadow-2xl backdrop:bg-slate-900/40">
    {shown && <div className="flex min-h-full flex-col">
      <div className="flex justify-end px-4 pt-4">
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="size-4" /></button>
      </div>
      <div className="flex flex-col items-center gap-1 px-6 pb-6 text-center">
        <PersonAvatar person={shown} size="lg" />
        <h2 className="mt-3 text-lg font-semibold text-[#192646]">{shown.first_name} {shown.last_name.toUpperCase()}</h2>
        <p className="text-sm text-slate-600">{shown.position}</p>
        <p className="text-xs text-slate-400">{shown.department} · {shown.direction}</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <a href={`mailto:${shown.professional_email}`} className={panelButton}><Mail className="size-4" /> Email</a>
          {shown.phone && <a href={`tel:${shown.phone}`} className={panelButton}><Phone className="size-4" /> Call</a>}
          <a href={teamsChat(shown.professional_email)} target="_blank" rel="noopener noreferrer" className={panelButton}><MessageSquare className="size-4" /> Teams</a>
        </div>
      </div>

      <dl className="mx-5 mb-5 divide-y divide-slate-100 rounded-xl border border-slate-200/80 text-sm">
        <PanelRow label="Email" value={shown.professional_email} />
        <PanelRow label="Phone" value={shown.phone ? formatPhone(shown.phone) : ''} copyValue={shown.phone} />
        <PanelRow label="Position" value={shown.position} />
        <PanelRow label="Department" value={shown.department} />
        <PanelRow label="Direction" value={shown.direction} />
      </dl>
    </div>}
  </dialog>
}

const panelButton = 'flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-[#23355d] hover:border-[#23355d] hover:bg-slate-50'

// Une ligne de la carte de visite ; l'email et le téléphone ont un bouton "copier".
function PanelRow({ label, value, copyValue }: { label: string; value: string; copyValue?: string }) {
  const [copied, setCopied] = useState(false)
  const copyable = label === 'Email' || label === 'Phone'

  async function copy() {
    try {
      await navigator.clipboard.writeText(copyValue ?? value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* refusé par le navigateur */ }
  }

  return <div className="flex items-center gap-3 px-4 py-2.5">
    <dt className="w-24 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
    <dd className="min-w-0 flex-1 break-words text-slate-700">{value || '—'}</dd>
    {copyable && value && <button type="button" onClick={copy} aria-label={`Copy the ${label.toLowerCase()}`} title={copied ? 'Copied' : 'Copy'}
      className={cn('rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-[#23355d]', copied && 'text-emerald-600')}>
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>}
  </div>
}

/** Pendant le premier chargement : des cartes grises à la place des vraies (la page ne "saute" pas). */
function Skeleton({ view }: { view: View }) {
  return <ul aria-label="Loading" className={cn('grid gap-3', view === 'cards' ? 'sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4' : '')}>
    {Array.from({ length: view === 'cards' ? 8 : 6 }, (_, index) => <li key={index} className="flex animate-pulse items-center gap-3 rounded-xl border border-slate-200/80 bg-white p-4">
      <span className="size-11 rounded-full bg-slate-100" />
      <span className="flex flex-1 flex-col gap-2"><span className="h-3 w-2/3 rounded bg-slate-100" /><span className="h-2.5 w-1/2 rounded bg-slate-100" /></span>
    </li>)}
  </ul>
}
