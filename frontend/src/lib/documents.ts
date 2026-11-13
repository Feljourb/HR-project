/*
 * Documents administratifs (/api/documents/) : les types de document et les demandes.
 * Le statut vient du moteur ; `state` dit où en est le document (prêt, à préparer par les RH...).
 */

export type DocumentType = {
  id: number
  name: string
  automatic: boolean  // true : l'application génère le PDF dès la validation des RH
  delivery_days: number  // le délai promis, en jours ouvrés (0 : tout de suite)
}

export type DocumentState = 'IN_PROGRESS' | 'TO_PREPARE' | 'READY' | 'REJECTED' | 'CANCELLED'

// Le format choisi par le collaborateur (standard : une banque, un consulat demandent souvent l'ORIGINAL signé).
export type DocumentFormat = 'PDF' | 'ORIGINAL' | 'BOTH'
export const FORMATS: { id: DocumentFormat; title: string; text: string; short: string }[] = [
  { id: 'PDF', title: 'PDF', text: 'Download it here', short: 'PDF' },
  { id: 'ORIGINAL', title: 'Signed original', text: 'Paper, picked up at the HR office', short: 'original' },
  { id: 'BOTH', title: 'Both', text: 'PDF now + the paper original', short: 'PDF + original' },
]

export type DocumentRequest = {
  id: number
  request: number          // la demande du moteur : son historique /requests/<n>, son fichier /api/documents/files/<n>/
  doc_type: string
  automatic: boolean
  purpose: string
  format: DocumentFormat   // ce que veut le collaborateur : PDF, l'original papier, ou les deux
  format_label: string
  status: string           // le statut du moteur (IN_PROGRESS, APPROVED, REJECTED, CANCELLED)
  state: DocumentState
  created_at: string
  closed_at: string | null
  employee: string
  department: string
  reference: string | null
  file_name: string
  has_file: boolean
  delivered_at: string | null
  delivered_by: string | null  // le RH qui a déposé le fichier ; null : généré par l'application
  refusal: string              // le motif du refus des RH
  requested_by: string | null  // le RH qui a demandé POUR le collaborateur ; null : lui-même
  due_date: string | null      // prêt au plus tard le (date de la demande + le délai du type)
  late: boolean                // pas livré et le délai est passé
  can_upload: boolean          // celui qui lit peut déposer / remplacer le PDF (RH du pôle, document préparé par les RH)
}

// Les états en anglais (les pages sont en anglais), avec les couleurs des autres pages.
export const STATE: Record<DocumentState, { label: string; badge: string }> = {
  IN_PROGRESS: { label: 'In approval', badge: 'bg-amber-50 text-amber-700 ring-amber-200' },
  TO_PREPARE: { label: 'Being prepared', badge: 'bg-sky-50 text-sky-700 ring-sky-200' },
  READY: { label: 'Ready', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  REJECTED: { label: 'Refused', badge: 'bg-red-50 text-red-700 ring-red-200' },
  CANCELLED: { label: 'Cancelled', badge: 'bg-slate-100 text-slate-500 ring-slate-200' },
}

/** Le lien de téléchargement du PDF (à donner à getFile de lib/expenses : il garde les cookies). */
export const fileUrl = (document: DocumentRequest) => `/api/documents/files/${document.request}/`
