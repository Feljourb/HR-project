'use client'

/*
 * "Stand-in requests" (/stand-in, 2026-11-12, demandé par l'utilisateur) : la page d'un COLLABORATEUR choisi comme
 * délégué par un valideur absent (n'importe qui du pôle peut l'être). Il n'a pas le menu "Team approvals" (il ne
 * valide personne d'habitude) : ici, SEULEMENT ce qui le concerne, le temps de la délégation :
 * - en haut : qui il remplace et quand (Active / Planned) ;
 * - dessous : les demandes qui attendent sa réponse, avec Approve / Reject (les mêmes que Team approvals).
 * La cloche, l'email et la case du tableau de bord d'un collaborateur mènent ici (notifications.link).
 */
import { useEffect, useState, type ReactNode } from 'react'
import { CalendarClock, CheckCheck, Plane, UserRoundCheck } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { formatDate } from '@/lib/leaves'
import type { Approval, Delegation } from '@/lib/requests'
import { cn } from '@/lib/utils'
import { RequestCard } from './request-card'
import { Decision } from './team-approvals'
import { TeamCalendar } from './team-calendar'

export function StandIn() {
  const [delegations, setDelegations] = useState<Delegation[] | null>(null)
  const [approvals, setApprovals] = useState<Approval[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [done, setDone] = useState('')

  useEffect(() => {
    Promise.all([apiFetch('/api/workflows/delegations/'), apiFetch('/api/workflows/approvals/')])
      .then(async ([given, waiting]) => {
        if (!given.ok || !waiting.ok) throw new Error()
        setDelegations((await given.json() as Delegation[]).filter((item) => item.direction === 'RECEIVED' && item.state !== 'ENDED'))
        setApprovals(await waiting.json())
      })
      .catch(() => setFailed(true))
  }, [])

  function answered(approval: Approval, verb: string) {
    setApprovals((list) => list && list.filter((item) => item.id !== approval.id))
    setDone(`${verb}: ${approval.request.title}`)
  }

  const active = (delegations ?? []).filter((item) => item.state === 'ACTIVE')
  const planned = (delegations ?? []).filter((item) => item.state === 'PLANNED')

  return <div className="mx-auto flex max-w-4xl flex-col gap-4">
    <div>
      <h1 className="text-lg font-semibold text-[#192646]">Stand-in requests</h1>
      <p className="text-xs text-slate-500">A colleague who is away chose you to answer their team&apos;s requests. Only these requests are shown here.</p>
    </div>

    {delegations === null || approvals === null
      ? <Message>{failed ? 'Could not load your stand-in requests. Please try again later.' : 'Loading...'}</Message>
      : <>
          {/* Qui je remplace, et quand. */}
          {delegations.length === 0
            ? <Message><UserRoundCheck className="mx-auto mb-2 size-6 text-slate-300" />You are not standing in for anyone right now.</Message>
            : <ul className="grid gap-3 sm:grid-cols-2">
                {delegations.map((item) => <li key={item.id} className="flex items-start gap-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#E4E9F2] text-[#23355d]" aria-hidden><Plane className="size-4" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">You answer for</p>
                    <p className="truncate text-sm font-semibold text-[#192646]">{item.delegator_label}</p>
                    <p className="flex items-center gap-1 text-xs text-slate-500"><CalendarClock className="size-3.5" aria-hidden />
                      {formatDate(item.start_date)} → {formatDate(item.end_date)}</p>
                  </div>
                  <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
                    item.state === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-sky-50 text-sky-700 ring-sky-200')}>
                    {item.state === 'ACTIVE' ? 'Active' : 'Planned'}
                  </span>
                </li>)}
              </ul>}

          {done && <p role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
            <CheckCheck className="size-4" /> {done}
          </p>}

          {/* Les demandes qui attendent ma réponse. */}
          {approvals.length > 0
            ? approvals.map((approval) => <RequestCard key={approval.id} request={approval.request} showRequester>
                {approval.on_behalf_of && <p className="mb-2 flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-800">
                  <Plane className="size-3.5" aria-hidden /> On behalf of {approval.on_behalf_of} (away)
                </p>}
                {approval.request.workflow_code === 'LEAVE' && <TeamCalendar requestId={approval.request.id} />}
                <Decision approval={approval} onAnswered={(verb) => answered(approval, verb)} />
              </RequestCard>)
            : delegations.length > 0 && <Message>
                <CheckCheck className="mx-auto mb-2 size-6 text-emerald-600" />
                {active.length > 0 ? 'Nothing is waiting for you.'
                  : `Requests will appear here from ${formatDate(planned[0]?.start_date ?? '')}.`}
              </Message>}
        </>}
  </div>
}

function Message({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">{children}</div>
}
