/*
 * Les circuits de validation et les DG, comme Django les envoie (/api/workflows/...).
 */

// Une étape telle que Django la renvoie : {"order": 1, "approver": "MANAGER", "approver_label": "N+1", ...}.
export type WorkflowStep = {
  order: number
  approver: string
  approver_label: string
  mode: string
  mode_label: string
}

export type Workflow = {
  id: number
  code: string            // LEAVE, EXPENSE, ADMIN_REQUEST : ne change jamais
  name: string
  is_active: boolean
  steps: WorkflowStep[]
}

// Une étape en cours de modification dans la page : seulement ce qu'on envoie à Django
// (l'ordre = la place dans la liste, Django le calcule).
export type StepDraft = { approver: string; mode: string }

export type Director = { id: number; name: string; email: string; is_active: boolean }

export type PoleDirector = { id: number; name: string; director: number | null }

// Les valideurs et les modes possibles (les mêmes que WorkflowStep.Approver / Mode côté Django).
export const APPROVERS = [
  { id: 'MANAGER', name: 'N+1' },
  { id: 'MANAGER_2', name: 'N+2' },
  { id: 'HR', name: 'RH du pôle' },
  { id: 'DG', name: 'DG du pôle' },
]

export const MODES = [
  { id: 'VALIDATE', name: 'Valider' },
  { id: 'INFORM', name: 'Informer' },
]

/**
 * Le premier message d'erreur de Django, même caché à l'intérieur :
 * {"steps": ["Ce valideur est déjà dans le circuit."]} ou {"steps": [{"mode": ["..."]}]}.
 * Renvoie "" s'il n'y en a pas.
 */
export function firstMessage(data: unknown): string {
  if (typeof data === 'string') return data
  const values = Array.isArray(data) ? data : data && typeof data === 'object' ? Object.values(data) : []
  for (const value of values) {
    const message = firstMessage(value)
    if (message) return message
  }
  return ''
}

/** Envoie une modification à Django et renvoie la réponse, ou le message d'erreur à afficher.
 *  `forbidden` : le message si Django répond 403 (pas le droit). */
export async function sendChange<T>(send: () => Promise<Response>, forbidden = 'Only Admin RH can change the workflows.'): Promise<{ data: T } | { error: string }> {
  try {
    const response = await send()
    if (response.ok) return { data: await response.json() }
    if (response.status === 403) return { error: forbidden }
    // 400 : une règle refusée ("Ce valideur est déjà dans le circuit.", "Cet e-mail existe déjà."...).
    return { error: firstMessage(await response.json().catch(() => ({}))) || 'Something went wrong. Please try again.' }
  } catch {
    return { error: 'Cannot reach the server. Please try again later.' }
  }
}
