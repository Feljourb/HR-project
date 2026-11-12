'use client'

/*
 * La page "Team approvals" : les demandes qui attendent MA réponse (N+1, N+2, RH du pôle),
 * la plus ancienne d'abord. Pour chacune : un commentaire, puis Approve ou Reject.
 * Lu dans /api/workflows/approvals/ : Django ne renvoie que les étapes qui m'attendent.
 * Deux onglets (2026-11-12, standard) : "Waiting" (à répondre) et "History" (mes étapes déjà répondues, par moi
 * ou par mon délégué en mon nom : /api/workflows/approvals/history/).
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Check, CheckCheck, Loader2, Plane, X } from 'lucide-react'
import { apiFetch, type Me } from '@/lib/api'
import type { Approval, DecidedStep, WorkflowRequest } from '@/lib/requests'
import { cn } from '@/lib/utils'
import { sendChange } from '@/lib/workflows'
import { DecidedList } from './decided-list'
import { OutOfOffice } from './out-of-office'
import { RequestCard } from './request-card'
import { TeamCalendar } from './team-calendar'

export function TeamApprovals({ me }: { me: Me }) {
  const [approvals, setApprovals] = useState<Approval[] | null>(null)
  const [failed, setFailed] = useState(false)
  // La dernière réponse donnée, affichée en haut : "Approved: Congé du 10 au 14 novembre".
  const [done, setDone] = useState('')
  const [tab, setTab] = useState<'waiting' | 'history'>('waiting')
  const [history, setHistory] = useState<DecidedStep[] | null>(null)

  useEffect(() => {
    apiFetch('/api/workflows/approvals/')
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status))
        setApprovals(await response.json())
      })
      .catch(() => setFailed(true))
  }, [])

  // L'historique : relu au départ (pour son nombre), puis après chaque réponse (la demande y passe).
  const loadHistory = useCallback(() => {
    apiFetch('/api/workflows/approvals/history/')
      .then(async (response) => { if (response.ok) setHistory(await response.json()) })
      .catch(() => setHistory([]))
  }, [])
  useEffect(loadHistory, [loadHistory])

  // Après une réponse : l'étape n'attend plus personne, elle quitte la liste (et entre dans History).
  function answered(approval: Approval, verb: string) {
    setApprovals((list) => list && list.filter((item) => item.id !== approval.id))
    setDone(`${verb}: ${approval.request.title}`)
    loadHistory()
  }

  const tabs = [
    { id: 'waiting' as const, label: 'Waiting', count: approvals?.length },
    { id: 'history' as const, label: 'History', count: history?.length },
  ]

  return <div className="flex flex-col gap-4">
    <div>
      <h1 className="text-lg font-semibold text-[#192646]">Team approvals</h1>
      <p className="text-xs text-slate-500">The requests waiting for your answer, oldest first, and the ones already answered.</p>
    </div>

    {/* P2 step 1 : mon "absent du bureau" (qui valide à ma place), et ceux que je remplace.
        Seulement pour ceux qui valident (2026-11-12) : un collaborateur ne valide personne, il n'a rien à déléguer
        (s'il remplace quelqu'un, il a sa page "Stand-in requests"). Sauf un collaborateur responsable d'une équipe. */}
    {(me.role !== 'COLLABORATOR' || me.is_superuser || approvals?.some((approval) => !approval.on_behalf_of)) && <OutOfOffice me={me} />}

    {done && <p role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
      <CheckCheck className="size-4" /> {done}
    </p>}

    {/* Les deux onglets, en pastilles comme "My requests". */}
    <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
      {tabs.map(({ id, label, count }) => {
        const selected = tab === id
        return <button key={id} type="button" aria-pressed={selected} onClick={() => setTab(id)}
          className={cn('flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
            selected ? 'border-[#23355d] bg-[#23355d] text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-[#23355d]/40 hover:text-[#23355d]')}>
          {label}{count !== undefined && <span className={cn('tabular-nums', selected ? 'text-white/70' : 'text-slate-400')}>{count}</span>}
        </button>
      })}
    </div>

    {tab === 'history'
      ? history === null
        ? <Message>Loading...</Message>
        : history.length === 0
          ? <Message>You have not answered any request yet.</Message>
          : <DecidedList items={history} from="approvals" />
      : approvals === null
      ? <Message>{failed ? 'Could not load the requests. Please try again later.' : 'Loading...'}</Message>
      : approvals.length === 0
        ? <Message><CheckCheck className="mx-auto mb-2 size-6 text-emerald-600" />Nothing is waiting for you.</Message>
        : approvals.map((approval) => (
            <RequestCard key={approval.id} request={approval.request} showRequester>
              {/* Je réponds à la place d'un valideur absent (son délégué, son responsable, ou les RH). */}
              {approval.on_behalf_of && <p className="mb-2 flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-800">
                <Plane className="size-3.5" aria-hidden /> On behalf of {approval.on_behalf_of} (away)
              </p>}
              {/* P2 step 2 : un congé -> qui d'autre de l'équipe est absent ces jours-là, avant de décider. */}
              {approval.request.workflow_code === 'LEAVE' && <TeamCalendar requestId={approval.request.id} />}
              <Decision approval={approval} onAnswered={(verb) => answered(approval, verb)} />
            </RequestCard>
          ))}
  </div>
}

function Message({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-slate-200 bg-white px-4 py-12 text-center text-sm text-slate-500">{children}</div>
}

// Le commentaire et les deux boutons. Le commentaire est obligatoire pour refuser : Django le vérifie
// et renvoie "Un commentaire est obligatoire pour refuser.", affiché sous les boutons.
// (Aussi dans la page "Stand-in requests" d'un collaborateur qui remplace un valideur absent.)
export function Decision({ approval, onAnswered }: { approval: Approval; onAnswered: (verb: string) => void }) {
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  const [error, setError] = useState('')

  async function send(action: 'approve' | 'reject') {
    setBusy(action)
    setError('')
    const result = await sendChange<WorkflowRequest>(
      () => apiFetch(`/api/workflows/approvals/${approval.id}/${action}/`, { method: 'POST', body: JSON.stringify({ comment }) }),
      'You cannot answer this request.')
    if ('data' in result) onAnswered(action === 'approve' ? 'Approved' : 'Rejected')
    else setError(result.error)
    setBusy(null)
  }

  const id = `comment-${approval.id}`
  return <div className="flex flex-col gap-2">
    <label htmlFor={id} className="text-xs font-semibold text-slate-700">Comment <span className="font-normal text-slate-500">(required to reject)</span></label>
    <textarea id={id} rows={2} value={comment} maxLength={1000} onChange={(e) => { setComment(e.target.value); setError('') }}
      aria-invalid={error ? true : undefined}
      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-[#23355d] focus:bg-white focus:ring-3 focus:ring-[#23355d]/15 aria-invalid:border-red-300" />
    <div className="flex flex-wrap items-center justify-end gap-2">
      {error && <p role="alert" className="mr-auto text-[11px] font-medium text-red-600">{error}</p>}
      <button type="button" disabled={busy !== null} onClick={() => send('reject')}
        className="flex items-center gap-1.5 rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60">
        {busy === 'reject' ? <Loader2 className="size-3 animate-spin" /> : <X className="size-3.5" />} Reject
      </button>
      <button type="button" disabled={busy !== null} onClick={() => send('approve')}
        className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
        {busy === 'approve' ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3.5" />} Approve
      </button>
    </div>
  </div>
}
