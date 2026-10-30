'use client'

/*
 * L'historique d'UNE demande (/requests/12), en ligne du temps :
 * "Envoyée par Sara" -> "Validée par Youssef : « Bon repos »" -> "RH informée" -> "Acceptée".
 * Lu dans /api/workflows/history/12/ : Django répond 404 si la demande ne me concerne pas.
 * La ligne du temps est construite avec la demande et ses étapes (qui, quoi, quand, commentaire).
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Ban, Check, CheckCheck, Circle, Clock, Info, Minus, Send, X, XCircle, type LucideIcon } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import { formatDateTime } from '@/components/employees/history-changes'
import type { WorkflowRequest } from '@/lib/requests'

// Une ligne de l'histoire.
type Event = {
  icon: LucideIcon
  tone: string          // la couleur de l'icône
  title: string
  detail?: string
  comment?: string
  at?: string | null    // la date, si l'événement a eu lieu
  muted?: boolean       // pas encore arrivé (étapes suivantes)
}

const BADGE: Record<string, string> = {
  IN_PROGRESS: 'bg-amber-50 text-amber-700',
  APPROVED: 'bg-emerald-50 text-emerald-700',
  REJECTED: 'bg-red-50 text-red-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
}

/** La demande -> la liste des événements, dans l'ordre. */
function eventsOf(request: WorkflowRequest): Event[] {
  const events: Event[] = [{ icon: Send, tone: 'text-[#23355d]', title: `Sent by ${request.requester}`, at: request.created_at }]
  const finished = request.status !== 'IN_PROGRESS'

  for (const step of request.steps) {
    const who = step.validator === step.approver_label ? step.validator : `${step.validator} (${step.approver_label})`
    switch (step.status) {
      case 'APPROVED':
        events.push({ icon: Check, tone: 'text-emerald-600', title: `Approved by ${step.decided_by ?? who}`, detail: `Step ${step.order}: ${who}`, comment: step.comment, at: step.decided_at })
        break
      case 'REJECTED':
        events.push({ icon: X, tone: 'text-red-600', title: `Rejected by ${step.decided_by ?? who}`, detail: `Step ${step.order}: ${who}`, comment: step.comment, at: step.decided_at })
        break
      case 'INFORMED':
        events.push({ icon: Info, tone: 'text-sky-600', title: `${who} informed`, detail: `Step ${step.order}`, at: step.decided_at })
        break
      case 'SKIPPED':
        events.push({ icon: Minus, tone: 'text-slate-400', title: `Step ${step.order} skipped`, detail: `No ${step.approver_label} when the request was sent.`, at: step.decided_at })
        break
      case 'PENDING':
        events.push({ icon: Clock, tone: 'text-amber-500', title: `Waiting for ${who}`, detail: `Step ${step.order} · ${step.mode_label}` })
        break
      default:  // WAITING : pas encore son tour, ou jamais atteinte (demande refusée / annulée)
        events.push({ icon: Circle, tone: 'text-slate-300', title: finished ? `Not reached: ${who}` : `Then: ${who}`, detail: `Step ${step.order} · ${step.mode_label}`, muted: true })
    }
  }

  if (request.status === 'APPROVED') events.push({ icon: CheckCheck, tone: 'text-emerald-600', title: 'Request approved', at: request.closed_at })
  if (request.status === 'REJECTED') events.push({ icon: XCircle, tone: 'text-red-600', title: 'Request rejected', at: request.closed_at })
  if (request.status === 'CANCELLED') events.push({ icon: Ban, tone: 'text-slate-500', title: `Cancelled by ${request.requester}`, at: request.closed_at })
  return events
}

export function RequestHistory({ requestId }: { requestId: number }) {
  const [request, setRequest] = useState<WorkflowRequest | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    apiFetch(`/api/workflows/history/${requestId}/`)
      .then(async (response) => {
        if (response.ok) setRequest(await response.json())
        // 404 : la demande n'existe pas, ou elle ne me concerne pas (Django ne dit pas lequel).
        else setError(response.status === 404 ? 'This request does not exist or does not concern you.' : 'Could not load this request.')
      })
      .catch(() => setError('Cannot reach the server. Please try again later.'))
  }, [requestId])

  if (!request) {
    return <p className="rounded-xl border border-slate-200 bg-white px-4 py-12 text-center text-sm text-slate-500">{error || 'Loading...'}</p>
  }

  return <div className="flex flex-col gap-4">
    <div className="flex flex-wrap items-center gap-3">
      <Link href="/requests" aria-label="Back to my requests" className="rounded-lg p-2 text-slate-500 hover:bg-white hover:text-[#23355d]"><ArrowLeft className="size-4" /></Link>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8C6D52]">{request.workflow}</p>
        <h1 className="text-lg font-semibold text-[#192646]">{request.title}</h1>
      </div>
      <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', BADGE[request.status])}>{request.status_label}</span>
    </div>

    {/* La ligne du temps : une icône par événement, reliées par un trait vertical. */}
    <ol className="rounded-xl border border-slate-200/80 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      {eventsOf(request).map((event, index, events) => {
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
          </div>
        </li>
      })}
    </ol>
  </div>
}
