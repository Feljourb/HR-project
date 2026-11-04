/*
 * Les congés, comme Django les envoie (/api/leaves/...).
 */

export type LeaveType = {
  id: number
  name: string
  deducts_balance: boolean   // true : pris sur le solde (congé annuel)
  max_days: number | null    // le maximum légal (ex. mariage : 4), null : pas de maximum
}

// Un jour férié (/api/leaves/holidays/). estimated : fête religieuse calculée, la date peut bouger d'un jour.
export type Holiday = { id: number; date: string; name: string; estimated: boolean }

// acquired = taken + pending + expired + available (les jours se prennent pendant 2 ans, puis ils sont perdus).
// expiring : les jours qui seront perdus à la fin de cette année s'ils ne sont pas pris (null : aucun).
export type Balance = {
  acquired: number; taken: number; pending: number; expired: number; available: number
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
