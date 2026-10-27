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

// Une personne dans l'annuaire (DirectorySerializer) : seulement les champs publics.
export type DirectoryPerson = {
  id: number;
  last_name: string;
  first_name: string;
  position: string;
  department: string;
  direction: string;
  professional_email: string;
  phone: string;
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
  can_reset_password: boolean;  // Django dit si ce RH peut réinitialiser le mot de passe de ce compte
  children: Child[];
  number_of_children: number;   // calculé par Django à partir de la liste
} & Record<FormField, string | number | null>;

// Un enfant (allocations familiales). id absent pour un enfant pas encore enregistré.
export type Child = {
  id?: number;
  first_name: string;
  birth_date: string;
};

// Ce que le collaborateur modifie lui-même dans "Mon profil" (comme PERSONAL_FIELDS côté Django).
export const PERSONAL_FIELDS = [
  "phone", "address", "city", "country",
  "emergency_contact_name", "emergency_contact_relationship", "emergency_contact_phone",
] as const;

export type PersonalField = (typeof PERSONAL_FIELDS)[number];

// MON dossier (/api/employees/me/, MyFicheSerializer) : les listes liées arrivent en TEXTE.
export type MyFiche = {
  u_number: string;
  username: string;
  title: string;
  last_name: string;
  first_name: string;
  birth_date: string;
  cin: string;
  professional_email: string;
  marital_status: string;
  cnss_number: string;
  cimr_number: string;
  bank: string | null;
  rib: string;
  entity: string;
  direction: string;
  department: string;
  position: string;
  contract_type: string;
  category: string;
  grade: string | null;
  region: string;
  work_location: string;
  manager: string | null;
  hire_date: string;
  status: Status;
  children: Child[];
} & Record<PersonalField, string>;

// Les champs que le formulaire envoie à l'API (les noms des champs du modèle Employee).
export const FORM_FIELDS = [
  "title", "last_name", "first_name", "birth_date", "cin", "marital_status",
  "phone", "professional_email", "address", "city", "country",
  "cnss_number", "cimr_number", "bank", "rib",
  "emergency_contact_name", "emergency_contact_relationship", "emergency_contact_phone",
  "department", "position",
  "contract_type", "temp_agency", "category", "grade", "division",
  "assignment", "region", "work_location", "cost_center", "manager",
  "hire_date", "trial_end_date", "onboarding_end_date", "departure_date",
  "status", "initial_leave_balance",
] as const;

export type FormField = (typeof FORM_FIELDS)[number];

// Les choix fixes du modèle (Employee.Title, Employee.MaritalStatus).
export const TITLE_LABELS: Record<string, string> = { M: "M.", MME: "Mme" };
export const RELATIONSHIP_LABELS: Record<string, string> = {
  SPOUSE: "Conjoint(e)",
  FATHER: "Père",
  MOTHER: "Mère",
  SIBLING: "Frère / Sœur",
  CHILD: "Enfant",
  OTHER: "Autre",
};
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
