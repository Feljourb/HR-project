'use client'

/*
 * La page "My requests" : MES demandes (tous les rôles), la plus récente d'abord,
 * avec leur circuit. Une demande en cours peut être annulée (Cancel).
 * Lu dans /api/workflows/requests/ : Django ne renvoie que les demandes de la personne connectée.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Inbox, Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import type { WorkflowRequest } from '@/lib/requests'
import { sendChange } from '@/lib/workflows'
import { RequestCard } from './request-card'

export function MyRequests() {
  const [requests, setRequests] = useState<WorkflowRequest[] | null>(null)
  const [failed, setFailed] = useState(false)

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

  return <div className="flex flex-col gap-4">
    <div>
      <h1 className="text-lg font-semibold text-[#192646]">My requests</h1>
      <p className="text-xs text-slate-500">Your requests and where they are in their circuit.</p>
    </div>

    {requests === null
      ? <Message>{failed ? 'Could not load your requests. Please try again later.' : 'Loading...'}</Message>
      : requests.length === 0
        ? <Message><Inbox className="mx-auto mb-2 size-6 text-[#8C6D52]" />No request yet.</Message>
        : requests.map((request) => (
            <RequestCard key={request.id} request={request}>
              {request.status === 'IN_PROGRESS' && <CancelButton request={request} onCancelled={replace} />}
            </RequestCard>
          ))}
  </div>
}

function Message({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-slate-200 bg-white px-4 py-12 text-center text-sm text-slate-500">{children}</div>
}

// Annuler en deux clics : "Cancel the request" puis "Yes, cancel" (pour ne pas annuler par erreur).
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

  return <div className="flex flex-wrap items-center justify-end gap-2">
    {error && <p role="alert" className="mr-auto text-[11px] font-medium text-red-600">{error}</p>}
    {asking
      ? <>
          <span className="text-xs text-slate-600">Cancel this request?</span>
          <button type="button" onClick={() => setAsking(false)} className="rounded-md px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100">No</button>
          <button type="button" disabled={busy} onClick={cancel}
            className="flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60">
            {busy && <Loader2 className="size-3 animate-spin" />} Yes, cancel
          </button>
        </>
      : <button type="button" onClick={() => setAsking(true)}
          className="rounded-md px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50">Cancel the request</button>}
  </div>
}
