'use client'

/*
 * Une demande et son circuit, étape par étape : qui doit répondre, ce qui s'est passé, et les commentaires.
 * Utilisée par "My requests" (avec le bouton Cancel) et "Team approvals" (avec Approve / Reject) :
 * les boutons arrivent par `children`.
 */
import type { ReactNode } from 'react'
import Link from 'next/link'
import { Check, Circle, Clock, Info, Minus, X, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDateTime } from '@/components/employees/history-changes'
import type { RequestStep, WorkflowRequest } from '@/lib/requests'

// La couleur du badge de la demande.
const REQUEST_BADGE: Record<string, string> = {
  IN_PROGRESS: 'bg-amber-50 text-amber-700',
  APPROVED: 'bg-emerald-50 text-emerald-700',
  REJECTED: 'bg-red-50 text-red-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
}

// L'icône et la couleur de chaque état d'étape.
const STEP_LOOK: Record<string, { icon: LucideIcon; className: string }> = {
  WAITING: { icon: Circle, className: 'text-slate-300' },
  PENDING: { icon: Clock, className: 'text-amber-500' },
  APPROVED: { icon: Check, className: 'text-emerald-600' },
  REJECTED: { icon: X, className: 'text-red-600' },
  INFORMED: { icon: Info, className: 'text-sky-600' },
  SKIPPED: { icon: Minus, className: 'text-slate-400' },
}

/** La phrase sous le titre : "Waiting for Youssef Bennani (N+1)", ou la fin de la demande. */
function whereIsIt(request: WorkflowRequest) {
  const pending = request.steps.find((step) => step.status === 'PENDING')
  if (request.status === 'IN_PROGRESS' && pending) {
    return pending.validator === pending.approver_label
      ? `Waiting for ${pending.validator}`
      : `Waiting for ${pending.validator} (${pending.approver_label})`
  }
  return request.closed_at ? `${request.status_label} on ${formatDateTime(request.closed_at)}` : request.status_label
}

export function RequestCard({ request, showRequester, children }: { request: WorkflowRequest; showRequester?: boolean; children?: ReactNode }) {
  return <article className="rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <header className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b border-slate-100 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8C6D52]">{request.workflow}</p>
        {/* Le titre ouvre l'historique complet de la demande. */}
        <h3 className="text-sm font-semibold text-[#192646]">
          <Link href={`/requests/${request.id}`} className="hover:underline">{request.title}</Link>
        </h3>
        <p className="text-[11px] text-slate-500">
          {showRequester && <>{request.requester} · </>}Sent on {formatDateTime(request.created_at)} · {whereIsIt(request)}
        </p>
      </div>
      <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', REQUEST_BADGE[request.status])}>{request.status_label}</span>
    </header>

    {/* Le circuit : une ligne par étape, dans l'ordre. */}
    <ol className="px-4 py-2">
      {request.steps.map((step) => <StepLine key={step.order} step={step} />)}
    </ol>

    {children && <footer className="border-t border-slate-100 px-4 py-3">{children}</footer>}
  </article>
}

function StepLine({ step }: { step: RequestStep }) {
  const look = STEP_LOOK[step.status] ?? STEP_LOOK.WAITING
  const Icon = look.icon
  return <li className="flex gap-2.5 py-1.5">
    <Icon className={cn('mt-0.5 size-4 shrink-0', look.className)} aria-hidden />
    <div className="min-w-0 text-xs">
      <p className={cn('text-slate-700', step.status === 'SKIPPED' && 'text-slate-400 line-through')}>
        <span className="font-semibold">{step.order}. {step.validator}</span>
        {step.validator !== step.approver_label && <span className="text-slate-500"> ({step.approver_label})</span>}
        <span className="text-slate-500"> · {step.mode_label} · {step.status_label}</span>
      </p>
      {step.decided_at && step.status !== 'SKIPPED' && (
        <p className="text-[11px] text-slate-500">
          {step.decided_by ? `${step.decided_by}, ` : ''}{formatDateTime(step.decided_at)}
        </p>
      )}
      {step.comment && <p className="mt-0.5 rounded-md bg-slate-50 px-2 py-1 text-[11px] italic text-slate-600">“{step.comment}”</p>}
    </div>
  </li>
}
