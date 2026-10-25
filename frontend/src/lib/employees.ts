// La forme des données envoyées par l'API des collaborateurs (backend/employees/serializers.py).

// Une valeur d'une liste de référence (/api/employees/lists/<liste>/).
export type ReferenceItem = {
  id: number;
  name: string;
  is_active: boolean;
};

// Une ligne du tableau (EmployeeListSerializer) : des noms lisibles, pas des numéros.
export type EmployeeRow = {
  id: number;
  u_number: string;
  last_name: string;
  first_name: string;
  position: string;
  department: string;
  direction: string;
  entity: string;
  contract_type: string;
  status: Status;
  status_label: string;
};

// Une réponse découpée en pages (EmployeePagination) : 25 lignes par page.
export type Page<T> = {
  count: number;          // le total, toutes pages confondues
  next: string | null;    // adresse de la page suivante, ou null
  previous: string | null;
  results: T[];
};

export const PAGE_SIZE = 25;

// Le dossier complet (EmployeeSerializer) : les listes sont des numéros (id).
export type EmployeeFiche = {
  id: number;
  u_number: string;
  username: string;
  direction: number;      // calculés par Django à partir du service (lecture seule)
  entity: number;
  pole: number;
  manager_label: string | null;
} & Record<FormField, string | number | null>;

// Les champs que le formulaire envoie à l'API (les noms des champs du modèle Employee).
export const FORM_FIELDS = [
  "title", "last_name", "first_name", "birth_date", "cin", "marital_status",
  "phone", "professional_email", "address", "city", "country",
  "department", "position",
  "contract_type", "temp_agency", "category", "grade", "division",
  "assignment", "region", "work_location", "cost_center", "manager",
  "hire_date", "trial_end_date", "onboarding_end_date", "departure_date",
  "status", "initial_leave_balance",
] as const;

export type FormField = (typeof FORM_FIELDS)[number];

// Les choix fixes du modèle (Employee.Title, Employee.MaritalStatus).
export const TITLE_LABELS: Record<string, string> = { M: "M.", MME: "Mme" };
export const MARITAL_LABELS: Record<string, string> = {
  SINGLE: "Célibataire",
  MARRIED: "Marié(e)",
  DIVORCED: "Divorcé(e)",
  WIDOWED: "Veuf(ve)",
};

// Les statuts : la clé envoyée à l'API -> le libellé affiché (comme Employee.Status côté Django).
export type Status = "ACTIVE" | "TRIAL" | "LEFT";

export const STATUS_LABELS: Record<Status, string> = {
  ACTIVE: "Actif",
  TRIAL: "Période d'essai",
  LEFT: "Sorti",
};
