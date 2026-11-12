/*
 * Documents administratifs (/api/documents/) : les types de document et les demandes.
 * Le statut vient du moteur ; `state` dit où en est le document (prêt, à préparer par les RH...).
 */

export type DocumentType = {
  id: number
  name: string
  automatic: boolean  // true : l'application génère le PDF dès la validation des RH
}

export type DocumentState = 'IN_PROGRESS' | 'TO_PREPARE' | 'READY' | 'REJECTED' | 'CANCELLED'

export type DocumentRequest = {
  id: number
  request: number          // la demande du moteur : son historique /requests/<n>, son fichier /api/documents/files/<n>/
  doc_type: string
  automatic: boolean
  purpose: string
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
