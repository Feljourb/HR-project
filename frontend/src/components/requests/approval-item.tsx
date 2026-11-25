'use client'

/*
 * UNE demande qui attend ma réponse, telle qu'elle s'affiche PARTOUT : Team approvals ET Stand-in requests
 * (2026-11-19, règle de l'utilisatrice : une chose partagée = un seul composant ; avant, la page du délégué
 * gardait l'ancienne carte de la note de frais).
 * - Une note de frais : la carte résumé (total, Approve / Reject, "View the claim").
 * - Un départ (2026-11-25) : la carte départ (type, dernier jour, la lettre View / Download, commentaire...).
 * - Les autres (congé, document...) : la carte avec le circuit, le calendrier de l'équipe pour un congé, et la réponse.
 */
import { Plane } from 'lucide-react'
import type { Approval } from '@/lib/requests'
import { Decision } from './decision'
import { DepartureApprovalCard } from './departure-approval-card'
import { ExpenseApprovalCard } from './expense-approval-card'
import { RequestCard } from './request-card'
import { TeamCalendar } from './team-calendar'

export function ApprovalItem({ approval, onAnswered }: { approval: Approval; onAnswered: (verb: string, label?: string) => void }) {
  if (approval.request.workflow_code === 'EXPENSE') return <ExpenseApprovalCard approval={approval} onAnswered={onAnswered} />
  if (approval.request.workflow_code === 'DEPARTURE') return <DepartureApprovalCard approval={approval} onAnswered={onAnswered} />
  return <RequestCard request={approval.request} showRequester>
    {/* Je réponds à la place d'un valideur absent (son délégué). */}
    {approval.on_behalf_of && <p className="mb-2 flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-800">
      <Plane className="size-3.5" aria-hidden /> On behalf of {approval.on_behalf_of} (away)
    </p>}
    {/* Un congé : qui d'autre de l'équipe est absent ces jours-là, avant de décider. */}
    {approval.request.workflow_code === 'LEAVE' && <TeamCalendar requestId={approval.request.id} />}
    <Decision approval={approval} onAnswered={onAnswered} />
  </RequestCard>
}
