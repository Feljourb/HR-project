/*
 * Les demandes et leur circuit, comme Django les envoie
 * (/api/workflows/requests/ et /api/workflows/approvals/).
 * "WorkflowRequest" et pas "Request" : Request existe déjà dans le navigateur (fetch).
 */

export type RequestStep = {
  order: number
  approver: string
  approver_label: string     // "N+1", "RH du pôle"...
  mode: string               // VALIDATE ou INFORM
  mode_label: string
  status: string             // WAITING, PENDING, APPROVED, REJECTED, INFORMED, SKIPPED
  status_label: string
  validator: string          // qui doit répondre : un nom, ou "RH du pôle"
  decided_by: string | null  // le compte qui a répondu
  decided_at: string | null
  comment: string
}

export type WorkflowRequest = {
  id: number
  workflow: string           // "Congé"
  workflow_code: string
  title: string
  requester: string
  status: string             // IN_PROGRESS, APPROVED, REJECTED, CANCELLED
  status_label: string
  created_at: string
  closed_at: string | null
  steps: RequestStep[]
}

// Une étape qui attend MA réponse. L'id est celui de l'ÉTAPE (c'est elle qu'on valide).
export type Approval = {
  id: number
  approver: string
  approver_label: string
  request: WorkflowRequest
}
