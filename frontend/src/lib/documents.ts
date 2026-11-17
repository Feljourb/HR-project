/*
 * Documents administratifs (/api/documents/) : les types de document et les demandes.
 * Le statut vient du moteur ; `state` dit où en est le document (prêt, à préparer par les RH...).
 */

export type DocumentType = {
  id: number
  name: string
  automatic: boolean  // true : l'application génère le PDF dès la validation des RH
  delivery_days: number  // le délai promis, en jours ouvrés (0 : tout de suite)
  manager_can_request: boolean  // le N+1 peut le demander pour son équipe (choisi par Admin RH)
  hr_review: boolean            // un document généré : les RH relisent son texte avant l'envoi
  has_model: boolean            // un modèle Word / PDF à télécharger (mis par Admin RH, types préparés par les RH)
  model_name: string
}

/** Une personne de MON équipe (je suis son N+1) : "For" dans le formulaire d'un manager. */
export type TeamMember = { id: number; first_name: string; last_name: string; position: string }

// TO_PREPARE : les RH ont encore à faire (PDF et / ou original) ; PICKUP : l'original attend au bureau RH.
export type DocumentState = 'IN_PROGRESS' | 'TO_PREPARE' | 'PICKUP' | 'READY' | 'REJECTED' | 'CANCELLED'

// Le format choisi par le collaborateur (standard : une banque, un consulat demandent souvent l'ORIGINAL signé).
export type DocumentFormat = 'PDF' | 'ORIGINAL' | 'BOTH'
export const FORMATS: { id: DocumentFormat; title: string; text: string; short: string }[] = [
  { id: 'PDF', title: 'PDF', text: 'Download it here', short: 'PDF' },
  { id: 'ORIGINAL', title: 'Signed original', text: 'Paper, picked up at the HR office', short: 'original' },
  { id: 'BOTH', title: 'Both', text: 'PDF now + the paper original', short: 'PDF + original' },
]

export type DocumentRequest = {
  id: number              // le DOCUMENT : son fichier /api/documents/files/<id>/, ses actions RH /api/documents/hr/<id>/...
  request: number          // la demande du moteur (un ou plusieurs documents) : son historique /requests/<n>
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
  requested_by: string | null  // le RH ou le manager qui a demandé POUR le collaborateur ; null : lui-même
  due_date: string | null      // prêt au plus tard le (date de la demande + le délai du type)
  late: boolean                // pas livré et le délai est passé
  can_upload: boolean          // celui qui lit peut déposer / remplacer le PDF (RH du pôle, document préparé par les RH)
  can_download: boolean        // celui qui lit peut télécharger le PDF livré
  can_print: boolean           // les RH : le brouillon SANS signature, à imprimer pour signer à la main (step D)
  // L'original papier (format ORIGINAL / BOTH) : à signer, prêt au bureau RH, remis ; qui et quand.
  original_state: 'TO_SIGN' | 'PICKUP' | 'COLLECTED' | null
  original_ready_at: string | null
  original_ready_by: string | null
  collected_at: string | null
  collected_by: string | null
  can_handle_original: boolean // boutons "Original ready" / "Handed over" (RH du pôle)
  needs_review: boolean        // "Relecture RH" demandée, pas encore faite : rien n'est fabriqué
  can_edit_text: boolean       // le RH peut relire / modifier le texte (document généré, pas encore livré)
  text_reviewed_by: string | null
  body_edited_at: string | null
  handed_to: string | null     // à qui l'original a été remis : le collaborateur, ou son manager venu pour lui
  manager: string | null       // son manager (N+1), quand l'original attend : "Handed over to ... his manager"
  // ① "Download" des RH : 'draft' (généré : le PDF sans signature), 'model' (le modèle Word du type), null (rien).
  hr_download: 'draft' | 'model' | null
  model_name: string           // le nom du modèle Word (ex. "Attestation salaire.docx")
  needed_by: string | null     // la date souhaitée par le collaborateur ("Date souhaitée", 2026-11-17)
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']

/** Le message des jours de retrait (réglage d'Admin RH, comme l'outil actuel des RH), ex. avec mercredi + vendredi :
 *  "Requested between Friday afternoon and Wednesday morning: ready on Wednesday afternoon." (une phrase par jour). */
export function pickupMessage(days: number[]): string[] {
  const sorted = [...new Set(days)].filter((day) => day >= 0 && day <= 4).sort()
  if (sorted.length === 0) return []
  if (sorted.length === 1) {
    const day = WEEKDAYS[sorted[0]]
    return [`Originals requested before ${day} noon can be picked up at the HR office on ${day} afternoon (otherwise the next ${day}).`]
  }
  return sorted.map((day, index) => {
    const previous = WEEKDAYS[sorted[(index - 1 + sorted.length) % sorted.length]]
    return `Requested between ${previous} afternoon and ${WEEKDAYS[day]} morning: ready at the HR office on ${WEEKDAYS[day]} afternoon.`
  })
}

// Les états en anglais (les pages sont en anglais), avec les couleurs des autres pages.
export const STATE: Record<DocumentState, { label: string; badge: string }> = {
  IN_PROGRESS: { label: 'In approval', badge: 'bg-amber-50 text-amber-700 ring-amber-200' },
  TO_PREPARE: { label: 'Being prepared', badge: 'bg-sky-50 text-sky-700 ring-sky-200' },
  PICKUP: { label: 'Ready for pickup', badge: 'bg-violet-50 text-violet-700 ring-violet-200' },
  READY: { label: 'Ready', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  REJECTED: { label: 'Refused', badge: 'bg-red-50 text-red-700 ring-red-200' },
  CANCELLED: { label: 'Cancelled', badge: 'bg-slate-100 text-slate-500 ring-slate-200' },
}

/** Le badge d'une demande : un original seul déjà remis s'appelle "Collected" (pas "Ready"). */
export function stateOf(document: DocumentRequest) {
  if (document.state === 'READY' && document.format === 'ORIGINAL') return { label: 'Collected', badge: STATE.READY.badge }
  return STATE[document.state]
}

/** L'original papier en quelques mots : "original being signed", "original ready at the HR office"... */
export function originalText(document: DocumentRequest) {
  if (document.original_state === 'TO_SIGN') return 'original being prepared by HR'
  if (document.original_state === 'PICKUP') return 'original ready at the HR office'
  if (document.original_state === 'COLLECTED' && document.collected_at) {
    const day = new Date(document.collected_at).toLocaleDateString('fr-FR')
    // Remis à son manager (venu pour lui) : on le dit ; sinon "collected" (il est venu lui-même).
    return document.handed_to && document.handed_to !== document.employee ? `original given to ${document.handed_to} ${day}` : `original collected ${day}`
  }
  return ''
}

/** Le lien de téléchargement du PDF (à donner à getFile de lib/expenses : il garde les cookies).
 *  Le numéro du DOCUMENT (2026-11-17 : une demande peut avoir plusieurs documents). */
export const fileUrl = (document: DocumentRequest) => `/api/documents/files/${document.id}/`
