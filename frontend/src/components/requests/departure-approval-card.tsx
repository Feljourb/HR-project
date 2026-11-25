'use client'

/*
 * Team approvals (et Stand-in requests) : la carte d'un DÉPART qui attend ma réponse (2026-11-25, demande de
 * l'utilisatrice : "fin ghaychuf la lettre de démission ?"). Standard Workday "Resignation" / SAP : le valideur voit
 * TOUT sur la carte avant de répondre, comme la carte de la note de frais (même thème) :
 * qui part, le type, le dernier jour (et dans combien de jours : le préavis), la lettre (View / Download),
 * le commentaire, les personnes à prévenir, qui a déjà validé, puis Approve / Reject.
 * La lettre : seulement pour ceux qui lisent l'historique de la demande (sinon le serveur répond 404).
 */
import { useEffect, useState } from 'react'
import { BellRing, CalendarDays, Check, Download, DoorOpen, Eye, FileText, MessageSquareText, Plane } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { getFile } from '@/lib/expenses'
import { formatDate } from '@/lib/leaves'
import { frDate, fromToday, type Departure } from '@/lib/journeys'
import type { Approval } from '@/lib/requests'
import { DepartureNotice } from '@/components/journeys/notice'
import { Decision } from './decision'
import { roleOf } from './request-history'

export function DepartureApprovalCard({ approval, onAnswered }: { approval: Approval; onAnswered: (verb: string, label?: string) => void }) {
  const request = approval.request
  const [departure, setDeparture] = useState<Departure | null>(null)
  const [fileError, setFileError] = useState('')

  useEffect(() => {
    apiFetch(`/api/journeys/departures/request/${request.id}/`)
      .then(async (response) => { if (response.ok) setDeparture(await response.json()) })
      .catch(() => undefined)  // la carte reste utilisable : Approve / Reject marchent sans le détail
  }, [request.id])

  const role = roleOf(approval)
  // Ceux qui ont déjà validé avant moi (ex. le N+1, quand je suis les RH), et ce qui vient après moi.
  const approvedBefore = request.steps.filter((step) => step.status === 'APPROVED')
  const next = request.steps.filter((step) => step.status === 'WAITING')
  const letter = departure?.has_letter ? `/api/journeys/departures/${departure.id}/letter/` : null

  return <article className="rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <div className="flex flex-wrap items-start gap-3 px-4 py-3.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#E4E9F2] text-[#23355d]" aria-hidden>
        <DoorOpen className="size-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8C6D52]">Departure · N° {request.id}</p>
        <h3 className="truncate text-sm font-semibold text-[#192646]">{departure?.employee.name ?? request.requester}</h3>
        <p className="text-[11px] text-slate-500">
          {departure ? <>{departure.employee.position} · {departure.employee.department} · </> : null}sent {formatDate(request.created_at.slice(0, 10))}
          {departure && departure.requested_by_name && departure.requested_by_name !== departure.employee.name
            ? <> · entered by {departure.requested_by_name}</> : null}
        </p>

        {/* L'essentiel en une ligne : le type et le dernier jour (dans combien de jours = le préavis). */}
        {departure && <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E4E9F2] px-2.5 py-0.5 font-semibold text-[#23355d]">{departure.type_label}</span>
          {departure.serious_misconduct && <span className="rounded-full bg-red-50 px-2.5 py-0.5 font-semibold text-red-700 ring-1 ring-inset ring-red-200">Serious misconduct</span>}
          <span className="inline-flex items-center gap-1.5 text-slate-700">
            <CalendarDays className="size-3.5 text-slate-400" aria-hidden />
            Last day: <span className="font-semibold text-[#192646]">{frDate(departure.last_day)}</span>
            <span className="text-slate-500">({fromToday(departure.last_day)})</span>
          </span>
        </div>}

        {/* Le préavis légal (2026-11-25) : le valideur voit tout de suite si le dernier jour va (jamais bloquant). */}
        {departure && <div className="mt-2"><DepartureNotice departure={departure} /></div>}

        {/* La lettre : l'ouvrir dans un onglet, ou l'enregistrer. */}
        {departure && <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
          <FileText className="size-3.5 text-slate-400" aria-hidden />
          {letter ? <>
            <span className="max-w-[16rem] truncate font-medium text-slate-700">{departure.letter_name || 'Letter'}</span>
            <button type="button" onClick={async () => setFileError(await getFile(letter, departure.letter_name || 'lettre.pdf', false))}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-[#23355d] hover:border-[#23355d]/40 hover:bg-[#E4E9F2]/40">
              <Eye className="size-3.5" aria-hidden /> View
            </button>
            <button type="button" onClick={async () => setFileError(await getFile(letter, departure.letter_name || 'lettre.pdf', true))}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-[#23355d] hover:border-[#23355d]/40 hover:bg-[#E4E9F2]/40">
              <Download className="size-3.5" aria-hidden /> Download
            </button>
          </> : <span className="text-slate-500">No letter attached</span>}
          {fileError && <span role="alert" className="text-[11px] text-red-600">{fileError}</span>}
        </div>}

        {departure?.comment && <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-700">
          <MessageSquareText className="mt-0.5 size-3.5 shrink-0 text-slate-400" aria-hidden /> <span className="italic">“{departure.comment}”</span>
        </p>}
        {departure && departure.informed.length > 0 && <p className="mt-1.5 flex items-start gap-1.5 text-xs text-slate-600">
          <BellRing className="mt-0.5 size-3.5 shrink-0 text-slate-400" aria-hidden /> To inform once approved: {departure.informed.join(', ')}
        </p>}

        {/* Le circuit en bref : qui a déjà validé, qui vient après moi. */}
        {(approvedBefore.length > 0 || next.length > 0) && <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
          {approvedBefore.map((step) => <span key={step.order} className="inline-flex items-center gap-1">
            <Check className="size-3.5 text-emerald-600" aria-hidden /> Approved by {step.decided_by_name ?? step.validator} ({roleOf(step)})
          </span>)}
          {next.length > 0 && <span className="text-slate-500">Then: {next.map((step) => roleOf(step)).join(' → ')}</span>}
        </div>}

        {/* Je réponds à la place d'un valideur absent (son délégué). */}
        {approval.on_behalf_of && <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-amber-800">
          <Plane className="size-3.5" aria-hidden /> On behalf of {approval.on_behalf_of} (away)
        </p>}
      </div>
      <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">Waiting for you ({role})</span>
    </div>

    <footer className="border-t border-slate-100 px-4 py-3">
      <Decision approval={approval} onAnswered={(verb) => onAnswered(verb, departure ? `departure of ${departure.employee.name}` : undefined)} />
    </footer>
  </article>
}
