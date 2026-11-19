/*
 * Les notes de frais, comme Django les envoie (/api/expenses/...).
 */
import { apiFetch } from './api'

// Une catégorie du formulaire (2026-11-18) : son plafond POUR MON GRADE (my_ceiling, null = pas de plafond) et son unité
// (per : une ligne = une dépense / un jour / un trajet / une nuit). above_ceiling_allowed : dépassement permis avec une raison.
export type Per = 'EXPENSE' | 'DAY' | 'TRIP' | 'NIGHT'
export type ExpenseCategory = {
  id: number; name: string; per: Per; per_label: string; receipt_required: boolean; above_ceiling_allowed: boolean; my_ceiling: number | null
}

// "My ceilings" : mes plafonds (selon mon grade), une ligne par catégorie plafonnée.
export type MyCeiling = { category: string; per: string; amount: number }

// Un justificatif : le fichier s'ouvre avec GET /api/expenses/receipts/<id>/.
export type Receipt = { id: number; name: string }

export type ExpenseLine = {
  id: number; date: string; category: number; category_label: string; amount: number
  description: string; receipts: Receipt[]  // 0 à 5 (ex. la facture + le ticket de carte)
  ceiling: number | null        // ce qui RESTAIT du maximum pour cette ligne, à l'envoi (ex. 0,12)
  maximum: number | null        // le maximum complet du grade, à l'envoi (ex. 350) ; null = ancienne ligne / pas de plafond
  per: Per                      // l'unité du maximum (par jour / nuit / trajet = la note / dépense)
  above_ceiling: number | null  // de combien la dépense le dépasse (ex. 200), ou null
  justification: string         // pourquoi (seulement quand elle le dépasse)
  corrections: Correction[]     // un valideur a diminué le montant (la première dit le montant demandé)
  // Payée dans une autre devise (2026-11-16) : "20,00 EUR × 10,9553" ; null = en MAD. `amount` = la conversion en MAD.
  currency_code: string | null; original_amount: number | null; rate: number | null
}

// Une devise et son taux du jour : 1 EUR = 10,9553 MAD (mis à jour tout seul chaque matin).
export type Currency = { id: number; name: string; rate_to_mad: number; rate_updated_at: string | null }

// Une correction d'un montant par un valideur (2026-11-16) : la trace.
export type Correction = {
  id: number; old_amount: number; new_amount: number; reason: string
  corrected_by: string | null; as_role: string; corrected_at: string
}

// Le même maximum que Django (MAX_RECEIPTS).
export const MAX_RECEIPTS = 5

export type ExpenseClaim = {
  id: number
  request: number          // le numéro de la demande du moteur : l'adresse de la note (/expenses/<request>)
  title: string
  total: number
  status: string           // IN_PROGRESS, APPROVED, REJECTED, CANCELLED (le statut du moteur)
  status_label: string
  created_at: string
  waiting_for: string | null   // "Youssef Bennani (N+1)", ou null
  reimbursed_at: string | null
  reimbursed_by: string | null
  employee: string
  department: string
  pole: string
  grade: string | null
  lines: ExpenseLine[]
  can_correct: boolean     // celui qui lit peut changer un montant maintenant (bouton "Change the amount")
  can_reimburse: boolean   // un RH du pôle, note acceptée pas encore payée : bouton "Mark reimbursed"
}

/** 1250.5 -> "1 250,50 MAD" */
export function formatMad(amount: number) {
  return `${amount.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MAD`
}

// Les couleurs des statuts (les mêmes que les congés), + "Remboursée".
export const STATUS_BADGE: Record<string, string> = {
  IN_PROGRESS: 'bg-amber-50 text-amber-700',
  APPROVED: 'bg-emerald-50 text-emerald-700',
  REJECTED: 'bg-red-50 text-red-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
  REIMBURSED: 'bg-[#E4E9F2] text-[#23355d]',
}

/** Le statut affiché : "Remboursée" passe avant "Acceptée". */
export function claimStatus(claim: ExpenseClaim): { key: string; label: string } {
  return claim.reimbursed_at ? { key: 'REIMBURSED', label: 'Remboursée' } : { key: claim.status, label: claim.status_label }
}

/**
 * Récupère un fichier protégé (PDF, justificatif) avec les cookies de connexion, puis :
 * - download : l'enregistre sous `fileName` ;
 * - sinon : l'ouvre dans un nouvel onglet (photo, PDF).
 * Renvoie le message d'erreur à afficher, ou ''.
 */
export async function getFile(path: string, fileName: string, download: boolean): Promise<string> {
  // L'onglet s'ouvre TOUT DE SUITE (pendant le clic) : sinon le navigateur le bloque comme une pub.
  const tab = download ? null : window.open('', '_blank')
  try {
    const response = await apiFetch(path)
    if (!response.ok) {
      tab?.close()
      const data = await response.json().catch(() => ({}))
      return data.detail ?? 'Could not get the file.'
    }
    const url = URL.createObjectURL(await response.blob())
    if (tab) {
      tab.location.href = url
    } else {
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      link.click()
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    return ''
  } catch {
    tab?.close()
    return 'Cannot reach the server. Please try again later.'
  }
}
