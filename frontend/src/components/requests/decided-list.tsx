'use client'

/*
 * "History" (2026-11-12, standard Workday / SAP : un onglet "Completed" à côté de ce qui attend) : les demandes déjà
 * répondues, la plus récente d'abord, 5 lignes puis "Show all". Chaque ligne dit QUI a répondu ("by you",
 * "by Elj Fz on your behalf") et ouvre l'historique de la demande (le retour ramène à la page d'origine).
 * Utilisé par Team approvals (mes étapes) et Stand-in requests (ce que j'ai répondu à la place d'un absent).
 */
import { useState } from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import type { DecidedStep } from '@/lib/requests'
import { cn } from '@/lib/utils'

/** Qui a répondu, vu par moi : "Approved by you", "Refused by Elj Fz on your behalf"... */
function whoAnswered(item: DecidedStep) {
  const verb = item.status === 'APPROVED' ? 'Approved' : 'Refused'
  if (!item.by_me) return `${verb} by ${item.decided_by_name} on your behalf`
  return item.on_behalf_of ? `${verb} by you, on behalf of ${item.on_behalf_of}` : `${verb} by you`
}

/** Comment la demande a fini quand elle a été ANNULÉE : avant ma réponse, ou après (un congé accepté puis annulé). */
function cancelNote(item: DecidedStep) {
  const request = item.request
  if (request.status !== 'CANCELLED') return ''
  const who = request.cancelled_by_name ? `cancelled by ${request.cancelled_by_name}` : 'cancelled automatically (not answered in time)'
  return item.status === 'PENDING' ? `${who.charAt(0).toUpperCase()}${who.slice(1)} before an answer` : `then ${who}`
}

// La pastille : la FIN de la demande si elle a été annulée (ce qui compte maintenant), sinon ma réponse.
const BADGE = {
  APPROVED: { label: 'Approved', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
  REJECTED: { label: 'Refused', badge: 'bg-rose-50 text-rose-700 ring-rose-200', dot: 'bg-rose-500' },
  CANCELLED: { label: 'Cancelled', badge: 'bg-slate-100 text-slate-500 ring-slate-200', dot: 'bg-slate-300' },
}

// from : la page qui ouvre (le retour de l'historique y ramène) ; "received" = My requests, onglet Received.
export function DecidedList({ items, from }: { items: DecidedStep[]; from: 'approvals' | 'stand-in' | 'received' }) {
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, 5)
  return <div className="rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <ul className="divide-y divide-slate-100">
      {shown.map((item) => {
        const cancelled = item.request.status === 'CANCELLED'
        const badge = cancelled ? BADGE.CANCELLED : item.status === 'APPROVED' ? BADGE.APPROVED : BADGE.REJECTED
        const when = item.decided_at ?? item.request.closed_at
        return <li key={item.id}>
          <Link href={`/requests/${item.request.id}?from=${from}`} className={cn('flex items-center gap-3 px-4 py-3 hover:bg-slate-50', cancelled && 'opacity-75')}>
            <span className={cn('size-2 shrink-0 rounded-full', badge.dot)} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-[#192646]">{item.request.title}</p>
              <p className="truncate text-[11px] text-slate-500">
                {item.request.requester}
                {item.status !== 'PENDING' && <> · <span className={cn(!item.by_me && 'font-medium text-amber-700')}>{whoAnswered(item)}</span></>}
                {cancelled && <> · {cancelNote(item)}</>}
                {item.comment && <> · “{item.comment}”</>}
              </p>
            </div>
            {when && <span className="hidden text-[11px] text-slate-400 sm:block">{new Date(when).toLocaleDateString('fr-FR')}</span>}
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', badge.badge)}>{badge.label}</span>
            <ChevronRight className="size-4 text-slate-300" aria-hidden />
          </Link>
        </li>
      })}
    </ul>
    {items.length > 5 && <button onClick={() => setAll(!all)} className="w-full border-t border-slate-100 py-2.5 text-xs font-medium text-[#23355d] hover:bg-slate-50">
      {all ? 'Show less' : `Show all (${items.length})`}
    </button>}
  </div>
}
