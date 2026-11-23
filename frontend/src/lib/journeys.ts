// Arrivées et départs (backend app journeys, 2026-11-23) : les types du JSON, les mots affichés, les appels.
import { apiFetch } from '@/lib/api'

export type JourneyKind = 'ARRIVAL' | 'DEPARTURE'
export type Owner = 'HR' | 'MANAGER' | 'EMPLOYEE' | 'PERSON'

export type EmployeeCard = { id: number; name: string; u_number: string; position: string; department: string; direction: string }

export type Task = {
  id: number
  name: string
  owner: Owner
  person_name: string | null
  due_date: string            // "2026-11-28"
  offset_days: number
  detail_label: string        // l'information à noter, ex. "Numéro de série du PC" ("" = rien)
  detail: string
  comment: string
  done_at: string | null
  done_by_name: string | null
  late: boolean
  can_handle: boolean         // je peux la cocher (un manager voit tout le départ, mais coche seulement SES tâches)
}

// Une demande de départ (step 2) : qui part, pourquoi, quand, la lettre, qui l'a saisie.
export type Departure = {
  id: number
  request: number
  employee: EmployeeCard
  departure_type: string
  type_label: string          // "Démission"
  last_day: string
  comment: string
  has_letter: boolean
  letter_name: string
  informed: string[]          // les noms des personnes à prévenir
  status: 'IN_PROGRESS' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  requested_by_name: string
  created_at: string
  journey: number | null
}

// Ce que le formulaire "New departure" propose (departures/options/).
export type DepartureOptions = {
  types: { id: string; name: string }[]
  team: { id: number; first_name: string; last_name: string; position: string; department: string }[]
  is_hr: boolean
  can_request_own: boolean    // le collaborateur peut demander SON départ (réglage Admin RH, NON par défaut)
  me: number | null
}

export type MyTask = Task & { journey: { id: number; kind: JourneyKind; day: string; employee: EmployeeCard } }

export type Journey = {
  id: number
  kind: JourneyKind
  day: string
  employee: EmployeeCard
  tasks: Task[]
  status: 'open' | 'done' | 'cancelled'
  created_at: string
  created_by_name: string | null
  cancelled_at: string | null
  cancelled_by_name: string | null
  cancel_reason: string
  departure: Departure | null  // un départ : la demande d'où il vient
  can_cancel: boolean          // les RH du pôle seulement
}

export type TaskTemplate = {
  id: number
  kind: JourneyKind
  name: string
  owner: Owner
  person: number | null
  person_name: string | null
  offset_days: number
  detail_label: string
  is_active: boolean
}

export const KIND_LABEL: Record<JourneyKind, string> = { ARRIVAL: 'Arrival', DEPARTURE: 'Departure' }

export const OWNER_LABEL: Record<Owner, string> = {
  HR: 'HR', MANAGER: 'Manager (N+1)', EMPLOYEE: 'The employee', PERSON: 'A chosen person',
}

/** Qui fait la tâche, en clair : "HR", "Manager · Youssef Alami", "Karim Alami". */
export function whoLabel(task: Pick<Task, 'owner' | 'person_name'>) {
  if (task.owner === 'PERSON') return task.person_name ?? 'HR'
  if (task.owner === 'HR') return 'HR'
  return task.person_name ? `${task.owner === 'MANAGER' ? 'Manager' : 'Employee'} · ${task.person_name}` : OWNER_LABEL[task.owner]
}

/** "3 days before the first day", "On the last day", "30 days after the first day". */
export function whenLabel(offset: number, kind: JourneyKind) {
  const day = kind === 'ARRIVAL' ? 'the first day' : 'the last day'
  if (offset === 0) return `On ${day}`
  const n = Math.abs(offset)
  return `${n} day${n > 1 ? 's' : ''} ${offset < 0 ? 'before' : 'after'} ${day}`
}

/** "2026-11-28" -> "28/11/2026" */
export function frDate(day: string) {
  const [year, month, date] = day.split('-')
  return `${date}/${month}/${year}`
}

/** "in 8 days", "tomorrow", "today", "3 days ago" (par rapport à aujourd'hui). */
export function fromToday(day: string) {
  const [year, month, date] = day.split('-').map(Number)
  const target = new Date(year, month - 1, date)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  return days > 0 ? `in ${days} days` : `${-days} days ago`
}

/** La réponse d'erreur de Django -> une phrase ({"detail": "..."} ou {"champ": ["..."]}). */
export async function errorOf(response: Response) {
  const data = await response.json().catch(() => null)
  if (data && typeof data === 'object') {
    const first = Object.values(data as Record<string, unknown>)[0]
    if (typeof first === 'string') return first
    if (Array.isArray(first) && typeof first[0] === 'string') return first[0]
  }
  return 'Something went wrong. Try again.'
}

export function markDone(taskId: number, detail: string, comment: string) {
  return apiFetch(`/api/journeys/tasks/${taskId}/done/`, { method: 'POST', body: JSON.stringify({ detail, comment }) })
}

export function reopenTask(taskId: number) {
  return apiFetch(`/api/journeys/tasks/${taskId}/reopen/`, { method: 'POST' })
}
