'use client'

/*
 * La phrase qui suit "Approved: ..." / "Rejected: ..." après MA réponse (2026-11-25, demande de l'utilisatrice :
 * "le manager voit juste le message vert, il ne sait pas où suivre"). Standard Workday / ServiceNow : dire ce qui se
 * passe MAINTENANT, et un lien pour le suivre. Un seul composant : Team approvals ET Stand-in requests.
 * - une note de frais dont j'étais la dernière validation : elle attend le paiement (Reimbursements) ;
 * - un départ dont j'étais la dernière validation : ses tâches ont commencé -> Arrivals & departures, panneau ouvert ;
 * - une étape "Valider" vient après la mienne : "It now waits for HR." + "Follow it" (l'historique) ;
 * - sinon (dernière réponse, ou refus) : "View the request" (l'historique).
 */
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { ToReimburseHint } from '@/components/expenses/to-reimburse-hint'
import { closesExpenseClaim, type Approval } from '@/lib/requests'
import { roleOf } from './request-history'

const linkClass = 'inline-flex items-center gap-0.5 font-semibold underline underline-offset-2 hover:text-emerald-900'

export function AfterAnswer({ approval, verb, from }: { approval: Approval; verb: string; from: string }) {
  const request = approval.request
  const history = `/requests/${request.id}?from=${from}`
  const mine = request.steps.find((step) => step.status === 'PENDING')
  const nextValidators = mine ? request.steps.filter((step) => step.order > mine.order && step.mode === 'VALIDATE') : []

  if (verb === 'Approved' && closesExpenseClaim(request)) return <ToReimburseHint />
  if (verb === 'Approved' && nextValidators.length > 0) {
    return <> It now waits for {roleOf(nextValidators[0])}.{' '}
      <Link href={history} className={linkClass}>Follow it <ArrowRight className="size-3" /></Link></>
  }
  if (verb === 'Approved' && request.workflow_code === 'DEPARTURE') {
    return <> The departure tasks have started (PC, badge…).{' '}
      <Link href={`/onboarding?request=${request.id}`} className={linkClass}>Open in Arrivals &amp; departures <ArrowRight className="size-3" /></Link></>
  }
  return <> <Link href={history} className={linkClass}>View the request <ArrowRight className="size-3" /></Link></>
}
