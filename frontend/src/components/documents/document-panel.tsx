'use client'

/*
 * Le détail d'une demande de document, dans un panneau à droite (step A du 2026-11-13, standard Gmail / Jira / Workday :
 * un clic sur une ligne -> tout son détail, sans quitter la page). Pour le collaborateur (My documents) et les RH
 * (Document requests) :
 * - le résumé (document, pour quoi, format, délai, référence) ;
 * - où en sont le PDF et l'original papier ;
 * - la ligne du temps complète (la même que la page historique) avec ses boutons (Download, Upload, Original ready...).
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { FileText, Stamp } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { FORMATS, stateOf, type DocumentRequest } from '@/lib/documents'
import { formatDate } from '@/lib/leaves'
import type { WorkflowRequest } from '@/lib/requests'
import { cn } from '@/lib/utils'
import { SidePanel } from '@/components/ui/side-panel'
import { RequestTimeline } from '@/components/requests/request-history'

type Loaded = { request: WorkflowRequest; document: DocumentRequest }

export function DocumentPanel({ requestId, onClose, onChanged, forHr = false }: {
  requestId: number | null   // la demande ouverte (null : panneau fermé)
  onClose: () => void
  onChanged: () => void      // un clic a changé quelque chose (ex. "Original ready") : la liste derrière se relit
  forHr?: boolean            // les RH : le nom du collaborateur et son service en plus
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(() => {
    if (requestId === null) return
    Promise.all([apiFetch(`/api/workflows/history/${requestId}/`), apiFetch(`/api/documents/requests/${requestId}/`)])
      .then(async ([request, document]) => {
        if (!request.ok || !document.ok) throw new Error()
        setLoaded({ request: await request.json(), document: await document.json() })
      })
      .catch(() => setFailed(true))
  }, [requestId])
  useEffect(load, [load])

  function changed() {
    load()       // le panneau à jour
    onChanged()  // la liste derrière aussi
  }

  // Une autre demande ouverte : on n'affiche pas l'ancienne le temps de lire la nouvelle.
  const current = loaded && loaded.request.id === requestId ? loaded : null
  const document = current?.document

  return <SidePanel open={requestId !== null} onClose={onClose} width={620}
    title={document ? document.doc_type : 'Document request'}
    description={document ? `Request n° ${document.request} · requested ${formatDate(document.created_at.slice(0, 10))}` : undefined}>
    {!current || !document
      ? <p className="py-10 text-center text-sm text-slate-500">{failed ? 'Could not load this request.' : 'Loading...'}</p>
      : <div className="flex flex-col gap-4">
          <Summary document={document} forHr={forHr} />
          <Tracks document={document} />
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">History</h3>
            <RequestTimeline request={current.request} paper={document} onChanged={changed} />
          </section>
        </div>}
  </SidePanel>
}

/** Le résumé, en deux colonnes : ce qui a été demandé, et pour quand. */
function Summary({ document, forHr }: { document: DocumentRequest; forHr: boolean }) {
  const state = stateOf(document)
  const rows: [string, ReactNode][] = [
    ...(forHr ? [['Employee', `${document.employee} · ${document.department}`] as [string, ReactNode]] : []),
    ['Status', <span key="s" className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', state.badge)}>{state.label}</span>],
    ['For', document.purpose || '—'],
    ['Format', FORMATS.find((option) => option.id === document.format)?.title ?? document.format_label],
    ['Expected by', document.due_date ? `${formatDate(document.due_date)}${document.late ? ' (late)' : ''}` : '—'],
    ['Reference', document.reference || '—'],
    ...(document.requested_by ? [['Requested by HR', document.requested_by] as [string, ReactNode]] : []),
    ...(document.refusal ? [['Refusal reason', document.refusal] as [string, ReactNode]] : []),
  ]
  return <dl className="grid gap-x-4 gap-y-2.5 rounded-xl border border-slate-200/80 bg-white p-4 text-xs sm:grid-cols-2">
    {rows.map(([label, value]) => <div key={label}>
      <dt className="text-[11px] text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-medium text-[#192646]">{value}</dd>
    </div>)}
  </dl>
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
  return <div className="grid gap-3 sm:grid-cols-2">
    {pdf && <Track icon={<FileText className="size-4" />} title="PDF" text={pdf.text} tone={pdf.tone} />}
    {original && <Track icon={<Stamp className="size-4" />} title="Signed original" text={original.text} tone={original.tone} />}
  </div>
}

function Track({ icon, title, text, tone }: { icon: ReactNode; title: string; text: string; tone: string }) {
  return <div className="flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white p-3">
    <span className="flex size-8 items-center justify-center rounded-lg bg-[#E4E9F2] text-[#23355d]" aria-hidden>{icon}</span>
    <div>
      <p className="text-[11px] text-slate-500">{title}</p>
      <p className={cn('text-xs font-semibold', tone)}>{text}</p>
    </div>
  </div>
}
