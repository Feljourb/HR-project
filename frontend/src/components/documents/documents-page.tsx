'use client'

/*
 * La page "Administrative documents" (tous les rôles, 2026-11-12) : demander un document aux RH, puis le télécharger.
 * Standard (Workday, SAP, BambooHR) : à gauche le formulaire, à droite "My documents" (le style de "My leaves" :
 * filtres en pastilles, les 5 dernières puis "Show all"). Une attestation de travail est générée par l'application
 * dès que les RH valident ; les autres documents sont préparés et déposés par les RH.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { CheckCircle2, ChevronRight, FileText, Loader2, Send, UsersRound } from 'lucide-react'
import { apiFetch, isHr, type Me } from '@/lib/api'
import { FORMATS, originalText, stateOf, type DocumentFormat, type DocumentRequest, type DocumentType, type TeamMember } from '@/lib/documents'
import { formatDate } from '@/lib/leaves'
import { cn } from '@/lib/utils'
import { sendChange } from '@/lib/workflows'
import { SelectField, TextField } from '@/components/employees/form-fields'
import { CancelClaim, actionClass } from '@/components/expenses/claim-actions'
import { Message } from '@/components/leaves/leaves-page'
import { StatTiles } from '@/components/leaves/stat-tiles'
import { PersonPicker, type Person } from '@/components/requests/out-of-office'
import { DocumentPanel } from './document-panel'
import { DownloadButton } from './download-button'

// team : MON équipe (je suis leur N+1 ; vide si Admin RH ne le permet pas) ; forTeam : ce que j'ai demandé pour elle
// (2026-11-16, "Manager Self-Service") ; formats : ceux qu'Admin RH propose (2026-11-17).
type Loaded = { documents: DocumentRequest[]; types: DocumentType[]; team: TeamMember[]; forTeam: DocumentRequest[]; formats: DocumentFormat[] }

export function DocumentsPage({ me }: { me: Me }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [problem, setProblem] = useState('')
  const [version, setVersion] = useState(0)  // +1 après un envoi / une annulation : tout est relu
  const reload = useCallback(() => setVersion((old) => old + 1), [])
  const [opened, setOpened] = useState<number | null>(null)  // la demande ouverte dans le panneau (son n°)

  useEffect(() => {
    const paths = ['/api/documents/mine/', '/api/documents/types/', '/api/documents/mine/team-members/', '/api/documents/mine/for-team/',
      '/api/documents/mine/options/']
    Promise.all(paths.map((path) => apiFetch(path)))
      .then(async ([documents, types, team, forTeam, options]) => {
        if (!documents.ok || !types.ok) throw new Error()
        const offered: { formats: DocumentFormat[] } = options.ok ? await options.json() : { formats: ['PDF', 'ORIGINAL', 'BOTH'] }
        setLoaded({ documents: await documents.json(), types: await types.json(),
          team: team.ok ? await team.json() : [], forTeam: forTeam.ok ? await forTeam.json() : [], formats: offered.formats })
      })
      .catch(() => setProblem('Could not load your documents. Please try again later.'))
  }, [version])

  if (loaded === null) return <Message>{problem || 'Loading...'}</Message>
  const { documents } = loaded
  const count = (state: string) => documents.filter((document) => document.state === state).length
  // "Ready" = ce qui m'attend encore : un original à récupérer, ou un document prêt et pas encore récupéré
  // (un original déjà remis ne compte plus : rien à faire).
  const waitingForMe = documents.filter((document) =>
    document.state === 'PICKUP' || (document.state === 'READY' && !document.collected_at)).length

  return <div className="flex flex-col gap-4">
    <div>
      <h1 className="text-lg font-semibold text-[#192646]">Administrative documents</h1>
      <p className="text-xs text-slate-500">Ask HR for a document (work certificate, salary certificate...), then download it here once it is ready.</p>
    </div>

    <StatTiles label="My documents" tiles={[
      { label: 'Requests', value: String(documents.length), hint: 'All my requests' },
      { label: 'In approval', value: String(count('IN_PROGRESS')), hint: 'Waiting for HR' },
      { label: 'Being prepared', value: String(count('TO_PREPARE')), hint: 'Approved, HR prepare it' },
      { label: 'Ready', value: String(waitingForMe), hint: 'To download or pick up', strong: true },
    ]} />

    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <RequestForm types={loaded.types} hr={isHr(me)} team={loaded.team} formats={loaded.formats} onSent={reload} />
        <HowItWorks />
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <MyDocuments documents={documents} onChanged={reload} onOpen={setOpened} />
        {/* Ce que j'ai demandé pour mon équipe : sa place est Team approvals -> "For my team" (une chose, une place) ;
            ici seulement un lien, avec ce qui demande une action (un original à faire récupérer). */}
        {loaded.forTeam.length > 0 && <TeamLink documents={loaded.forTeam} />}
      </div>
    </div>

    {/* Le détail d'une demande : le PDF, l'original, toute la ligne du temps (la trace), sans quitter la page. */}
    <DocumentPanel requestId={opened} onClose={() => setOpened(null)} onChanged={reload} />
  </div>
}

/** Un lien vers Team approvals -> "For my team" : combien de demandes, et combien d'originaux à faire récupérer. */
function TeamLink({ documents }: { documents: DocumentRequest[] }) {
  const pickups = documents.filter((document) => document.state === 'PICKUP').length
  return <Link href="/approvals?tab=team"
    className="flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-[#23355d]/30 hover:bg-slate-50">
    <span className="flex size-8 items-center justify-center rounded-lg bg-[#E4E9F2] text-[#23355d]" aria-hidden><UsersRound className="size-4" /></span>
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-semibold text-[#192646]">Requested for my team</span>
      <span className="block text-[11px] text-slate-500">{documents.length} request{documents.length > 1 ? 's' : ''} · follow them in Team approvals</span>
    </span>
    {pickups > 0 && <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-bold text-white">{pickups} to pick up</span>}
    <ChevronRight className="size-4 text-slate-400" aria-hidden />
  </Link>
}

/** Le circuit d'une demande, en 4 étapes (comme l'outil actuel des RH) : chacun sait ce qui va se passer. */
function HowItWorks() {
  const steps = [
    'You send your request (document and purpose).',
    'HR of your pôle review it.',
    'The document is delivered: generated at once, or prepared by HR within the announced delay (working days).',
    'You get a notification and an email: download the PDF here, or pick up the signed original at the HR office. You can cancel while it is in approval.',
  ]
  return <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <h2 className="text-sm font-semibold text-[#192646]">How it works</h2>
    <ol className="mt-2 flex flex-col gap-2">
      {steps.map((step, index) => <li key={step} className="flex gap-2.5 text-xs text-slate-600">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#E4E9F2] text-[10px] font-bold text-[#23355d]">{index + 1}</span>
        {step}
      </li>)}
    </ol>
  </section>
}

/** Le délai annoncé d'un type : "Generated at once" ou "Ready within 2 working days". */
function delayHint(type: DocumentType) {
  if (type.automatic) return 'Generated automatically as soon as HR approve.'
  const days = type.delivery_days
  return `Prepared and signed by HR: ready within ${days} working day${days > 1 ? 's' : ''}.`
}

/** "Request a document" : le type, et pour qui / pourquoi (facultatif, ex. "Banque").
 *  Un RH peut demander POUR un collaborateur de son pôle (champ "Employee", comme l'outil actuel) : acceptée tout de suite.
 *  Un manager (2026-11-16) : "For" = moi-même ou quelqu'un de son équipe (ex. un ouvrier qui n'utilise pas l'application) ;
 *  seulement les types choisis par Admin RH, l'original papier par défaut, et les RH valident comme d'habitude. */
function RequestForm({ types, hr, team, formats, onSent }: {
  types: DocumentType[]; hr: boolean; team: TeamMember[]; formats: DocumentFormat[]; onSent: () => void
}) {
  // Les formats proposés (réglage d'Admin RH, 2026-11-17) ; les RH gardent les trois. Un seul : pas de question.
  const offered = hr ? FORMATS : FORMATS.filter((option) => formats.includes(option.id))
  const firstFormat = offered[0]?.id ?? 'PDF'
  const [typeId, setTypeId] = useState('')
  const [purpose, setPurpose] = useState('')
  const [format, setFormat] = useState<DocumentFormat>(firstFormat)
  const [forEmployee, setForEmployee] = useState<Person | null>(null)  // null : pour moi-même
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState('')
  // Un manager qui demande pour son équipe : seulement les documents permis par Admin RH.
  const forTeam = !hr && forEmployee !== null
  const choices = forTeam ? types.filter((type) => type.manager_can_request) : types
  const chosen = choices.find((type) => String(type.id) === typeId)

  function chooseFor(id: string) {
    const member = team.find((person) => String(person.id) === id) ?? null
    setForEmployee(member)
    setTypeId('')
    // Pour un membre de l'équipe : le papier (qu'il récupère au bureau RH), s'il est proposé.
    setFormat(member && offered.some((option) => option.id === 'ORIGINAL') ? 'ORIGINAL' : firstFormat)
    setError('')
    setSent('')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const body = { doc_type: typeId, purpose, format, ...(forEmployee ? { employee: forEmployee.id } : {}) }
    const result = await sendChange<DocumentRequest>(
      () => apiFetch('/api/documents/mine/', { method: 'POST', body: JSON.stringify(body) }),
      'You cannot request this document.')
    setBusy(false)
    if ('error' in result) return setError(result.error)
    setSent(!forEmployee ? result.data.doc_type
      : hr ? `${result.data.doc_type} for ${result.data.employee} (see Document requests)`
      : `${result.data.doc_type} for ${result.data.employee} (follow it in Team approvals → For my team)`)
    setTypeId('')
    setPurpose('')
    setFormat(firstFormat)
    setForEmployee(null)
    onSent()
  }

  return <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <div>
      <h2 className="text-sm font-semibold text-[#192646]">Request a document</h2>
      <p className="text-[11px] text-slate-500">HR of your pôle approve the request. You get a notification and an email when it is ready.</p>
    </div>
    {hr && <div>
      <PersonPicker id="doc-employee" label="Employee (HR)" value={forEmployee} onChange={setForEmployee}
        source={(search) => `/api/employees/?search=${search}`} />
      <p className="mt-1 text-[11px] text-slate-500">{forEmployee ? 'Requested by HR: approved at once, the employee is notified.' : 'Empty = for yourself.'}</p>
    </div>}
    {/* Un manager : pour moi, ou pour quelqu'un de mon équipe (je suis son N+1). */}
    {!hr && team.length > 0 && <SelectField id="doc-for" label="For" value={forEmployee ? String(forEmployee.id) : ''} onChange={chooseFor}
      options={team.map((person) => ({ id: String(person.id), name: `${person.first_name} ${person.last_name} · ${person.position}` }))}
      placeholder="Myself"
      hint={forTeam ? 'For your team: HR approve it, the employee is notified. You follow the progress; the document goes to the employee.' : undefined} />}
    <SelectField id="doc-type" label="Document" required value={typeId} onChange={(value) => { setTypeId(value); setError(''); setSent('') }}
      options={choices.map((type) => ({ id: String(type.id), name: type.name }))} placeholder="Choose a document"
      hint={chosen ? delayHint(chosen) : undefined} />
    <TextField id="doc-purpose" label="For / purpose" value={purpose} onChange={setPurpose} placeholder="e.g. Bank, visa, rental (optional)" />
    {/* Le format : une banque ou un consulat demandent souvent l'ORIGINAL signé et tamponné à la main. */}
    {offered.length > 1 && <fieldset>
      <legend className="text-xs font-semibold text-slate-700">Format</legend>
      <div className={cn('mt-1.5 grid gap-2', offered.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
        {offered.map((option) => {
          const selected = format === option.id
          return <label key={option.id} className={cn('flex cursor-pointer gap-2 rounded-lg border px-2.5 py-2 transition-colors',
            selected ? 'border-[#23355d] bg-[#E4E9F2]/50 ring-1 ring-[#23355d]' : 'border-slate-200 hover:border-slate-300')}>
            <input type="radio" name="doc-format" value={option.id} checked={selected} onChange={() => setFormat(option.id)} className="mt-0.5 accent-[#192646]" />
            <span>
              <span className="block text-xs font-semibold text-[#192646]">{option.title}</span>
              <span className="block text-[11px] leading-snug text-slate-500">{option.text}</span>
            </span>
          </label>
        })}
      </div>
      {format !== 'PDF' && <p className="mt-1.5 text-[11px] text-slate-500">Banks and consulates often ask for the original. You get a notification when it is ready at the HR office.</p>}
    </fieldset>}
    {error && <p role="alert" className="text-[11px] font-medium text-red-600">{error}</p>}
    {sent && <p role="status" className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
      <CheckCircle2 className="size-4" /> Sent to HR: {sent}.
    </p>}
    <button type="submit" disabled={busy || !typeId}
      className="flex w-fit items-center gap-1.5 self-end rounded-lg bg-[#23355d] px-4 py-2 text-xs font-semibold text-white hover:bg-[#192646] disabled:opacity-50">
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Send request
    </button>
  </form>
}

// Les filtres (comme "My leaves") : "Closed" regroupe refusées et annulées.
const TABS = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'progress', label: 'In progress', match: (d: DocumentRequest) => d.state === 'IN_PROGRESS' || d.state === 'TO_PREPARE' },
  { id: 'ready', label: 'Ready', match: (d: DocumentRequest) => d.state === 'READY' || d.state === 'PICKUP' },
  { id: 'closed', label: 'Closed', match: (d: DocumentRequest) => d.state === 'REJECTED' || d.state === 'CANCELLED' },
]
const FIRST = 5
const SHORT_MONTH = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { month: 'short' })

function MyDocuments({ documents, onChanged, onOpen }: { documents: DocumentRequest[]; onChanged: () => void; onOpen: (request: number) => void }) {
  const [tab, setTab] = useState('all')
  const [all, setAll] = useState(false)
  const current = TABS.find((item) => item.id === tab) ?? TABS[0]
  const filtered = documents.filter(current.match)  // déjà la dernière demande d'abord (Django)
  const shown = all ? filtered : filtered.slice(0, FIRST)

  return <section className="rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <header className="px-4 pt-3">
      <h2 className="text-sm font-semibold text-[#192646]">My documents</h2>
      <p className="text-[11px] text-slate-500">The latest request first. Download a document as soon as it is ready.</p>
    </header>
    {documents.length === 0
      ? <p className="px-4 py-10 text-center text-sm text-slate-500"><FileText className="mx-auto mb-2 size-6 text-[#8C6D52]" />No document requested yet.</p>
      : <>
          <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1.5 border-b border-slate-100 px-4 pb-3 pt-2">
            {TABS.map((item) => {
              const selected = item.id === tab
              return <button key={item.id} type="button" aria-pressed={selected} onClick={() => { setTab(item.id); setAll(false) }}
                className={cn('flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors',
                  selected ? 'border-[#23355d] bg-[#23355d] text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-[#23355d]/40 hover:text-[#23355d]')}>
                {item.label}<span className={cn('tabular-nums', selected ? 'text-white/70' : 'text-slate-400')}>{documents.filter(item.match).length}</span>
              </button>
            })}
          </div>
          {shown.length === 0
            ? <p className="px-4 py-8 text-center text-xs text-slate-500">Nothing here.</p>
            : <ul className="divide-y divide-slate-100">{shown.map((document) => <DocumentLine key={document.id} document={document} onChanged={onChanged}
                onOpen={() => onOpen(document.request)} />)}</ul>}
          {filtered.length > FIRST && <button type="button" onClick={() => setAll((old) => !old)}
            className="w-full border-t border-slate-100 px-4 py-2.5 text-xs font-semibold text-[#23355d] hover:bg-slate-50">
            {all ? 'Show less' : `Show all (${filtered.length})`}
          </button>}
        </>}
  </section>
}

function DocumentLine({ document, onChanged, onOpen }: { document: DocumentRequest; onChanged: () => void; onOpen: () => void }) {
  const sent = document.created_at.slice(0, 10)
  const ended = document.state === 'REJECTED' || document.state === 'CANCELLED'
  const state = stateOf(document)
  const waiting = document.state === 'IN_PROGRESS' || document.state === 'TO_PREPARE'
  // Le détail en petit, sans répéter : la date est déjà dans le calendrier à gauche, la référence dans "Details".
  const extras = [
    document.purpose && `for ${document.purpose}`,
    document.format !== 'PDF' && FORMATS.find((option) => option.id === document.format)?.short,
    document.requested_by && `requested by ${document.requested_by}`,  // un RH, ou mon manager
    document.state === 'IN_PROGRESS' && 'waiting for HR',
    document.state === 'TO_PREPARE' && !document.original_state && 'HR are preparing it',
    originalText(document),  // l'original papier : en signature, prêt au bureau RH, récupéré
    // Le délai promis : "expected by 16/11/2026" tant que le document n'est pas prêt.
    waiting && document.due_date && `expected by ${formatDate(document.due_date)}`,
    document.refusal && `reason: ${document.refusal}`,
  ].filter(Boolean)
  return <li className={cn('flex items-center gap-3 px-4 py-3', ended && 'opacity-60')}>
    <span className="flex w-11 shrink-0 flex-col items-center rounded-lg border border-slate-200 bg-slate-50 py-1" aria-hidden>
      <span className="text-[9px] font-bold uppercase tracking-wide text-[#8C6D52]">{SHORT_MONTH(sent)}</span>
      <span className="text-base font-semibold leading-tight text-[#192646]">{Number(sent.slice(8, 10))}</span>
    </span>
    <div className="min-w-0 flex-1">
      <button type="button" onClick={onOpen} className="block max-w-full truncate text-left text-sm font-semibold text-[#192646] hover:underline">
        {document.doc_type}
      </button>
      <p className="truncate text-[11px] text-slate-400">{extras.join(' · ')}</p>
    </div>
    {/* Le statut et les actions sur UNE ligne, au milieu : la ligne est moins haute et l'œil va à un seul endroit. */}
    <div className="flex shrink-0 items-center gap-1">
      <span className={cn('mr-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', state.badge)}>{state.label}</span>
      <DownloadButton document={document} />
      <CancelClaim claim={document} onCancelled={onChanged} />
      <button type="button" onClick={onOpen} className={actionClass}>Details</button>
    </div>
  </li>
}

