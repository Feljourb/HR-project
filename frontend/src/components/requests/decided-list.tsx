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

/** Qui a répondu, vu par moi. */
function whoAnswered(item: DecidedStep) {
  if (!item.by_me) return `by ${item.decided_by_name} on your behalf`
  return item.on_behalf_of ? `by you, on behalf of ${item.on_behalf_of}` : 'by you'
}

export function DecidedList({ items, from }: { items: DecidedStep[]; from: 'approvals' | 'stand-in' }) {
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, 5)
  return <div className="rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <ul className="divide-y divide-slate-100">
      {shown.map((item) => {
        const approved = item.status === 'APPROVED'
        return <li key={item.id}>
          <Link href={`/requests/${item.request.id}?from=${from}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
            <span className={cn('size-2 shrink-0 rounded-full', approved ? 'bg-emerald-500' : 'bg-rose-500')} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-[#192646]">{item.request.title}</p>
              <p className="truncate text-[11px] text-slate-500">
                {item.request.requester} · <span className={cn(!item.by_me && 'font-medium text-amber-700')}>{whoAnswered(item)}</span>
                {item.comment && <> · “{item.comment}”</>}
              </p>
            </div>
            <span className="hidden text-[11px] text-slate-400 sm:block">{new Date(item.decided_at).toLocaleDateString('fr-FR')}</span>
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
              approved ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-rose-50 text-rose-700 ring-rose-200')}>
              {approved ? 'Approved' : 'Refused'}
            </span>
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
