'use client'

/*
 * La page "My requests" : MES demandes (tous les rôles). Pensée pour l'œil (retour de l'utilisateur, 2026-11-09) :
 * - une colonne étroite (tout est proche : le titre et le statut ne sont pas aux deux bouts de l'écran) ;
 * - EN HAUT, ce qui attend encore une réponse ("Waiting for an answer") : où en est le circuit, et Cancel ;
 * - EN DESSOUS, l'historique, regroupé par mois, en lignes courtes : un point de couleur, le titre, la date, le statut ;
 * - des filtres en pastilles (All, In progress, Approved...) avec leur nombre.
 * Le détail complet (chaque étape, les commentaires) est à un clic : la page historique /requests/<id>.
 * Lu dans /api/workflows/requests/ : Django ne renvoie que les demandes de la personne connectée.
 */
import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { CalendarDays, ChevronRight, FileText, Inbox, Loader2, ReceiptText, type LucideIcon } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { formatDate } from '@/lib/leaves'
import type { WorkflowRequest } from '@/lib/requests'
import { cn } from '@/lib/utils'
import { sendChange } from '@/lib/workflows'

// L'icône de chaque type de demande (un repère pour l'œil, avant de lire).
const TYPE_ICON: Record<string, LucideIcon> = { LEAVE: CalendarDays, EXPENSE: ReceiptText, ADMIN_REQUEST: FileText }

// Le statut en anglais (la page est en anglais) : texte, pastille et point de couleur.
const STATUS: Record<string, { label: string; badge: string; dot: string }> = {
  IN_PROGRESS: { label: 'In progress', badge: 'bg-amber-50 text-amber-700 ring-amber-200', dot: 'bg-amber-400' },
  APPROVED: { label: 'Approved', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
  REJECTED: { label: 'Refused', badge: 'bg-red-50 text-red-700 ring-red-200', dot: 'bg-red-500' },
  CANCELLED: { label: 'Cancelled', badge: 'bg-slate-100 text-slate-500 ring-slate-200', dot: 'bg-slate-300' },
}

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'IN_PROGRESS', label: 'In progress' },
  { id: 'APPROVED', label: 'Approved' },
  { id: 'REJECTED', label: 'Refused' },
  { id: 'CANCELLED', label: 'Cancelled' },
]

/** Où ouvre une ligne : une note de frais ouvre la note (ses dépenses, ses justificatifs, son historique). */
const hrefOf = (request: WorkflowRequest) => (request.workflow_code === 'EXPENSE' ? `/expenses/${request.id}` : `/requests/${request.id}`)

export function MyRequests() {
  const [requests, setRequests] = useState<WorkflowRequest[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    apiFetch('/api/workflows/requests/')
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status))
        setRequests(await response.json())
      })
      .catch(() => setFailed(true))
  }, [])

  // Remplace une demande par sa nouvelle version (ex. après Cancel).
  function replace(updated: WorkflowRequest) {
    setRequests((list) => list && list.map((request) => (request.id === updated.id ? updated : request)))
  }

  // La plus récente d'abord.
  const all = [...(requests ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))
  const count = (id: string) => all.filter((request) => id === 'all' || request.status === id).length
  const waiting = all.filter((request) => request.status === 'IN_PROGRESS')
  // L'historique : ce qui est terminé (ou, avec un filtre, seulement ce statut).
  const history = filter === 'all' ? all.filter((request) => request.status !== 'IN_PROGRESS')
    : filter === 'IN_PROGRESS' ? [] : all.filter((request) => request.status === filter)

  return <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
    <div>
      <h1 className="text-lg font-semibold text-[#192646]">My requests</h1>
      <p className="text-xs text-slate-500">What is still waiting for an answer, then everything you sent before.</p>
    </div>

    {requests === null
      ? <Message>{failed ? 'Could not load your requests. Please try again later.' : 'Loading...'}</Message>
      : all.length === 0
        ? <Message><Inbox className="mx-auto mb-2 size-6 text-[#8C6D52]" />No request yet.</Message>
        : <>
            {/* Les filtres, en pastilles avec leur nombre. */}
            <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2">
              {FILTERS.map(({ id, label }) => {
                const selected = filter === id
                return <button key={id} type="button" aria-pressed={selected} onClick={() => setFilter(id)}
                  className={cn('flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
                    selected ? 'border-[#23355d] bg-[#23355d] text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-[#23355d]/40 hover:text-[#23355d]')}>
                  {label}<span className={cn('tabular-nums', selected ? 'text-white/70' : 'text-slate-400')}>{count(id)}</span>
                </button>
              })}
            </div>

            {/* 1. Ce qui attend encore une réponse : en premier, plus visible. */}
            {(filter === 'all' || filter === 'IN_PROGRESS') && <section aria-labelledby="waiting-title">
              <h2 id="waiting-title" className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">Waiting for an answer</h2>
              {waiting.length === 0
                ? <p className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-5 text-center text-xs text-slate-500">Nothing is waiting: all your requests have an answer.</p>
                : <div className="flex flex-col gap-2">{waiting.map((request) => <WaitingCard key={request.id} request={request} onCancelled={replace} />)}</div>}
            </section>}

            {/* 2. L'historique, regroupé par mois, chaque mois se plie / se déplie. */}
            {/* key : un autre filtre = un historique neuf (son mois le plus récent ouvert). */}
            {history.length > 0 && <History key={filter} requests={history} />}
          </>}
  </div>
}

function Message({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-slate-200 bg-white px-4 py-12 text-center text-sm text-slate-500">{children}</div>
}

/**
 * L'historique par mois, en groupes qu'on plie et déplie (le standard : Gmail, Outlook, Jira).
 * Au départ, seul le mois le plus récent est ouvert : la page reste courte. L'en-tête d'un mois dit déjà ce qu'il
 * contient (le nombre, et un résumé : ● 3 approved ● 1 refused) : pas besoin de l'ouvrir pour savoir.
 */
function History({ requests }: { requests: WorkflowRequest[] }) {
  const months = byMonth(requests)
  // Les mois ouverts (par leur nom). Au départ : le plus récent seulement.
  const [open, setOpen] = useState<Set<string>>(() => new Set(months.slice(0, 1).map(([month]) => month)))
  const allOpen = months.every(([month]) => open.has(month))

  function toggle(month: string) {
    setOpen((old) => {
      const next = new Set(old)
      if (next.has(month)) next.delete(month)
      else next.add(month)
      return next
    })
  }

  return <section aria-labelledby="history-title">
    <div className="mb-2 flex items-center justify-between">
      <h2 id="history-title" className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">History</h2>
      {months.length > 1 && <button type="button" onClick={() => setOpen(allOpen ? new Set() : new Set(months.map(([month]) => month)))}
        className="text-[11px] font-semibold text-[#23355d] hover:underline">
        {allOpen ? 'Collapse all' : 'Expand all'}
      </button>}
    </div>
    <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      {months.map(([month, items], index) => {
        const isOpen = open.has(month)
        const panelId = `month-${index}`
        return <div key={month} className={cn(index > 0 && 'border-t border-slate-100')}>
          {/* Tout l'en-tête est le bouton : grande zone de clic, et le clavier (Entrée, Espace) marche. */}
          <button type="button" onClick={() => toggle(month)} aria-expanded={isOpen} aria-controls={panelId}
            className="flex w-full items-center gap-2 bg-slate-50/70 px-4 py-2.5 text-left transition-colors hover:bg-slate-100/70">
            <ChevronRight className={cn('size-4 shrink-0 text-slate-400 transition-transform duration-200', isOpen && 'rotate-90')} aria-hidden />
            <span className="text-xs font-semibold text-[#192646]">{month}</span>
            <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-500 ring-1 ring-slate-200">{items.length}</span>
            <MonthSummary requests={items} />
          </button>
          {isOpen && <ul id={panelId} className="divide-y divide-slate-100 border-t border-slate-100">
            {items.map((request) => <HistoryRow key={request.id} request={request} />)}
          </ul>}
        </div>
      })}
    </div>
  </section>
}

// Le résumé d'un mois, à droite de son en-tête : "● 3 approved ● 1 refused ● 2 cancelled" (seulement ce qui existe).
function MonthSummary({ requests }: { requests: WorkflowRequest[] }) {
  const parts = ['APPROVED', 'REJECTED', 'CANCELLED']
    .map((code) => ({ code, total: requests.filter((request) => request.status === code).length }))
    .filter((part) => part.total > 0)
  return <span className="ml-auto hidden items-center gap-3 sm:flex">
    {parts.map(({ code, total }) => <span key={code} className="flex items-center gap-1 text-[11px] text-slate-500">
      <span className={cn('size-1.5 rounded-full', STATUS[code].dot)} aria-hidden />{total} {STATUS[code].label.toLowerCase()}
    </span>)}
  </span>
}

/** [["November 2026", [...]], ["October 2026", [...]]] : les demandes par mois d'envoi (déjà triées). */
function byMonth(requests: WorkflowRequest[]) {
  const groups = new Map<string, WorkflowRequest[]>()
  for (const request of requests) {
    const month = new Date(request.created_at).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    groups.set(month, [...(groups.get(month) ?? []), request])
  }
  return [...groups.entries()]
}

function TypeIcon({ code, className }: { code: string; className?: string }) {
  const Icon = TYPE_ICON[code] ?? FileText
  return <span className={cn('flex shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[#23355d]', className)} aria-hidden>
    <Icon className="size-4" />
  </span>
}

// Une demande qui attend : où en est le circuit ("Step 1 of 2 · Waiting for Manager TEST (N+1)"), et Cancel.
function WaitingCard({ request, onCancelled }: { request: WorkflowRequest; onCancelled: (request: WorkflowRequest) => void }) {
  const pending = request.steps.find((step) => step.status === 'PENDING')
  const index = pending ? request.steps.indexOf(pending) + 1 : 0
  const who = pending && (pending.validator === pending.approver_label ? pending.validator : `${pending.validator} (${pending.approver_label})`)
  return <article className="flex items-center gap-3 rounded-xl border border-amber-200/70 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <TypeIcon code={request.workflow_code} className="size-9" />
    <div className="min-w-0 flex-1">
      <Link href={hrefOf(request)} className="block truncate text-sm font-semibold text-[#192646] hover:underline">{request.title}</Link>
      <p className="text-xs text-slate-500">
        Sent {formatDate(request.created_at.slice(0, 10))}
        {pending && <> · Step {index} of {request.steps.length} · <span className="font-medium text-amber-700">waiting for {who}</span></>}
      </p>
      {/* La progression du circuit, une barre par étape (pleine = passée, ambre = en cours). */}
      <div className="mt-2 flex gap-1" aria-hidden>
        {request.steps.map((step) => <span key={step.order} className={cn('h-1 flex-1 rounded-full',
          step.status === 'PENDING' ? 'bg-amber-400' : step.status === 'WAITING' ? 'bg-slate-200' : 'bg-emerald-400')} />)}
      </div>
    </div>
    <CancelButton request={request} onCancelled={onCancelled} />
  </article>
}

// Une demande terminée, en une ligne courte : point de couleur, type, titre, date, statut.
function HistoryRow({ request }: { request: WorkflowRequest }) {
  const status = STATUS[request.status] ?? STATUS.CANCELLED
  const quiet = request.status === 'CANCELLED'
  return <li>
    <Link href={hrefOf(request)} className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-slate-50">
      <span className={cn('size-2 shrink-0 rounded-full', status.dot)} aria-hidden />
      <TypeIcon code={request.workflow_code} className={cn('size-7', quiet && 'opacity-60')} />
      <span className={cn('min-w-0 flex-1 truncate text-sm', quiet ? 'text-slate-400' : 'font-medium text-[#192646]')}>{request.title}</span>
      <span className="hidden shrink-0 text-xs tabular-nums text-slate-400 sm:block">{formatDate(request.created_at.slice(0, 10))}</span>
      <span className={cn('w-20 shrink-0 rounded-full px-2 py-0.5 text-center text-[11px] font-semibold ring-1 ring-inset', status.badge)}>{status.label}</span>
      <ChevronRight className="size-4 shrink-0 text-slate-300 group-hover:text-[#23355d]" aria-hidden />
    </Link>
  </li>
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
    ? <div className="flex shrink-0 items-center gap-1">
        <button type="button" onClick={() => setAsking(false)} className="rounded-md px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100">No</button>
        <button type="button" disabled={busy} onClick={cancel}
          className="flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60">
          {busy && <Loader2 className="size-3 animate-spin" />} Yes, cancel
        </button>
      </div>
    : <button type="button" onClick={() => setAsking(true)}
        className="shrink-0 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600">Cancel</button>
}
