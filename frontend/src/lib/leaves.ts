/*
 * Les congés, comme Django les envoie (/api/leaves/...).
 */

export type LeaveType = {
  id: number
  name: string
  deducts_balance: boolean   // true : pris sur le solde (congé annuel)
  max_days: number | null    // le maximum légal (ex. mariage : 4), null : pas de maximum
}

// acquired - taken - pending = available
export type Balance = { acquired: number; taken: number; pending: number; available: number }

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
}

// Un congé dans la page "Absences" des RH : le même congé, + qui et où.
export type Absence = Leave & { employee: string; employee_id: number; department: string; pole: string }

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
