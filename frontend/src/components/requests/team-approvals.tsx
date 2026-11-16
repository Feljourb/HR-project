'use client'

/*
 * La page "Team approvals" : les demandes qui attendent MA réponse (N+1, N+2, RH du pôle),
 * la plus ancienne d'abord. Pour chacune : un commentaire, puis Approve ou Reject.
 * Lu dans /api/workflows/approvals/ : Django ne renvoie que les étapes qui m'attendent.
 * Deux onglets (2026-11-12, standard) : "Waiting" (à répondre) et "History" (mes étapes déjà répondues, par moi
 * ou par mon délégué en mon nom : /api/workflows/approvals/history/). + "For my team" (2026-11-16) : les demandes
 * que j'ai SAISIES pour quelqu'un de mon équipe (/api/workflows/requests/initiated/), seulement s'il y en a.
 * Un document à préparer par les RH, juste validé : la carte reste À SA PLACE et devient "Approved · Next step"
 * (2026-11-16, retour de l'utilisatrice : un cadre en haut de la page passait inaperçu).
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Check, CheckCheck, ChevronRight, FileText, Loader2, Plane, X } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { apiFetch, type Me } from '@/lib/api'
import { stateOf, type DocumentRequest } from '@/lib/documents'
import { CancelClaim } from '@/components/expenses/claim-actions'
import { formatDate } from '@/lib/leaves'
import type { Approval, DecidedStep, WorkflowRequest } from '@/lib/requests'
import { PrintButton } from '@/components/documents/download-button'
import { UploadButton } from '@/components/documents/upload-button'
import { OriginalButtons } from '@/components/documents/original-buttons'
import { TextEditorButton } from '@/components/documents/text-editor'
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
  // ?tab=team : arrivé par le lien "Requested for my team" de la page Documents.
  const [tab, setTab] = useState<'waiting' | 'history' | 'team'>(useSearchParams().get('tab') === 'team' ? 'team' : 'waiting')
  const [history, setHistory] = useState<DecidedStep[] | null>(null)
  // Saisies par moi pour mon équipe (+ leur document, s'il y en a un : "Ready for pickup"...).
  const [initiated, setInitiated] = useState<WorkflowRequest[]>([])
  const [teamDocuments, setTeamDocuments] = useState<Record<number, DocumentRequest>>({})
  // Un document validé qui demande encore le travail des RH : sa carte reste, en "Next step" (clé = l'étape validée).
  const [nextSteps, setNextSteps] = useState<Record<number, DocumentRequest>>({})

  const loadInitiated = useCallback(() => {
    Promise.all([apiFetch('/api/workflows/requests/initiated/'), apiFetch('/api/documents/mine/for-team/')])
      .then(async ([requests, documents]) => {
        if (requests.ok) setInitiated(await requests.json())
        if (documents.ok) {
          const rows: DocumentRequest[] = await documents.json()
          setTeamDocuments(Object.fromEntries(rows.map((document) => [document.request, document])))
        }
      })
      .catch(() => { /* l'onglet ne s'affiche pas, le reste de la page marche */ })
  }, [])
  useEffect(loadInitiated, [loadInitiated])

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

  // La carte quitte la liste (la demande est dans History).
  const remove = (approval: Approval) => setApprovals((list) => list && list.filter((item) => item.id !== approval.id))

  // Après une réponse : l'étape n'attend plus personne. Un document à préparer par les RH : la carte RESTE et devient
  // "Approved · Next step" (Print draft, Upload PDF, Original ready). Sinon elle quitte la liste.
  function answered(approval: Approval, verb: string) {
    setDone(`${verb}: ${approval.request.title}`)
    loadHistory()
    if (verb !== 'Approved' || approval.request.workflow_code !== 'ADMIN_REQUEST') return remove(approval)
    apiFetch(`/api/documents/requests/${approval.request.id}/`)
      .then(async (response) => {
        const document: DocumentRequest | null = response.ok ? await response.json() : null
        if (document?.state === 'TO_PREPARE' && (document.can_upload || document.can_handle_original || document.can_edit_text)) {
          setNextSteps((old) => ({ ...old, [approval.id]: document }))
          setDone('')  // la carte elle-même dit "Approved"
        } else remove(approval)
      })
      .catch(() => remove(approval))  // pas de document (demande de démo) : rien de plus à faire
  }

  // La prochaine étape est faite (ou remise à plus tard) : la carte s'en va.
  function finished(approval: Approval, message: string) {
    remove(approval)
    setNextSteps((old) => Object.fromEntries(Object.entries(old).filter(([id]) => Number(id) !== approval.id)))
    setDone(message)
  }

  const waiting = approvals?.filter((approval) => !nextSteps[approval.id])
  const tabs = [
    { id: 'waiting' as const, label: 'Waiting', count: waiting?.length },
    { id: 'history' as const, label: 'History', count: history?.length },
    // Seulement pour qui a saisi des demandes pour son équipe (un manager).
    ...(initiated.length > 0 ? [{ id: 'team' as const, label: 'For my team', count: initiated.length }] : []),
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

    {/* Les onglets, en pastilles comme "My requests". */}
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

    {tab === 'team'
      ? initiated.length === 0
        ? <Message>You have not requested anything for your team.</Message>
        : <InitiatedList requests={initiated} documents={teamDocuments} onCancelled={(request) => {
            setDone(`Cancelled: ${request.title}`)
            loadInitiated()
          }} />
      : tab === 'history'
      ? history === null
        ? <Message>Loading...</Message>
        : history.length === 0
          ? <Message>You have not answered any request yet.</Message>
          : <DecidedList items={history} from="approvals" />
      : approvals === null
      ? <Message>{failed ? 'Could not load the requests. Please try again later.' : 'Loading...'}</Message>
      : approvals.length === 0
        ? <Message><CheckCheck className="mx-auto mb-2 size-6 text-emerald-600" />Nothing is waiting for you.</Message>
        : approvals.map((approval) => nextSteps[approval.id]
          // Validé : la même place, devenue "Approved · Next step".
          ? <NextStepCard key={approval.id} approval={approval} document={nextSteps[approval.id]}
              onFinished={(message) => finished(approval, message)} />
          : (
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

/** La carte d'un document qu'on vient de valider, À SA PLACE : "Approved", et ce qu'il reste à faire, avec ses boutons.
 *  "Later" la retire (on la retrouve dans Document requests -> To prepare). */
function NextStepCard({ approval, document, onFinished }: {
  approval: Approval; document: DocumentRequest; onFinished: (message: string) => void
}) {
  const who = `${document.doc_type} for ${document.employee}`
  const todo = [
    document.needs_review && 'review the text, then send it ("Review & send")',
    document.can_upload && !document.has_file && (document.can_print ? 'print the draft, sign and stamp it, then upload the scan' : 'upload the signed PDF'),
    document.original_state === 'TO_SIGN' && 'print, sign and stamp the original, then click "Original ready"',
  ].filter(Boolean).join('; ')
  return <article className="rounded-xl border border-emerald-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <header className="flex items-start gap-3 border-b border-emerald-100 bg-emerald-50/60 px-4 py-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white" aria-hidden><Check className="size-4" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Approved</p>
        <p className="truncate text-sm font-semibold text-[#192646]">{approval.request.title}</p>
        <p className="text-[11px] text-slate-500">{approval.request.requester}{document.due_date ? ` · expected by ${formatDate(document.due_date)}` : ''}</p>
      </div>
    </header>
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <FileText className="size-4 shrink-0 text-sky-700" aria-hidden />
      <p className="min-w-0 flex-1 text-xs text-slate-700"><span className="font-semibold text-[#192646]">Next step:</span> {todo}.</p>
      <div className="flex flex-wrap items-center gap-1">
        {/* Relu et envoyé : la carte s'en va ; relu (à la main) : le brouillon est refait, la carte reste. */}
        <TextEditorButton document={document} onSaved={(updated) => updated.state === 'READY'
          ? onFinished(`Sent to the employee: ${who}.`) : onFinished(`Text saved: ${who}. Print the new draft in Document requests.`)} />
        <PrintButton document={document} />
        {document.can_upload && !document.has_file && <UploadButton document={document}
          onUploaded={() => onFinished(`Sent to the employee: ${who}.`)} />}
        <OriginalButtons document={document} onDone={() => onFinished(`Original ready at the HR office: ${who}. The employee is notified.`)} />
        <Link href="/document-requests" onClick={() => onFinished(`Approved: ${approval.request.title}. It waits in Document requests → To prepare.`)}
          className="rounded-md px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100">Later</Link>
      </div>
    </div>
  </article>
}

// Le statut en anglais (la page est en anglais), avec les couleurs de "My requests".
const STATUS: Record<string, { label: string; badge: string }> = {
  IN_PROGRESS: { label: 'In progress', badge: 'bg-amber-50 text-amber-700 ring-amber-200' },
  APPROVED: { label: 'Approved', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  REJECTED: { label: 'Refused', badge: 'bg-red-50 text-red-700 ring-red-200' },
  CANCELLED: { label: 'Cancelled', badge: 'bg-slate-100 text-slate-500 ring-slate-200' },
}

/** "For my team" : les demandes que j'ai saisies pour mon équipe. Une ligne ouvre son historique ; un document dit où
 *  il en est ("Ready for pickup" en premier et en violet : le manager prévient la personne) ; "Cancel" tant qu'elle
 *  attend encore la validation (une erreur de saisie). Jamais le document lui-même (il va au collaborateur). */
function InitiatedList({ requests, documents, onCancelled }: {
  requests: WorkflowRequest[]; documents: Record<number, DocumentRequest>; onCancelled: (request: WorkflowRequest) => void
}) {
  const pickupFirst = [...requests].sort((a, b) => Number(documents[b.id]?.state === 'PICKUP') - Number(documents[a.id]?.state === 'PICKUP'))
  return <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    {pickupFirst.map((request) => {
      const document = documents[request.id]
      const badge = document ? stateOf(document) : STATUS[request.status] ?? STATUS.CANCELLED
      const pickup = document?.state === 'PICKUP'
      const initials = request.requester.split(' ').map((part) => part.charAt(0)).join('').slice(0, 2)
      const extras = [
        'Requested by you',
        new Date(request.created_at).toLocaleDateString('fr-FR'),
        document && document.state === 'TO_PREPARE' && document.due_date && `expected by ${formatDate(document.due_date)}`,
      ].filter(Boolean)
      return <li key={request.id} className={cn('flex items-center gap-2 pr-3', pickup && 'bg-violet-50/60')}>
        <Link href={`/requests/${request.id}?from=approvals`} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 hover:bg-slate-50/60">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#E4E9F2] text-[11px] font-bold text-[#23355d]" aria-hidden>{initials}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-[#192646]">{request.requester} <span className="font-normal text-slate-500">· {request.title}</span>
              <span className="ml-1.5 text-[11px] font-normal text-slate-400">N° {request.id}</span></span>
            <span className="block truncate text-[11px] text-slate-400">{extras.join(' · ')}</span>
            {pickup && <span className="mt-0.5 block text-[11px] font-medium text-violet-700">Ready at the HR office: tell {request.requester.split(' ')[0]} to pick it up.</span>}
          </span>
          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', badge.badge)}>{badge.label}</span>
          <ChevronRight className="size-4 shrink-0 text-slate-300" aria-hidden />
        </Link>
        {/* "Cancel" (2 clics) tant qu'elle attend la validation : une erreur de saisie. */}
        <CancelClaim claim={{ request: request.id, status: request.status }} onCancelled={() => onCancelled(request)} needReason />
      </li>
    })}
  </ul>
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
