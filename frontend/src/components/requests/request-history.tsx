'use client'

/*
 * L'historique d'UNE demande (/requests/12), en ligne du temps :
 * "Envoyée par Sara" -> "Validée par Youssef : « Bon repos »" -> "RH informée" -> "Acceptée".
 * Lu dans /api/workflows/history/12/ : Django répond 404 si la demande ne me concerne pas.
 * La ligne du temps est construite avec la demande et ses étapes (qui, quoi, quand, commentaire).
 * Un congé : + ses recalculs (un jour férié a changé, /api/leaves/recounts/?request=12), à leur place dans le temps.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Ban, Check, CheckCheck, Circle, Clock, Info, Minus, RefreshCw, Send, X, XCircle, type LucideIcon } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { formatDays, type Recount } from '@/lib/leaves'
import { cn } from '@/lib/utils'
import { formatDateTime } from '@/components/employees/history-changes'
import { backLink } from '@/lib/back-links'
import type { RequestStep, WorkflowRequest } from '@/lib/requests'

// Une ligne de l'histoire.
type Event = {
  icon: LucideIcon
  tone: string          // la couleur de l'icône
  title: string
  detail?: string
  comment?: string
  warning?: string      // un point à vérifier par les RH (recalcul d'un congé)
  note?: string         // ce qui se passe maintenant (la dernière ligne d'une demande acceptée / refusée)
  noteTone?: 'neutral'  // gris pour un refus (vert par défaut : une demande acceptée)
  at?: string | null    // la date, si l'événement a eu lieu
  muted?: boolean       // pas encore arrivé (étapes suivantes)
}


/** La demande (+ les recalculs d'un congé) -> la liste des événements, dans l'ordre. */
function eventsOf(request: WorkflowRequest, recounts: Recount[]): Event[] {
  const events = stepEvents(request)
  for (const recount of recounts) {
    const event: Event = {
      icon: RefreshCw, tone: recount.warning ? 'text-amber-600' : 'text-sky-600',
      title: `Recounted: ${formatDays(recount.old_days)} → ${formatDays(recount.new_days)}`,
      detail: `${recount.reason}${recount.changed_by ? ` · by ${recount.changed_by}` : ''}`,
      warning: recount.warning || undefined, at: recount.created_at,
    }
    // À sa place dans le temps : avant le premier événement plus récent, ou pas encore arrivé ("Waiting for...").
    const index = events.findIndex((other) => other.muted || !other.at || other.at > recount.created_at)
    events.splice(index === -1 ? events.length : index, 0, event)
  }
  return events
}

// La dernière ligne d'une demande acceptée, selon son type : le titre, et ce qui se passe maintenant.
// Un ton professionnel, sobre (comme les grands logiciels RH) : un statut clair, puis l'étape suivante.
const DONE: Record<string, { title: string; next: string }> = {
  LEAVE: { title: 'Leave approved · Request closed', next: 'The leave is confirmed and your leave balance has been updated accordingly.' },
  EXPENSE: { title: 'Expense claim approved · Request closed', next: 'Next step: print the PDF and submit it to HR together with the original receipts.' },
}

// La dernière ligne d'une demande refusée, selon son type.
const REFUSED: Record<string, { title: string; next: string }> = {
  LEAVE: { title: 'Leave refused · Request closed', next: 'No days were taken from your balance. You can send a new request with other dates.' },
  EXPENSE: { title: 'Expense claim refused · Request closed', next: 'Nothing will be reimbursed for this claim. You can correct it and send a new claim.' },
}

// Les rôles des étapes en anglais (la page est en anglais ; Django envoie "RH du pôle", "DG du pôle").
const ROLE: Record<string, string> = { 'RH du pôle': 'HR', 'DG du pôle': 'General Manager' }
const roleOf = (step: RequestStep) => ROLE[step.approver_label] ?? step.approver_label
// "Manager Test (N+1)", ou "HR" quand l'étape n'a pas une personne précise (n'importe quel RH du pôle).
const whoOf = (step: RequestStep) => (step.validator === step.approver_label ? roleOf(step) : `${step.validator} (${roleOf(step)})`)
const MODE: Record<string, string> = { VALIDATE: 'approval', INFORM: 'for information' }

// Le type de demande en anglais, pour le petit titre ("LEAVE REQUEST · N° 12").
const TYPE: Record<string, string> = { LEAVE: 'Leave request', EXPENSE: 'Expense claim', ADMIN_REQUEST: 'Administrative request' }

// Le statut en anglais, avec les couleurs de "My requests".
const STATUS: Record<string, { label: string; badge: string }> = {
  IN_PROGRESS: { label: 'In progress', badge: 'bg-amber-50 text-amber-700 ring-amber-200' },
  APPROVED: { label: 'Approved', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  REJECTED: { label: 'Refused', badge: 'bg-red-50 text-red-700 ring-red-200' },
  CANCELLED: { label: 'Cancelled', badge: 'bg-slate-100 text-slate-500 ring-slate-200' },
}

/** La demande -> les événements de son circuit, dans l'ordre.
 *  Version "pro" (2026-11-11) : les NOMS des personnes (pas "manager.test"), chaque information UNE fois
 *  (qui a validé : sur sa ligne ; la dernière ligne dit seulement que c'est fini et ce qui se passe maintenant). */
function stepEvents(request: WorkflowRequest): Event[] {
  const events: Event[] = [{ icon: Send, tone: 'text-[#23355d]', title: `Submitted by ${request.requester}`, at: request.created_at }]
  const finished = request.status !== 'IN_PROGRESS'

  for (const step of request.steps) {
    const who = whoOf(step)
    const answeredBy = step.decided_by_name ?? step.validator
    // P2 step 1 : répondu à la place d'un valideur absent ("on behalf of Youssef Bennani").
    const behalf = step.on_behalf_of ? ` on behalf of ${step.on_behalf_of}` : ''
    const stepLabel = `Step ${step.order} · ${roleOf(step)}`
    switch (step.status) {
      case 'APPROVED':
        events.push({ icon: Check, tone: 'text-emerald-600', title: `Approved by ${answeredBy}${behalf}`, detail: stepLabel, comment: step.comment, at: step.decided_at })
        break
      case 'REJECTED':
        events.push({ icon: X, tone: 'text-red-600', title: `Refused by ${answeredBy}${behalf}`, detail: stepLabel, comment: step.comment, at: step.decided_at })
        break
      case 'INFORMED':
        events.push({ icon: Info, tone: 'text-sky-600', title: `${who} notified`, detail: `Step ${step.order} · for information`, at: step.decided_at })
        break
      case 'SKIPPED':
        events.push({ icon: Minus, tone: 'text-slate-400', title: `Step ${step.order} skipped`, detail: `No ${roleOf(step)} when the request was submitted.`, at: step.decided_at })
        break
      case 'PENDING':
        events.push({ icon: Clock, tone: 'text-amber-500', title: `Waiting for ${who}`, detail: `Step ${step.order} · ${MODE[step.mode] ?? step.mode_label}` })
        break
      default:  // WAITING : pas encore son tour, ou jamais atteinte (demande refusée / annulée)
        events.push({ icon: Circle, tone: 'text-slate-300', title: finished ? `Not reached: ${who}` : `Next: ${who}`, detail: `Step ${step.order} · ${MODE[step.mode] ?? step.mode_label}`, muted: true })
    }
  }

  // La fin, en clair : le statut final, et ce qui se passe maintenant (qui a validé / refusé est déjà au-dessus).
  if (request.status === 'APPROVED') events.push({ icon: CheckCheck, tone: 'text-emerald-600', title: DONE[request.workflow_code]?.title ?? 'Request approved · Request closed',
    note: DONE[request.workflow_code]?.next, at: request.closed_at })
  if (request.status === 'REJECTED') events.push({ icon: XCircle, tone: 'text-red-600', title: REFUSED[request.workflow_code]?.title ?? 'Request refused · Request closed',
    note: REFUSED[request.workflow_code]?.next ?? 'You can submit a new request if needed.', noteTone: 'neutral', at: request.closed_at })
  // Annulée : par le demandeur, ou par un RH (une demande déjà acceptée), avec le motif.
  if (request.status === 'CANCELLED') events.push({ icon: Ban, tone: 'text-slate-500', title: `Cancelled by ${request.cancelled_by_name ?? request.requester} · Request closed`,
    comment: request.cancel_reason || undefined, at: request.closed_at })
  return events
}

// Le retour par défaut (un lien de la cloche, une adresse tapée) : "My requests".
const DEFAULT_BACK = { href: '/requests', label: 'My requests' }

export function RequestHistory({ requestId, from = null }: { requestId: number; from?: string | null }) {
  const [request, setRequest] = useState<WorkflowRequest | null>(null)
  const [recounts, setRecounts] = useState<Recount[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    apiFetch(`/api/workflows/history/${requestId}/`)
      .then(async (response) => {
        if (response.ok) {
          const data: WorkflowRequest = await response.json()
          // Un congé : ses recalculs aussi (le module Congés les garde ; le moteur n'en sait rien).
          if (data.workflow_code === 'LEAVE') {
            const found = await apiFetch(`/api/leaves/recounts/?request=${requestId}`).catch(() => null)
            if (found?.ok) setRecounts(await found.json())
          }
          setRequest(data)
        }
        // 404 : la demande n'existe pas, ou elle ne me concerne pas (Django ne dit pas lequel).
        else setError(response.status === 404 ? 'This request does not exist or does not concern you.' : 'Could not load this request.')
      })
      .catch(() => setError('Cannot reach the server. Please try again later.'))
  }, [requestId])

  if (!request) {
    return <p className="rounded-xl border border-slate-200 bg-white px-4 py-12 text-center text-sm text-slate-500">{error || 'Loading...'}</p>
  }

  const back = backLink(from, DEFAULT_BACK)
  const status = STATUS[request.status] ?? STATUS.CANCELLED

  return <div className="flex flex-col gap-4">
    {/* Le retour, avec le NOM de la page d'où l'on vient (?from=...), comme une note de frais. */}
    <Link href={back.href} className="flex w-fit items-center gap-1 text-xs font-semibold text-[#23355d] hover:underline"><ArrowLeft className="size-3.5" /> {back.label}</Link>

    <div className="flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8C6D52]">{TYPE[request.workflow_code] ?? request.workflow} · N° {request.id}</p>
        <h1 className="text-lg font-semibold text-[#192646]">{request.title}</h1>
      </div>
      <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset', status.badge)}>{status.label}</span>
    </div>

    {/* La ligne du temps : une icône par événement, reliées par un trait vertical. */}
    <ol className="rounded-xl border border-slate-200/80 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      {eventsOf(request, recounts).map((event, index, events) => {
        const Icon = event.icon
        return <li key={index} className="relative flex gap-3 pb-5 last:pb-0">
          {index < events.length - 1 && <span aria-hidden className="absolute left-[11px] top-7 h-[calc(100%-1.75rem)] w-px bg-slate-200" />}
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-50 ring-1 ring-slate-200">
            <Icon className={cn('size-3.5', event.tone)} aria-hidden />
          </span>
          <div className={cn('min-w-0 pt-0.5 text-sm', event.muted && 'text-slate-400')}>
            <p className={cn('font-semibold', event.muted ? 'text-slate-400' : 'text-[#0F172A]')}>{event.title}</p>
            {(event.detail || event.at) && <p className="text-[11px] text-slate-500">
              {event.detail}{event.detail && event.at ? ' · ' : ''}{event.at ? formatDateTime(event.at) : ''}
            </p>}
            {event.comment && <p className="mt-1 rounded-md bg-slate-50 px-2 py-1 text-xs italic text-slate-600">“{event.comment}”</p>}
            {event.note && <p className={cn('mt-1 rounded-md px-2 py-1 text-xs',
              event.noteTone === 'neutral' ? 'bg-slate-50 text-slate-600 ring-1 ring-inset ring-slate-200' : 'bg-emerald-50 text-emerald-800')}>{event.note}</p>}
            {event.warning && <p className="mt-1 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">To check: {event.warning}</p>}
          </div>
        </li>
      })}
    </ol>
  </div>
}
