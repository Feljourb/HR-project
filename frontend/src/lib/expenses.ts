/*
 * Les notes de frais, comme Django les envoie (/api/expenses/...).
 */
import { apiFetch } from './api'

export type Ceiling = 'NONE' | 'DAILY_ALLOWANCE' | 'TRANSPORT' | 'HOTEL'

export type ExpenseCategory = { id: number; name: string; ceiling: Ceiling; ceiling_label: string; receipt_required: boolean }

// Le barème d'un grade (MAD) : indemnité par jour, transport par trajet, hôtel par nuit.
export type Scale = { id: number; grade: number; grade_label: string; daily_allowance: number; transport: number; hotel: number }

// Un justificatif : le fichier s'ouvre avec GET /api/expenses/receipts/<id>/.
export type Receipt = { id: number; name: string }

export type ExpenseLine = {
  id: number; date: string; category: number; category_label: string; amount: number
  description: string; receipts: Receipt[]  // 0 à 5 (ex. la facture + le ticket de carte)
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
}

/** Le plafond d'une catégorie dans un barème (null : pas de plafond). */
export function ceilingOf(scale: Scale | null, category: ExpenseCategory | undefined): number | null {
  if (!scale || !category) return null
  if (category.ceiling === 'DAILY_ALLOWANCE') return scale.daily_allowance
  if (category.ceiling === 'TRANSPORT') return scale.transport
  if (category.ceiling === 'HOTEL') return scale.hotel
  return null
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
