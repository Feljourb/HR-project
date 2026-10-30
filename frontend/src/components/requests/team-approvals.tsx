'use client'

/*
 * La page "Team approvals" : les demandes qui attendent MA réponse (N+1, N+2, RH du pôle),
 * la plus ancienne d'abord. Pour chacune : un commentaire, puis Approve ou Reject.
 * Lu dans /api/workflows/approvals/ : Django ne renvoie que les étapes qui m'attendent.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Check, CheckCheck, Loader2, X } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import type { Approval, WorkflowRequest } from '@/lib/requests'
import { sendChange } from '@/lib/workflows'
import { RequestCard } from './request-card'

export function TeamApprovals() {
  const [approvals, setApprovals] = useState<Approval[] | null>(null)
  const [failed, setFailed] = useState(false)
  // La dernière réponse donnée, affichée en haut : "Approved: Congé du 10 au 14 novembre".
  const [done, setDone] = useState('')

  useEffect(() => {
    apiFetch('/api/workflows/approvals/')
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status))
        setApprovals(await response.json())
      })
      .catch(() => setFailed(true))
  }, [])

  // Après une réponse : l'étape n'attend plus personne, elle quitte la liste.
  function answered(approval: Approval, verb: string) {
    setApprovals((list) => list && list.filter((item) => item.id !== approval.id))
    setDone(`${verb}: ${approval.request.title}`)
  }

  return <div className="flex flex-col gap-4">
    <div>
      <h1 className="text-lg font-semibold text-[#192646]">Team approvals</h1>
      <p className="text-xs text-slate-500">The requests waiting for your answer, oldest first.</p>
    </div>

    {done && <p role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
      <CheckCheck className="size-4" /> {done}
    </p>}

    {approvals === null
      ? <Message>{failed ? 'Could not load the requests. Please try again later.' : 'Loading...'}</Message>
      : approvals.length === 0
        ? <Message><CheckCheck className="mx-auto mb-2 size-6 text-emerald-600" />Nothing is waiting for you.</Message>
        : approvals.map((approval) => (
            <RequestCard key={approval.id} request={approval.request} showRequester>
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
function Decision({ approval, onAnswered }: { approval: Approval; onAnswered: (verb: string) => void }) {
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
