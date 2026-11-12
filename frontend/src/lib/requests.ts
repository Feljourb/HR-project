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
  decided_by_name: string | null  // son nom ("Manager Test"), pour l'historique
  decided_at: string | null
  comment: string
  on_behalf_of: string | null  // P2 : l'absent pour qui quelqu'un a répondu, ou null
  stand_in: string | null      // étape en attente : le délégué du valideur en ce moment ("Stand-in: Collab Test"), ou null
}

// P2 step 1 : une délégation ("absent du bureau"). direction : GIVEN = je suis l'absent ; RECEIVED = je remplace.
export type Delegation = {
  id: number
  delegator: number
  delegator_label: string
  delegate: number
  delegate_label: string
  start_date: string
  end_date: string
  created_by: string | null
  ended_at: string | null
  state: 'ACTIVE' | 'PLANNED' | 'ENDED'
  direction: 'GIVEN' | 'RECEIVED' | 'OTHER'
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
  cancelled_by: string | null  // le compte qui a annulé (le demandeur, ou un RH pour une demande acceptée)
  cancelled_by_name: string | null  // son nom, pour l'historique
  cancel_reason: string        // le motif (obligatoire pour annuler une demande déjà acceptée)
  steps: RequestStep[]
}

// Une étape qui attend MA réponse. L'id est celui de l'ÉTAPE (c'est elle qu'on valide).
export type Approval = {
  id: number
  approver: string
  approver_label: string
  request: WorkflowRequest
  on_behalf_of: string | null  // P2 : je réponds à la place de cette personne (absente), ou null
}

/** Une étape terminée (onglets "History" de Team approvals, Stand-in requests, My requests -> Received).
 *  status PENDING : la demande a été annulée pendant qu'elle m'attendait (pas de réponse à donner). */
export type DecidedStep = {
  id: number
  request: WorkflowRequest
  status: 'APPROVED' | 'REJECTED' | 'PENDING'
  decided_at: string | null
  comment: string
  decided_by_name: string | null
  on_behalf_of: string | null  // répondue à la place de cette personne (absente), ou null
  by_me: boolean               // "by you", ou "by Elj Fz on your behalf"
}
