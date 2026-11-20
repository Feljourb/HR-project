'use client'

/*
 * La page "My requests" : MES demandes (tous les rôles).
 * 3e version (2026-11-20, choix A de l'utilisatrice, standard ServiceNow / Workday "My requests") : UN tableau
 * (Type, Request, Sent, Status), des filtres sur une ligne au-dessus (recherche, type, statut, période), 20 lignes
 * par page. Une demande en cours dit qui doit répondre, et garde son bouton Cancel. Un clic ouvre son historique
 * (/requests/<id>) ; une note de frais ouvre la note.
 * Lu dans /api/workflows/requests/ : Django ne renvoie que les demandes de la personne connectée.
 */
import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { CalendarDays, ChevronLeft, ChevronRight, FileText, Inbox, Loader2, ReceiptText, Search, type LucideIcon } from 'lucide-react'
import { apiFetch, type Me } from '@/lib/api'
import { formatDate } from '@/lib/leaves'
import type { DecidedStep, WorkflowRequest } from '@/lib/requests'
import { cn } from '@/lib/utils'
import { sendChange } from '@/lib/workflows'
import { DecidedList } from './decided-list'

// L'icône de chaque type de demande (un repère pour l'œil, avant de lire).
const TYPE_ICON: Record<string, LucideIcon> = { LEAVE: CalendarDays, EXPENSE: ReceiptText, ADMIN_REQUEST: FileText }

// Le statut en anglais (la page est en anglais) : texte et pastille.
const STATUS: Record<string, { label: string; badge: string }> = {
  IN_PROGRESS: { label: 'In progress', badge: 'bg-amber-50 text-amber-700 ring-amber-200' },
  APPROVED: { label: 'Approved', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  REJECTED: { label: 'Refused', badge: 'bg-red-50 text-red-700 ring-red-200' },
  CANCELLED: { label: 'Cancelled', badge: 'bg-slate-100 text-slate-500 ring-slate-200' },
}

const TYPES = [
  { id: 'all', label: 'All types' },
  { id: 'LEAVE', label: 'Leave' },
  { id: 'EXPENSE', label: 'Expense claim' },
  { id: 'ADMIN_REQUEST', label: 'Document' },
]
const STATUSES = [
  { id: 'all', label: 'All statuses' },
  { id: 'IN_PROGRESS', label: 'In progress' },
  { id: 'APPROVED', label: 'Approved' },
  { id: 'REJECTED', label: 'Refused' },
  { id: 'CANCELLED', label: 'Cancelled' },
]
const PERIODS = [
  { id: 'all', label: 'Any date' },
  { id: 'month', label: 'This month' },
  { id: '3months', label: 'Last 3 months' },
  { id: 'year', label: 'This year' },
]
const PAGE = 20  // lignes par page

// "Attestation" et "attestation", "congé" et "conge" se trouvent l'un l'autre.
const plain = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** La demande a-t-elle été envoyée dans la période choisie ? */
function inPeriod(request: WorkflowRequest, period: string) {
  if (period === 'all') return true
  const sent = new Date(request.created_at)
  const now = new Date()
  if (period === 'month') return sent.getFullYear() === now.getFullYear() && sent.getMonth() === now.getMonth()
  if (period === 'year') return sent.getFullYear() === now.getFullYear()
  return now.getTime() - sent.getTime() <= 92 * 24 * 3600 * 1000  // 3 mois
}

/** Où ouvre une ligne : une note de frais ouvre la note (ses dépenses, ses justificatifs, son historique). */
// ?from=requests : la page ouverte affiche "← My requests" (le retour mène ici).
const hrefOf = (request: WorkflowRequest) => (request.workflow_code === 'EXPENSE' ? `/expenses/${request.id}?from=requests` : `/requests/${request.id}?from=requests`)

export function MyRequests({ me }: { me: Me }) {
  // Deux onglets (2026-11-12, standard Microsoft Teams "Approvals" : Sent / Received ; SAP : My Requests / My Inbox) :
  // "Sent" = ce que j'ai demandé ; "Received" = ce que j'ai répondu À LA PLACE d'un absent (la trace reste, même
  // quand la délégation est finie). Seulement pour un collaborateur qui l'a déjà fait.
  const hasReceived = me.stood_in === true && me.role === 'COLLABORATOR' && !me.is_superuser
  // ?tab=received : le retour de l'historique d'une demande "Received" rouvre cet onglet.
  const [tab, setTab] = useState<'sent' | 'received'>(useSearchParams().get('tab') === 'received' ? 'received' : 'sent')
  const [received, setReceived] = useState<DecidedStep[] | null>(null)
  const [requests, setRequests] = useState<WorkflowRequest[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [search, setSearch] = useState('')
  const [type, setType] = useState('all')
  const [status, setStatus] = useState('all')
  const [period, setPeriod] = useState('all')
  const [page, setPage] = useState(1)

  useEffect(() => {
    apiFetch('/api/workflows/requests/')
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status))
        setRequests(await response.json())
      })
      .catch(() => setFailed(true))
  }, [])

  useEffect(() => {
    if (!hasReceived) return
    apiFetch('/api/workflows/approvals/answered-for/')
      .then(async (response) => { if (response.ok) setReceived(await response.json()) })
      .catch(() => setReceived([]))
  }, [hasReceived])

  // Remplace une demande par sa nouvelle version (ex. après Cancel).
  function replace(updated: WorkflowRequest) {
    setRequests((list) => list && list.map((request) => (request.id === updated.id ? updated : request)))
  }

  // Un filtre change : retour à la page 1.
  function filterWith(change: () => void) {
    change()
    setPage(1)
  }

  // La plus récente d'abord ; puis les filtres.
  const everything = [...(requests ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))
  const searched = plain(search.trim())
  const rows = everything.filter((request) => (type === 'all' || request.workflow_code === type)
    && (status === 'all' || request.status === status) && inPeriod(request, period)
    && (!searched || plain(request.title).includes(searched)))
  const filtered = Boolean(searched) || type !== 'all' || status !== 'all' || period !== 'all'
  const pages = Math.max(1, Math.ceil(rows.length / PAGE))
  const current = Math.min(page, pages)
  const shown = rows.slice((current - 1) * PAGE, current * PAGE)
  const waiting = everything.filter((request) => request.status === 'IN_PROGRESS').length

  function clearFilters() {
    setSearch('')
    setType('all')
    setStatus('all')
    setPeriod('all')
    setPage(1)
  }

  return <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
    <div>
      <h1 className="text-lg font-semibold text-[#192646]">My requests</h1>
      <p className="text-xs text-slate-500">
        {tab === 'received' ? 'The requests you answered on behalf of a colleague who was away.'
          : `Everything you sent, the latest first${waiting ? ` · ${waiting} waiting for an answer` : ''}.`}
      </p>
    </div>

    {/* Sent / Received : un contrôle segmenté. */}
    {hasReceived && <div role="tablist" aria-label="Requests" className="flex w-fit rounded-lg bg-slate-200/70 p-1">
      {([['sent', 'Sent', requests?.length], ['received', 'Received', received?.length]] as const).map(([id, label, total]) => {
        const selected = tab === id
        return <button key={id} type="button" role="tab" aria-selected={selected} onClick={() => setTab(id)}
          className={cn('flex items-center gap-1.5 rounded-md px-4 py-1.5 text-xs font-semibold transition-colors',
            selected ? 'bg-white text-[#192646] shadow-sm' : 'text-slate-500 hover:text-[#192646]')}>
          {label}{total !== undefined && <span className="tabular-nums text-slate-400">{total}</span>}
        </button>
      })}
    </div>}

    {tab === 'received' && hasReceived
      ? received === null
        ? <Message>Loading...</Message>
        : received.length === 0
          ? <Message>Nothing answered as a stand-in yet.</Message>
          : <DecidedList items={received} from="received" />
      : requests === null
      ? <Message>{failed ? 'Could not load your requests. Please try again later.' : 'Loading...'}</Message>
      : everything.length === 0
        ? <Message><Inbox className="mx-auto mb-2 size-6 text-[#8C6D52]" />No request yet.</Message>
        : <section className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            {/* Les filtres, sur une ligne. */}
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
              <div className="relative min-w-0 flex-1 basis-56">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
                <label htmlFor="request-search" className="sr-only">Search a request</label>
                <input id="request-search" value={search} onChange={(e) => filterWith(() => setSearch(e.target.value))}
                  placeholder="Search a request…"
                  className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-[13px] outline-none placeholder:text-slate-400 focus:border-[#23355d] focus:bg-white" />
              </div>
              <Choice id="request-type" label="Type" value={type} options={TYPES} onChange={(value) => filterWith(() => setType(value))} />
              <Choice id="request-status" label="Status" value={status} options={STATUSES} onChange={(value) => filterWith(() => setStatus(value))} />
              <Choice id="request-period" label="Period" value={period} options={PERIODS} onChange={(value) => filterWith(() => setPeriod(value))} />
              {filtered && <button type="button" onClick={clearFilters}
                className="rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-[#23355d]">Clear</button>}
            </div>

            {rows.length === 0
              ? <p className="px-4 py-10 text-center text-xs text-slate-500">
                  No request matches these filters. <button type="button" onClick={clearFilters} className="font-semibold text-[#23355d] hover:underline">Clear the filters</button>
                </p>
              : <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50/70 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        <th className="w-12 px-4 py-2.5"><span className="sr-only">Type</span></th>
                        <th className="px-2 py-2.5">Request</th>
                        <th className="hidden px-3 py-2.5 sm:table-cell">Sent</th>
                        <th className="px-3 py-2.5">Status</th>
                        <th className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((request) => <Row key={request.id} request={request} onCancelled={replace} />)}
                    </tbody>
                  </table>
                </div>}

            {/* La pagination : "1–20 of 22", page précédente / suivante. */}
            {rows.length > 0 && <footer className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-500">
              <span className="tabular-nums">{(current - 1) * PAGE + 1}–{Math.min(current * PAGE, rows.length)} of {rows.length}</span>
              {pages > 1 && <span className="flex items-center gap-1">
                <button type="button" aria-label="Previous page" disabled={current === 1} onClick={() => setPage(current - 1)} className={pagerClass}><ChevronLeft className="size-4" /></button>
                <span className="tabular-nums">Page {current} / {pages}</span>
                <button type="button" aria-label="Next page" disabled={current === pages} onClick={() => setPage(current + 1)} className={pagerClass}><ChevronRight className="size-4" /></button>
              </span>}
            </footer>}
          </section>}
  </div>
}

const pagerClass = 'rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-[#23355d] disabled:opacity-40 disabled:hover:bg-transparent'

function Choice({ id, label, value, options, onChange }: {
  id: string; label: string; value: string; options: { id: string; label: string }[]; onChange: (value: string) => void
}) {
  return <>
    <label htmlFor={id} className="sr-only">{label}</label>
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}
      className={cn('h-9 rounded-lg border px-2.5 text-xs outline-none focus:border-[#23355d]',
        value === 'all' ? 'border-slate-200 bg-white text-slate-600' : 'border-[#23355d]/40 bg-[#E4E9F2]/60 font-semibold text-[#192646]')}>
      {options.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
    </select>
  </>
}

function Message({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-slate-200 bg-white px-4 py-12 text-center text-sm text-slate-500">{children}</div>
}

/** Une ligne : le type, le titre (+ qui doit répondre, si elle est en cours), la date, le statut, Cancel. */
function Row({ request, onCancelled }: { request: WorkflowRequest; onCancelled: (request: WorkflowRequest) => void }) {
  const status = STATUS[request.status] ?? STATUS.CANCELLED
  const Icon = TYPE_ICON[request.workflow_code] ?? FileText
  const pending = request.status === 'IN_PROGRESS' ? request.steps.find((step) => step.status === 'PENDING') : undefined
  const who = pending && (pending.validator === pending.approver_label ? pending.validator : `${pending.validator} (${pending.approver_label})`)
  const quiet = request.status === 'CANCELLED'
  return <tr className="border-t border-slate-100 transition-colors hover:bg-slate-50/70">
    <td className="px-4 py-2.5">
      <span className={cn('flex size-8 items-center justify-center rounded-lg bg-slate-100 text-[#23355d]', quiet && 'opacity-60')} aria-hidden><Icon className="size-4" /></span>
    </td>
    {/* w-full + max-w-0 : la colonne prend la place libre, et un long titre se coupe avec "…" (sans élargir le tableau). */}
    <td className="w-full max-w-0 px-2 py-2.5">
      <Link href={hrefOf(request)} className={cn('block truncate hover:underline', quiet ? 'text-slate-400' : 'font-medium text-[#192646]')}>{request.title}</Link>
      {/* En cours : à quelle étape, et qui doit répondre (+ son délégué s'il est absent). */}
      {pending && <p className="truncate text-[11px] text-amber-700">
        Waiting for {who}{pending.stand_in ? ` · stand-in: ${pending.stand_in}` : ''}
      </p>}
      <p className="text-[11px] text-slate-400 sm:hidden">Sent {formatDate(request.created_at.slice(0, 10))}</p>
    </td>
    <td className="hidden whitespace-nowrap px-3 py-2.5 text-xs tabular-nums text-slate-500 sm:table-cell">{formatDate(request.created_at.slice(0, 10))}</td>
    <td className="px-3 py-2.5">
      <span className={cn('inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', status.badge)}>{status.label}</span>
    </td>
    <td className="px-4 py-2.5 text-right">
      {request.status === 'IN_PROGRESS'
        ? <CancelButton request={request} onCancelled={onCancelled} />
        : <Link href={hrefOf(request)} aria-label={`Open ${request.title}`} className="inline-flex text-slate-300 hover:text-[#23355d]"><ChevronRight className="size-4" /></Link>}
    </td>
  </tr>
}

// Annuler en deux clics : "Cancel" puis "Yes, cancel" (pour ne pas annuler par erreur).
function CancelButton({ request, onCancelled }: { request: WorkflowRequest; onCancelled: (request: WorkflowRequest) => void }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function cancel() {
    setBusy(true)
    setError('')
    const result = await sendChange<WorkflowRequest>(
      () => apiFetch(`/api/workflows/requests/${request.id}/cancel/`, { method: 'POST' }),
      'Only the requester can cancel this request.')
    if ('data' in result) onCancelled(result.data)
    else setError(result.error)  // ex. "Cette demande est déjà terminée." (validée entre-temps)
    setBusy(false)
    setAsking(false)
  }

  if (error) return <p role="alert" className="max-w-48 text-right text-[11px] font-medium text-red-600">{error}</p>
  return asking
    ? <div className="flex shrink-0 items-center justify-end gap-1">
        <button type="button" onClick={() => setAsking(false)} className="rounded-md px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100">No</button>
        <button type="button" disabled={busy} onClick={cancel}
          className="flex items-center gap-1 whitespace-nowrap rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60">
          {busy && <Loader2 className="size-3 animate-spin" />} Yes, cancel
        </button>
      </div>
    : <button type="button" onClick={() => setAsking(true)}
        className="shrink-0 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600">Cancel</button>
}
