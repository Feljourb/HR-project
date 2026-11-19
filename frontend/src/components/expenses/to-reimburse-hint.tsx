'use client'

/*
 * La phrase qui suit "Approved" quand MA validation était la dernière d'une note de frais (2026-11-19, demande de
 * l'utilisatrice) : la note est acceptée, elle attend maintenant le paiement dans Reimbursements -> To reimburse.
 * Un seul composant : Team approvals ET la page de la note.
 */
import Link from 'next/link'

export function ToReimburseHint() {
  return <> It now waits in{' '}
    <Link href="/reimbursements" className="font-semibold underline underline-offset-2 hover:text-emerald-900">Reimbursements → To reimburse</Link>:
    mark it reimbursed once paid.</>
}
