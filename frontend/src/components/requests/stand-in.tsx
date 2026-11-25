'use client'

/*
 * "Stand-in requests" (/stand-in, 2026-11-12, demandé par l'utilisateur) : la page d'un COLLABORATEUR choisi comme
 * délégué par un valideur absent (n'importe qui du pôle peut l'être). Il n'a pas le menu "Team approvals" (il ne
 * valide personne d'habitude) : ici, SEULEMENT ce qui le concerne, le temps de la délégation :
 * - en haut : qui il remplace et quand (Active / Planned) ;
 * - dessous : les demandes qui attendent sa réponse, avec Approve / Reject (les mêmes que Team approvals) ;
 * - en bas : "History", ce qu'il a déjà répondu en remplacement (standard : la trace de ce qu'on a décidé
 *   au nom de quelqu'un), chaque ligne ouvre l'historique de la demande.
 * La cloche, l'email et la case du tableau de bord d'un collaborateur mènent ici (notifications.link).
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { CalendarClock, CheckCheck, History, Plane, UserRoundCheck } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { formatDate } from '@/lib/leaves'
import type { Approval, DecidedStep, Delegation } from '@/lib/requests'
import { cn } from '@/lib/utils'
import { AfterAnswer } from './after-answer'
import { ApprovalItem } from './approval-item'
import { DecidedList } from './decided-list'
import { DelegationAnswer, DelegationBadge } from './delegation-answer'

export function StandIn() {
  const [delegations, setDelegations] = useState<Delegation[] | null>(null)
  const [approvals, setApprovals] = useState<Approval[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [done, setDone] = useState<ReactNode>(null)
  const [history, setHistory] = useState<DecidedStep[] | null>(null)

  // L'historique : relu au départ, puis après chaque réponse (la demande y passe).
  const loadHistory = useCallback(() => {
    apiFetch('/api/workflows/approvals/answered-for/')
      .then(async (response) => { if (response.ok) setHistory(await response.json()) })
      .catch(() => setHistory([]))
  }, [])
  useEffect(loadHistory, [loadHistory])

  // Relu au départ, et après ma réponse à une délégation (acceptée : ses demandes arrivent).
  const load = useCallback(() => {
    Promise.all([apiFetch('/api/workflows/delegations/'), apiFetch('/api/workflows/approvals/')])
      .then(async ([given, waiting]) => {
        if (!given.ok || !waiting.ok) throw new Error()
        // Reçues, pas finies, pas refusées par moi (2026-11-19 : une délégation se refuse).
        setDelegations((await given.json() as Delegation[]).filter((item) =>
          item.direction === 'RECEIVED' && item.state !== 'ENDED' && item.state !== 'DECLINED'))
        setApprovals(await waiting.json())
      })
      .catch(() => setFailed(true))
  }, [])
  useEffect(load, [load])

  function answered(approval: Approval, verb: string, label?: string) {
    setApprovals((list) => list && list.filter((item) => item.id !== approval.id))
    // (2026-11-25) ce qui se passe maintenant + un lien pour suivre (le même composant que Team approvals).
    setDone(<>{verb}: {label ?? approval.request.title}.<AfterAnswer approval={approval} verb={verb} from="stand-in" /></>)
    loadHistory()
  }

  const active = (delegations ?? []).filter((item) => item.state === 'ACTIVE')
  const planned = (delegations ?? []).filter((item) => item.state === 'PLANNED')

  // w-full (2026-11-20) : sans lui, "mx-auto" dans la colonne de la page prenait la largeur du plus long texte
  // (un commentaire de l'historique) : sur téléphone, la page devenait plus large que l'écran.
  return <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
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
            : <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {delegations.map((item) => <li key={item.id} className={cn('flex flex-col gap-3 rounded-xl border bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]',
                  item.state === 'WAITING' ? 'border-amber-200 sm:col-span-2' : 'border-slate-200/80')}>
                  <div className="flex items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#E4E9F2] text-[#23355d]" aria-hidden><Plane className="size-4" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        {item.state === 'WAITING' ? 'Asks you to answer for them' : 'You answer for'}
                      </p>
                      <p className="truncate text-sm font-semibold text-[#192646]">{item.delegator_label}</p>
                      <p className="flex items-center gap-1 text-xs text-slate-500"><CalendarClock className="size-3.5" aria-hidden />
                        {formatDate(item.start_date)} → {formatDate(item.end_date)}</p>
                    </div>
                    <DelegationBadge state={item.state} />
                  </div>
                  {/* 2026-11-19 : j'accepte (ses demandes arriveront ici) ou je refuse avec un motif. */}
                  {item.state === 'WAITING' && <>
                    <p className="text-xs text-slate-600">While {item.delegator_label} is away, you approve or reject their team&apos;s requests (leaves, expense claims, documents). Do you accept?</p>
                    <DelegationAnswer delegation={item} onAnswered={(message) => { setDone(message); load() }} />
                  </>}
                </li>)}
              </ul>}

          {done && <p role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
            <CheckCheck className="size-4" /> {done}
          </p>}

          {/* Les demandes qui attendent ma réponse. */}
          {approvals.length > 0
            // La même carte que Team approvals (approval-item.tsx : un seul composant pour les deux pages).
            ? approvals.map((approval) => <ApprovalItem key={approval.id} approval={approval}
                onAnswered={(verb, label) => answered(approval, verb, label)} />)
            : (active.length > 0 || planned.length > 0) && <Message>
                <CheckCheck className="mx-auto mb-2 size-6 text-emerald-600" />
                {active.length > 0 ? 'Nothing is waiting for you.'
                  : `Requests will appear here from ${formatDate(planned[0]?.start_date ?? '')}.`}
              </Message>}
        </>}

    {/* "History" : ce que j'ai déjà répondu en remplacement (la liste est partagée avec Team approvals). */}
    {history && history.length > 0 && <section className="flex flex-col gap-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-[#192646]">
        <History className="size-4 text-slate-400" aria-hidden /> History
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">{history.length}</span>
        <span className="ml-auto text-[11px] font-normal text-slate-400">What you answered as a stand-in</span>
      </h2>
      <DecidedList items={history} from="stand-in" />
    </section>}
  </div>
}

function Message({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">{children}</div>
}
