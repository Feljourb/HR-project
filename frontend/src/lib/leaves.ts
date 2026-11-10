/*
 * Les congés, comme Django les envoie (/api/leaves/...).
 */
import { apiFetch } from './api'

export type LeaveType = {
  id: number
  name: string
  deducts_balance: boolean   // true : pris sur le solde (congé annuel)
  max_days: number | null    // le maximum légal (ex. mariage : 4), null : pas de maximum
  counting: 'WORKING' | 'CALENDAR'  // P2 step 3 : jours ouvrables, ou calendaires (chaque jour compte, ex. maternité)
  document_from_days: number | null  // P2 step 4 : justificatif demandé à partir de N jours (null : jamais)
}

// Un jour férié (/api/leaves/holidays/). estimated : fête religieuse calculée, la date peut bouger d'un jour.
export type Holiday = { id: number; date: string; name: string; estimated: boolean }

// expiring : les jours qui seront perdus à la fin de cette année s'ils ne sont pas pris (null : aucun).
// acquired (les mois gagnés) + adjusted (les corrections RH, + ou -) = taken + pending + expired + available.
export type Balance = {
  acquired: number; adjusted: number; taken: number; pending: number; expired: number; available: number
  expiring: { days: number; on: string } | null
}

// Le calcul en direct (POST /api/leaves/mine/preview/) : rien n'est enregistré.
export type LeavePreview = {
  days: number
  detail: { date: string; days: number; holiday: string | null }[]
  balance: Balance
  balance_after: number | null   // null : ce type ne touche pas au solde
  error: string | null           // la règle qui bloquerait l'envoi (ex. "Solde insuffisant...")
}

export type Leave = {
  id: number
  request: number            // le numéro de la demande du moteur : pour l'annuler et voir son historique
  leave_type: number
  leave_type_label: string
  start_date: string         // "2026-11-23"
  end_date: string
  starts_afternoon: boolean
  ends_noon: boolean
  days: number
  reason: string
  status: string             // IN_PROGRESS, APPROVED, REJECTED, CANCELLED (le statut du moteur)
  status_label: string
  created_at: string
  recounts: Recount[]        // vide la plupart du temps : les recalculs après un changement de jour férié
  recorded_by: string | null // le RH qui l'a enregistré pour le collaborateur (P1 step 4b), ou null
  document_required: boolean // P2 step 4 : un justificatif (certificat médical...) est demandé
  has_document: boolean
  document_name: string
}

/** P2 step 4 : envoie le justificatif d'un congé (multipart). Renvoie '' si c'est bon, sinon le message de Django. */
export async function uploadDocument(leaveId: number, file: File): Promise<string> {
  const body = new FormData()
  body.append('document', file)
  try {
    const response = await apiFetch(`/api/leaves/documents/${leaveId}/`, { method: 'POST', body })
    if (response.ok) return ''
    const data = await response.json().catch(() => ({}))
    const first = data.detail ?? Object.values(data)[0]
    return Array.isArray(first) ? String(first[0]) : String(first ?? 'Could not send the document.')
  } catch {
    return 'Cannot reach the server. Please try again later.'
  }
}

// Un recalcul (backend leaves/recount.py) : un jour férié a changé, le congé a été recompté.
export type Recount = {
  old_days: number
  new_days: number
  reason: string             // ex. "Jour férié ajouté : Fête ajoutée (24/11/2026)"
  warning: string            // un point à vérifier par les RH (solde négatif...), ou ""
  changed_by: string | null
  created_at: string
}

// Page "Leave balances" (RH) : une ligne = qui + son solde (/api/leaves/balances/).
export type BalanceRow = Balance & {
  employee_id: number; employee: string; department: string; pole: string
  status: string; hire_date: string; yearly_right: number
}

// Un changement du droit annuel à partir d'une date (P1 step 2), ex. 30 jours à partir du 01/09/2026.
export type RightChange = { id: number; effective_from: string; annual_days: number; reason: string; changed_by: string | null; created_at: string }

// Une "tirelire" : les jours gagnés une année (+ les corrections RH en plus), ce qui en est utilisé
// (congés + corrections en moins) et jusqu'à quand ils se prennent.
export type YearPool = { year: number; earned: number; added: number; used: number; left: number; valid_until: string; state: 'VALID' | 'EXPIRING' | 'EXPIRED' }

// Une correction du solde par les RH (P1 step 3), ex. -10 jours au 31/12/2025 "Congés pris avant l'application".
export type Adjustment = { id: number; date: string; days: number; reason: string; created_by: string | null; created_at: string }

// Le panneau du clic (/api/leaves/balances/<employee>/) : la ligne + le détail.
export type BalanceDetail = BalanceRow & {
  base_right: number           // le droit de la fiche, depuis l'embauche
  right_changes: RightChange[]
  adjustments: Adjustment[]
  can_manage: boolean          // "Change" et "Add a correction" : RH du pôle / Admin RH, jamais pour soi-même (Django décide)
  years: YearPool[]
  leaves: Leave[]
}

// Un congé dans la page "Absences" des RH : le même congé, + qui et où.
export type Absence = Leave & { employee: string; employee_id: number; department: string; pole: string }

// Les chiffres d'une période (/api/leaves/absences/summary/) : les jours comptés sont ceux DANS la période.
export type AbsenceSummary = { people: number; absent_today: number; approved_days: number; pending_days: number }

/** Une date en "AAAA-MM-JJ", à l'heure LOCALE (toISOString donne l'heure UTC : après minuit, ce serait la veille). */
export function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** 2.5 -> "2.5 days", 1 -> "1 day", 0.5 -> "0.5 day" */
export function formatDays(days: number) {
  const value = Number.isInteger(days) ? String(days) : days.toFixed(2).replace(/0$/, '')
  return `${value} ${Math.abs(days) > 1 ? 'days' : 'day'}`
}

/** "2026-11-23" -> "Mon 23/11/2026" (lu comme une date locale : pas de décalage d'un jour avec le fuseau). */
export function formatDate(iso: string, withWeekday = false) {
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  const text = date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  return withWeekday ? `${date.toLocaleDateString('en-GB', { weekday: 'short' })} ${text}` : text
}
