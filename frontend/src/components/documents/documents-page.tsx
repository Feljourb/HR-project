'use client'

/*
 * La page "Administrative documents" (tous les rôles, 2026-11-12) : demander un document aux RH, puis le télécharger.
 * Standard (Workday, SAP, BambooHR) : à gauche le formulaire, à droite "My documents" (le style de "My leaves" :
 * filtres en pastilles, les 5 dernières puis "Show all"). Une attestation de travail est générée par l'application
 * dès que les RH valident ; les autres documents sont préparés et déposés par les RH.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { CheckCircle2, FileText, Loader2, Send } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { STATE, type DocumentRequest, type DocumentType } from '@/lib/documents'
import { formatDate } from '@/lib/leaves'
import { cn } from '@/lib/utils'
import { sendChange } from '@/lib/workflows'
import { SelectField, TextField } from '@/components/employees/form-fields'
import { CancelClaim, actionClass } from '@/components/expenses/claim-actions'
import { Message } from '@/components/leaves/leaves-page'
import { StatTiles } from '@/components/leaves/stat-tiles'
import { DownloadButton } from './download-button'

type Loaded = { documents: DocumentRequest[]; types: DocumentType[] }

export function DocumentsPage() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [problem, setProblem] = useState('')
  const [version, setVersion] = useState(0)  // +1 après un envoi / une annulation : tout est relu
  const reload = useCallback(() => setVersion((old) => old + 1), [])

  useEffect(() => {
    Promise.all([apiFetch('/api/documents/mine/'), apiFetch('/api/documents/types/')])
      .then(async ([documents, types]) => {
        if (!documents.ok || !types.ok) throw new Error()
        setLoaded({ documents: await documents.json(), types: await types.json() })
      })
      .catch(() => setProblem('Could not load your documents. Please try again later.'))
  }, [version])

  if (loaded === null) return <Message>{problem || 'Loading...'}</Message>
  const { documents } = loaded
  const count = (state: string) => documents.filter((document) => document.state === state).length

  return <div className="flex flex-col gap-4">
    <div>
      <h1 className="text-lg font-semibold text-[#192646]">Administrative documents</h1>
      <p className="text-xs text-slate-500">Ask HR for a document (work certificate, salary certificate...), then download it here once it is ready.</p>
    </div>

    <StatTiles label="My documents" tiles={[
      { label: 'Requests', value: String(documents.length), hint: 'All my requests' },
      { label: 'In approval', value: String(count('IN_PROGRESS')), hint: 'Waiting for HR' },
      { label: 'Being prepared', value: String(count('TO_PREPARE')), hint: 'Approved, HR prepare it' },
      { label: 'Ready', value: String(count('READY')), hint: 'To download', strong: true },
    ]} />

    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <RequestForm types={loaded.types} onSent={reload} />
      <MyDocuments documents={documents} onChanged={reload} />
    </div>
  </div>
}

/** "Request a document" : le type, et pour qui / pourquoi (facultatif, ex. "Banque"). */
function RequestForm({ types, onSent }: { types: DocumentType[]; onSent: () => void }) {
  const [typeId, setTypeId] = useState('')
  const [purpose, setPurpose] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState('')
  const chosen = types.find((type) => String(type.id) === typeId)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const result = await sendChange<DocumentRequest>(
      () => apiFetch('/api/documents/mine/', { method: 'POST', body: JSON.stringify({ doc_type: typeId, purpose }) }),
      'You cannot request this document.')
    setBusy(false)
    if ('error' in result) return setError(result.error)
    setSent(result.data.doc_type)
    setTypeId('')
    setPurpose('')
    onSent()
  }

  return <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <div>
      <h2 className="text-sm font-semibold text-[#192646]">Request a document</h2>
      <p className="text-[11px] text-slate-500">HR of your pôle approve the request. You get a notification and an email when it is ready.</p>
    </div>
    <SelectField id="doc-type" label="Document" required value={typeId} onChange={(value) => { setTypeId(value); setError(''); setSent('') }}
      options={types.map((type) => ({ id: String(type.id), name: type.name }))} placeholder="Choose a document"
      hint={chosen ? (chosen.automatic ? 'Generated automatically as soon as HR approve.' : 'Prepared and signed by HR after their approval.') : undefined} />
    <TextField id="doc-purpose" label="For / purpose" value={purpose} onChange={setPurpose} placeholder="e.g. Bank, visa, rental (optional)" />
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
  { id: 'ready', label: 'Ready', match: (d: DocumentRequest) => d.state === 'READY' },
  { id: 'closed', label: 'Closed', match: (d: DocumentRequest) => d.state === 'REJECTED' || d.state === 'CANCELLED' },
]
const FIRST = 5
const SHORT_MONTH = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { month: 'short' })

function MyDocuments({ documents, onChanged }: { documents: DocumentRequest[]; onChanged: () => void }) {
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
            : <ul className="divide-y divide-slate-100">{shown.map((document) => <DocumentLine key={document.id} document={document} onChanged={onChanged} />)}</ul>}
          {filtered.length > FIRST && <button type="button" onClick={() => setAll((old) => !old)}
            className="w-full border-t border-slate-100 px-4 py-2.5 text-xs font-semibold text-[#23355d] hover:bg-slate-50">
            {all ? 'Show less' : `Show all (${filtered.length})`}
          </button>}
        </>}
  </section>
}

function DocumentLine({ document, onChanged }: { document: DocumentRequest; onChanged: () => void }) {
  const sent = document.created_at.slice(0, 10)
  const ended = document.state === 'REJECTED' || document.state === 'CANCELLED'
  const state = STATE[document.state]
  const extras = [
    document.purpose && `for ${document.purpose}`,
    `requested ${formatDate(sent)}`,
    document.state === 'IN_PROGRESS' && 'waiting for HR',
    document.state === 'TO_PREPARE' && 'HR are preparing it',
    document.reference && `ref. ${document.reference}`,
    document.refusal && `reason: ${document.refusal}`,
  ].filter(Boolean)
  return <li className={cn('flex items-start gap-3 px-4 py-3', ended && 'opacity-60')}>
    <span className="flex w-11 shrink-0 flex-col items-center rounded-lg border border-slate-200 bg-slate-50 py-1" aria-hidden>
      <span className="text-[9px] font-bold uppercase tracking-wide text-[#8C6D52]">{SHORT_MONTH(sent)}</span>
      <span className="text-base font-semibold leading-tight text-[#192646]">{Number(sent.slice(8, 10))}</span>
    </span>
    <div className="min-w-0 flex-1">
      <Link href={`/requests/${document.request}?from=documents`} className="block truncate text-sm font-semibold text-[#192646] hover:underline">
        {document.doc_type}
      </Link>
      <p className="truncate text-[11px] text-slate-400">{extras.join(' · ')}</p>
    </div>
    <div className="flex shrink-0 flex-col items-end gap-1">
      <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', state.badge)}>{state.label}</span>
      <div className="flex items-center gap-1">
        <DownloadButton document={document} />
        <CancelClaim claim={document} onCancelled={onChanged} />
        <Link href={`/requests/${document.request}?from=documents`} className={actionClass}>History</Link>
      </div>
    </div>
  </li>
}
