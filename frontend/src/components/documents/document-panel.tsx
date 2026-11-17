'use client'

/*
 * Le détail d'une demande de document, dans un panneau à droite (step A du 2026-11-13, standard Gmail / Jira / Workday :
 * un clic sur une ligne -> tout son détail, sans quitter la page). Pour le collaborateur (My documents) et les RH
 * (Document requests) :
 * - le résumé de la demande (pour quoi, format, qui l'a faite) ;
 * - CHAQUE document de la demande (2026-11-17 : un ou plusieurs) : son état, son délai, sa référence, le PDF et l'original ;
 * - la ligne du temps complète (la même que la page historique) avec ses boutons (Download, Upload, Original ready...).
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { CheckCheck, Eye, FileText, Stamp } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { FORMATS, fileUrl, stateOf, type DocumentRequest } from '@/lib/documents'
import { getFile } from '@/lib/expenses'
import { formatDate } from '@/lib/leaves'
import type { WorkflowRequest } from '@/lib/requests'
import { cn } from '@/lib/utils'
import { SidePanel } from '@/components/ui/side-panel'
import { RequestTimeline } from '@/components/requests/request-history'
import { DownloadButton } from './download-button'

type Loaded = { request: WorkflowRequest; documents: DocumentRequest[] }

export function DocumentPanel({ requestId, onClose, onChanged, showEmployee = false }: {
  requestId: number | null   // la demande ouverte (null : panneau fermé)
  onClose: () => void
  onChanged: () => void      // un clic a changé quelque chose (ex. "Original ready") : la liste derrière se relit
  showEmployee?: boolean     // les RH, ou le manager (demande pour son équipe) : le nom du collaborateur en plus
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState(false)
  // Un clic dans le panneau a réussi (Upload, Original ready, Handed over) : on le dit ICI (2026-11-16 : le message
  // en haut de la page était caché derrière le panneau). Gardé pour CETTE demande seulement.
  const [noticeFor, setNoticeFor] = useState<number | null>(null)

  const load = useCallback(() => {
    if (requestId === null) return
    Promise.all([apiFetch(`/api/workflows/history/${requestId}/`), apiFetch(`/api/documents/requests/${requestId}/`)])
      .then(async ([request, documents]) => {
        if (!request.ok || !documents.ok) throw new Error()
        setLoaded({ request: await request.json(), documents: await documents.json() })
      })
      .catch(() => setFailed(true))
  }, [requestId])
  useEffect(load, [load])

  function changed() {
    setNoticeFor(requestId)
    load()       // le panneau à jour
    onChanged()  // la liste derrière aussi
  }

  // Une autre demande ouverte : on n'affiche pas l'ancienne le temps de lire la nouvelle.
  const current = loaded && loaded.request.id === requestId ? loaded : null
  const first = current?.documents[0]
  const several = (current?.documents.length ?? 0) > 1

  return <SidePanel open={requestId !== null} onClose={onClose} width={620}
    title={first ? (several ? `${current!.documents.length} documents` : first.doc_type) : 'Document request'}
    description={first ? `Request n° ${first.request} · requested ${formatDate(first.created_at.slice(0, 10))}` : undefined}>
    {!current || !first
      ? <p className="py-10 text-center text-sm text-slate-500">{failed ? 'Could not load this request.' : 'Loading...'}</p>
      : <div className="flex flex-col gap-4">
          {noticeFor === requestId && <p role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
            <CheckCheck className="size-4" /> Done. {current.documents.map((document) => `${several ? `${document.doc_type}: ` : 'Status now: '}${stateOf(document).label}${
              document.original_state === 'COLLECTED' && document.handed_to ? ` (handed over to ${document.handed_to})` : ''}`).join(' · ')}.
          </p>}
          <Summary document={first} showEmployee={showEmployee} />
          {/* Chaque document : son état et son chemin (le PDF, l'original). */}
          {current.documents.map((document) => <DocumentCard key={document.id} document={document} />)}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">History</h3>
            <RequestTimeline request={current.request} papers={current.documents} onChanged={changed} />
          </section>
        </div>}
  </SidePanel>
}

/** Le résumé de la DEMANDE (le même pour tous ses documents) : pour qui, pour quoi, le format, qui l'a faite. */
function Summary({ document, showEmployee }: { document: DocumentRequest; showEmployee: boolean }) {
  const rows: [string, ReactNode][] = [
    ...(showEmployee ? [['Employee', `${document.employee} · ${document.department}`] as [string, ReactNode]] : []),
    ['For', document.purpose || '—'],
    ['Needed by', document.needed_by ? formatDate(document.needed_by) : '—'],  // la date souhaitée du collaborateur
    ['Format', FORMATS.find((option) => option.id === document.format)?.title ?? document.format_label],
    ...(document.requested_by ? [['Requested by', document.requested_by] as [string, ReactNode]] : []),  // un RH, ou le manager
    ...(document.refusal ? [['Refusal reason', document.refusal] as [string, ReactNode]] : []),
  ]
  return <dl className="grid gap-x-4 gap-y-2.5 rounded-xl border border-slate-200/80 bg-white p-4 text-xs sm:grid-cols-2">
    {rows.map(([label, value]) => <div key={label}>
      <dt className="text-[11px] text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-medium text-[#192646]">{value}</dd>
    </div>)}
  </dl>
}

/** UN document : son nom, son état, pour quand, sa référence, puis où en sont son PDF et son original papier. */
function DocumentCard({ document }: { document: DocumentRequest }) {
  const state = stateOf(document)
  const facts = [
    document.due_date && `expected by ${formatDate(document.due_date)}${document.late ? ' (late)' : ''}`,
    document.reference && `ref. ${document.reference}`,
  ].filter(Boolean)
  return <div className="rounded-xl border border-slate-200/80 bg-white p-3">
    <div className="flex flex-wrap items-center gap-2">
      <p className="min-w-0 flex-1 text-sm font-semibold text-[#192646]">{document.doc_type}</p>
      <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', state.badge)}>{state.label}</span>
    </div>
    {facts.length > 0 && <p className="text-[11px] text-slate-500">{facts.join(' · ')}</p>}
    {/* Le PDF livré (2026-11-17, ouvert depuis la cloche "Document prêt") : le voir, ou le télécharger. */}
    {document.can_download && <div className="mt-2 flex flex-wrap items-center gap-2">
      <ViewButton document={document} />
      <DownloadButton document={document} />
    </div>}
    <Tracks document={document} />
  </div>
}

/** "View" : le PDF livré dans un nouvel onglet (le navigateur l'affiche ; on peut l'imprimer ou l'enregistrer de là). */
function ViewButton({ document }: { document: DocumentRequest }) {
  const [error, setError] = useState('')
  return <>
    <button type="button" onClick={async () => setError(await getFile(fileUrl(document), document.file_name || 'document.pdf', false))}
      className="flex items-center gap-1.5 rounded-lg bg-[#23355d] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#192646]">
      <Eye className="size-3.5" /> View
    </button>
    {error && <span role="alert" className="text-[11px] text-red-600">{error}</span>}
  </>
}

/** Le PDF et l'original papier, côte à côte : où en est chacun (ce que le collaborateur a demandé seulement). */
function Tracks({ document }: { document: DocumentRequest }) {
  if (document.status !== 'APPROVED') return null
  const pdf = document.format === 'ORIGINAL' ? null
    : document.has_file ? { text: 'Ready to download', tone: 'text-emerald-700' } : { text: 'Being prepared by HR', tone: 'text-sky-700' }
  const originals: Record<string, { text: string; tone: string }> = {
    TO_SIGN: { text: 'Being signed by HR', tone: 'text-sky-700' },
    PICKUP: { text: 'Ready at the HR office', tone: 'text-violet-700' },
    COLLECTED: { text: `Collected${document.collected_at ? ` ${new Date(document.collected_at).toLocaleDateString('fr-FR')}` : ''}`, tone: 'text-emerald-700' },
  }
  const original = document.original_state ? originals[document.original_state] : null
  return <div className="mt-2 grid gap-2 sm:grid-cols-2">
    {pdf && <Track icon={<FileText className="size-4" />} title="PDF" text={pdf.text} tone={pdf.tone} />}
    {original && <Track icon={<Stamp className="size-4" />} title="Signed original" text={original.text} tone={original.tone} />}
  </div>
}

function Track({ icon, title, text, tone }: { icon: ReactNode; title: string; text: string; tone: string }) {
  return <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-2.5">
    <span className="flex size-8 items-center justify-center rounded-lg bg-[#E4E9F2] text-[#23355d]" aria-hidden>{icon}</span>
    <div>
      <p className="text-[11px] text-slate-500">{title}</p>
      <p className={cn('text-xs font-semibold', tone)}>{text}</p>
    </div>
  </div>
}
