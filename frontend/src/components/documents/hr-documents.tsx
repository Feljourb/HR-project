'use client'

/*
 * La page "Document requests" des RH (RH du pôle ; Admin RH et IT : les deux pôles), 2026-11-12.
 * On VALIDE dans Team approvals (le circuit, comme toute demande) ; ici on PRÉPARE : "To prepare" = les demandes
 * validées d'un document que l'application ne génère pas (ex. attestation de salaire) -> "Upload PDF" (le document
 * signé, scanné). Le collaborateur est prévenu (🔔 + email) et le télécharge dans sa page.
 * L'original papier (format "original" / "PDF + original") : Download -> imprimer, signer, tamponner -> "Original ready"
 * (le collaborateur est prévenu) -> il vient au bureau RH -> "Handed over" (onglet "To hand over").
 * Chaque demande a un délai promis (jours ouvrés du type) : le plus proche en premier, "Late" en rouge s'il est passé.
 */
import { useEffect, useState } from 'react'
import { FileText, Search, X } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { originalText, stateOf, type DocumentRequest, type DocumentType } from '@/lib/documents'
import { DatePicker } from '@/components/ui/date-picker'
import { formatDate } from '@/lib/leaves'
import { cn } from '@/lib/utils'
import { actionClass } from '@/components/expenses/claim-actions'
import { DocumentPanel } from './document-panel'
import { DownloadButton } from './download-button'
import { OriginalButtons } from './original-buttons'
import { UploadButton } from './upload-button'

const FILTERS = [
  { id: 'to_prepare', label: 'To prepare' },
  { id: 'pickup', label: 'To hand over' },  // l'original attend au bureau RH
  { id: 'in_progress', label: 'In approval' },
  { id: 'ready', label: 'Delivered' },
  { id: 'all', label: 'All' },
]

export function HrDocuments() {
  const [filter, setFilter] = useState('to_prepare')
  const [documents, setDocuments] = useState<DocumentRequest[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [version, setVersion] = useState(0)  // +1 après un dépôt : la liste est relue
  const [opened, setOpened] = useState<number | null>(null)  // la demande ouverte dans le panneau (son n°)
  const reload = () => setVersion((old) => old + 1)
  // Step B : retrouver une demande (nom ou matricule, type, période). Django filtre : la liste reste petite.
  const [search, setSearch] = useState('')
  const [typed, setTyped] = useState('')  // la recherche envoyée, 300 ms après la dernière touche
  const [type, setType] = useState('')
  const [period, setPeriod] = useState('')  // '' = any time, sinon un choix tout fait ou "custom"
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [types, setTypes] = useState<DocumentType[]>([])
  const [from, to] = period === 'custom' ? [customFrom, customTo] : periodDates(period)
  const filtered = Boolean(typed || type || period)

  useEffect(() => {
    apiFetch('/api/documents/types/').then(async (response) => { if (response.ok) setTypes(await response.json()) }).catch(() => {})
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setTyped(search.trim()), 300)  // pas une requête par lettre tapée
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    const query = new URLSearchParams({ status: filter, search: typed, type, from, to })
    const controller = new AbortController()
    apiFetch(`/api/documents/hr/?${query}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error()
        setDocuments(await response.json())
      })
      .catch((error) => { if (error?.name !== 'AbortError') setFailed(true) })
    return () => controller.abort()  // une autre recherche a commencé : l'ancienne réponse ne compte plus
  }, [filter, version, typed, type, from, to])

  function clearFilters() {
    setSearch('')
    setTyped('')
    setType('')
    setPeriod('')
    setCustomFrom('')
    setCustomTo('')
  }

  return <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
    <div>
      <h1 className="text-lg font-semibold text-[#192646]">Document requests</h1>
      <p className="text-xs text-slate-500">Approve the requests in Team approvals. Here, prepare what is left: upload the signed PDF, or print, sign and stamp the original, then hand it over.</p>
    </div>

    <div role="group" aria-label="Filter" className="flex flex-wrap gap-2">
      {FILTERS.map(({ id, label }) => {
        const selected = filter === id
        return <button key={id} type="button" aria-pressed={selected} onClick={() => { setFilter(id); setDocuments(null) }}
          className={cn('rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
            selected ? 'border-[#23355d] bg-[#23355d] text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-[#23355d]/40 hover:text-[#23355d]')}>
          {label}
        </button>
      })}
    </div>

    {/* La recherche, sur UNE ligne (standard Gmail / Linear) : le nom, le type de document, la période. */}
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-56 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search an employee (name or number)" aria-label="Search an employee"
          className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs outline-none focus:border-[#23355d] focus:ring-3 focus:ring-[#23355d]/15" />
      </div>
      <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Document" className={filterClass(Boolean(type))}>
        <option value="">All documents</option>
        {types.map((item) => <option key={item.id} value={String(item.id)}>{item.name}</option>)}
      </select>
      <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Requested" className={filterClass(Boolean(period))}>
        {PERIODS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>
      {/* "Custom dates" : les deux dates, sur la même ligne. */}
      {period === 'custom' && <div className="flex items-center gap-1.5">
        <DatePicker id="doc-from" value={customFrom} onChange={setCustomFrom} max={customTo || undefined} className="mt-0 w-36" />
        <span className="text-xs text-slate-400">→</span>
        <DatePicker id="doc-to" value={customTo} onChange={setCustomTo} min={customFrom || undefined} className="mt-0 w-36" />
      </div>}
      {filtered && <button type="button" onClick={clearFilters}
        className="flex h-9 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100">
        <X className="size-3.5" /> Clear
      </button>}
    </div>

    {documents === null
      ? <Box>{failed ? 'Could not load the document requests. Please try again later.' : 'Loading...'}</Box>
      : documents.length === 0
        ? <Box><FileText className="mx-auto mb-2 size-6 text-[#8C6D52]" />
            {filtered ? 'No request matches these filters.'
              : filter === 'to_prepare' ? 'Nothing to prepare.' : filter === 'pickup' ? 'No original waiting at the HR office.' : 'No request here.'}</Box>
        : <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            {documents.map((document) => <Row key={document.id} document={document} onChanged={reload} onOpen={() => setOpened(document.request)} />)}
          </ul>}

    {/* Le détail d'une demande (résumé, PDF, original, toute la ligne du temps), sans quitter la page. */}
    <DocumentPanel requestId={opened} onClose={() => setOpened(null)} onChanged={reload} forHr />
  </div>
}

// Un filtre choisi se voit (bordure bleue), comme dans Gmail / Linear.
const filterClass = (active: boolean) => cn('h-9 rounded-lg border bg-white px-2.5 text-xs outline-none focus:ring-3 focus:ring-[#23355d]/15',
  active ? 'border-[#23355d] font-semibold text-[#23355d]' : 'border-slate-200 text-slate-600')

// La période de la demande : des choix tout faits (le plus courant), ou des dates précises.
const PERIODS: [string, string][] = [
  ['', 'Any time'], ['month', 'This month'], ['30', 'Last 30 days'], ['year', 'This year'], ['custom', 'Custom dates…'],
]

/** Un choix tout fait -> [du, au] en "AAAA-MM-JJ" ('' = pas de limite). */
function periodDates(period: string): [string, string] {
  const today = new Date()
  const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  if (period === 'month') return [iso(new Date(today.getFullYear(), today.getMonth(), 1)), '']
  if (period === '30') return [iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 30)), '']
  if (period === 'year') return [iso(new Date(today.getFullYear(), 0, 1)), '']
  return ['', '']
}

function Box({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-slate-200 bg-white px-4 py-12 text-center text-sm text-slate-500">{children}</div>
}

function Row({ document, onChanged, onOpen }: { document: DocumentRequest; onChanged: () => void; onOpen: () => void }) {
  const state = stateOf(document)
  const waiting = document.state === 'IN_PROGRESS' || document.state === 'TO_PREPARE'
  const extras = [
    document.department,
    document.purpose && `for ${document.purpose}`,
    `requested ${formatDate(document.created_at.slice(0, 10))}`,
    document.requested_by && `by HR (${document.requested_by})`,
    waiting && document.due_date && `due ${formatDate(document.due_date)}`,
    document.reference && `ref. ${document.reference}`,
    document.delivered_at && (document.delivered_by ? `uploaded by ${document.delivered_by}` : 'generated by the app'),
    originalText(document),
    document.collected_by && `handed over by ${document.collected_by}`,
  ].filter(Boolean)

  return <li className="flex flex-wrap items-center gap-3 px-4 py-3">
    <div className="min-w-0 flex-1">
      <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[#192646]">
        <button type="button" onClick={onOpen} className="truncate text-left hover:underline">
          {document.doc_type} <span className="font-normal text-slate-500">· {document.employee}</span>
        </button>
        {/* Un original papier à signer à la main : visible tout de suite. */}
        {document.format !== 'PDF' && <span className="shrink-0 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700 ring-1 ring-inset ring-violet-200">
          {document.format === 'BOTH' ? 'PDF + original' : 'Original'}
        </span>}
      </p>
      <p className="truncate text-[11px] text-slate-400">{extras.join(' · ')}</p>
    </div>
    {/* Le délai promis est passé et le document n'est pas livré : à traiter en premier. */}
    {document.late && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 ring-1 ring-inset ring-red-200">Late</span>}
    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', state.badge)}>{state.label}</span>
    <div className="flex items-center gap-1">
      {/* Un document préparé par les RH : "Upload PDF" une fois validé, "Replace" s'il est déjà livré (ex. une erreur). */}
      {document.can_upload && <UploadButton document={document} onUploaded={onChanged} />}
      {/* Le PDF : aussi pour l'IMPRIMER quand le collaborateur veut l'original. */}
      <DownloadButton document={document} label={document.original_state === 'TO_SIGN' ? 'Print copy' : 'Download'} />
      <OriginalButtons document={document} onDone={onChanged} />
      <button type="button" onClick={onOpen} className={actionClass}>Details</button>
    </div>
  </li>
}

