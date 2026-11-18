'use client'

/*
 * Team approvals : la carte d'une NOTE DE FRAIS qui attend ma réponse (2026-11-18, demandes de l'utilisatrice :
 * "simple, standard", puis "valider / refuser sans ouvrir, et un bouton pour voir la note").
 * Comme SAP Concur / Expensify :
 * - la carte résume en une ligne (total, nombre de dépenses, au-dessus du maximum, qui a déjà validé) ;
 * - Approve / Reject directement sur la carte ;
 * - "View the claim" ouvre la note dans un panneau à droite (sans quitter la page) : chaque dépense et ses
 *   justificatifs, "Lower the amount" si besoin, et la même réponse en bas du panneau.
 */
import { useEffect, useState } from 'react'
import { Check, Eye, Plane, ReceiptText, TriangleAlert } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { formatMad, type ExpenseClaim } from '@/lib/expenses'
import { formatDate } from '@/lib/leaves'
import type { Approval } from '@/lib/requests'
import { ClaimView } from '@/components/expenses/claim-detail'
import { SidePanel } from '@/components/ui/side-panel'
import { Decision } from './decision'
import { roleOf } from './request-history'

export function ExpenseApprovalCard({ approval, onAnswered }: { approval: Approval; onAnswered: (verb: string) => void }) {
  const request = approval.request
  const [claim, setClaim] = useState<ExpenseClaim | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    apiFetch(`/api/expenses/claims/${request.id}/`)
      .then(async (response) => { if (response.ok) setClaim(await response.json()) })
      .catch(() => undefined)  // la carte reste utilisable : Approve / Reject marchent sans le résumé
  }, [request.id])

  const above = claim ? claim.lines.filter((line) => line.above_ceiling !== null).length : 0
  // Ceux qui ont déjà validé avant moi (ex. le N+1, quand je suis les RH).
  const approvedBefore = request.steps.filter((step) => step.status === 'APPROVED')
  const role = roleOf(approval)

  return <article className="rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <div className="flex flex-wrap items-start gap-3 px-4 py-3.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#E4E9F2] text-[#23355d]" aria-hidden>
        <ReceiptText className="size-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8C6D52]">Expense claim · N° {request.id}</p>
        <h3 className="truncate text-sm font-semibold text-[#192646]">{claim?.title ?? request.title}</h3>
        <p className="text-[11px] text-slate-500">
          {request.requester}{claim ? <> · {claim.department} · {claim.grade ?? 'no grade'}</> : null} · sent {formatDate(request.created_at.slice(0, 10))}
        </p>

        {/* Le résumé en une ligne : combien, combien de dépenses, et ce qui demande l'attention. */}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {claim && <>
            <span className="text-sm font-semibold tabular-nums text-[#192646]">{formatMad(claim.total)}</span>
            <span className="text-slate-500">{claim.lines.length} expense{claim.lines.length > 1 ? 's' : ''}</span>
            {above > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
              <TriangleAlert className="size-3" aria-hidden /> {above} above the maximum
            </span>}
          </>}
          {approvedBefore.map((step) => <span key={step.order} className="inline-flex items-center gap-1 text-slate-600">
            <Check className="size-3.5 text-emerald-600" aria-hidden /> Approved by {step.decided_by_name ?? step.validator} ({roleOf(step)})
          </span>)}
        </div>
        {/* Je réponds à la place d'un valideur absent (son délégué). */}
        {approval.on_behalf_of && <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-amber-800">
          <Plane className="size-3.5" aria-hidden /> On behalf of {approval.on_behalf_of} (away)
        </p>}
      </div>
      <div className="flex flex-col items-end gap-2">
        <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">Waiting for you ({role})</span>
        <button type="button" onClick={() => setOpen(true)} disabled={!claim}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#23355d] hover:border-[#23355d]/40 hover:bg-[#E4E9F2]/40 disabled:opacity-50">
          <Eye className="size-3.5" aria-hidden /> View the claim
        </button>
      </div>
    </div>

    <footer className="border-t border-slate-100 px-4 py-3">
      <Decision approval={approval} onAnswered={onAnswered} />
    </footer>

    {/* La note dans un panneau à droite : la voir, baisser un montant, puis répondre, sans quitter la page. */}
    <SidePanel open={open} onClose={() => setOpen(false)} width={900}
      title={claim?.title ?? request.title} description={`Expense claim n° ${request.id} · ${request.requester}`}>
      {claim && <div className="flex flex-col gap-4">
        <ClaimView claim={claim} onChanged={setClaim} waitingForMe={role} />
        <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <h3 className="text-sm font-semibold text-[#192646]">Your answer</h3>
          <p className="mb-3 text-xs text-slate-500">Approve = the claim goes to the next step. Reject = the claim is closed (say why in the comment).</p>
          <Decision approval={approval} onAnswered={(verb) => { setOpen(false); onAnswered(verb) }} />
        </section>
      </div>}
    </SidePanel>
  </article>
}
