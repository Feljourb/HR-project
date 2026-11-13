// Les 17 listes de référence gérées par l'Admin RH (voir LIST_VIEWSETS dans backend/employees/views.py,
// et les listes du module Congés dans backend/leaves/urls.py).
import type { ReferenceItem } from '@/lib/employees'

// Une valeur telle que l'API l'envoie (+ "code" pour les centres de coût,
// + le responsable pour les directions et les services, + les champs des listes du module Congés).
export type ListValue = ReferenceItem & {
  code?: string; head?: number | null; head_label?: string | null
  deducts_balance?: boolean; max_days?: string | null; max_days_back?: number; counting?: string; document_from_days?: number | null; date?: string; estimated?: boolean; fixed?: boolean
  ceiling?: string; receipt_required?: boolean
  template?: string  // types de document : "WORK" = généré par l'application, "" = préparé par les RH
  delivery_days?: number  // types de document : le délai promis, en jours ouvrés
}

// Un champ en plus du nom (listes des modules Congés, Notes de frais, Documents) : affiché en colonne, modifiable avec le nom.
export type ExtraField = {
  name: 'deducts_balance' | 'max_days' | 'max_days_back' | 'counting' | 'document_from_days' | 'date' | 'estimated' | 'ceiling' | 'receipt_required'
    | 'template' | 'delivery_days'
  label: string
  type: 'checkbox' | 'number' | 'date' | 'select'
  required?: boolean
  // Un nombre : par défaut des demi-journées à partir de 0,5 (ex. le maximum légal) ; sinon on le dit ici.
  min?: number
  step?: number
  placeholder?: string
  options?: { id: string; name: string }[]  // pour type "select"
}

// L'adresse des listes de l'app employees. Les listes d'un autre module ont la leur (`api`).
export const LISTS_API = '/api/employees/lists'

export type ListConfig = {
  name: string          // l'adresse dans l'API : <api>/<name>/
  api?: string          // par défaut LISTS_API
  title: string         // le nom de la liste, ex. "Services"
  singular: string      // pour le cadre "Ajouter : Service"
  parentField?: string  // organisation : le champ du parent, ex. "direction" pour un service
  withCode?: boolean    // centres de coût : un code en plus du nom
  // Directions et services : un responsable (le N+1 de l'équipe), cherché parmi les gens qui y travaillent
  // (headFilter = le filtre de la recherche des collaborateurs, ex. ?department=4).
  headFilter?: 'direction' | 'department'
  extra?: ExtraField[]  // des champs en plus du nom
  byDate?: boolean      // trier par date (jours fériés), pas par nom
  panel?: 'holidays' | 'settings' | 'signatures'  // une page à part (jours fériés ; réglages des congés ; signatures)
}

// Les listes du module Congés (adresse /api/leaves/lists/...).
export const LEAVE_LISTS: ListConfig[] = [
  { name: 'leave-types', api: '/api/leaves/lists', title: 'Types de congé', singular: 'Type de congé', extra: [
    { name: 'deducts_balance', label: 'Taken from the balance', type: 'checkbox' },
    { name: 'max_days', label: 'Legal maximum (days)', type: 'number' },
    // P1 step 4 : jusqu'où dans le passé le collaborateur peut commencer ce congé (0 = seulement à partir d'aujourd'hui).
    { name: 'max_days_back', label: 'Days in the past allowed', type: 'number', required: true, min: 0, step: 1, placeholder: '0' },
    // P2 step 3 : jours ouvrables (le cas normal) ou calendaires (chaque jour compte, ex. maternité 98 jours).
    { name: 'counting', label: 'Counting', type: 'select', required: true, options: [
      { id: 'WORKING', name: 'Working days' },
      { id: 'CALENDAR', name: 'Calendar days' },
    ] },
    // P2 step 4 : un justificatif (certificat...) demandé à partir de N jours ; vide = jamais (maladie, maternité : 1).
    { name: 'document_from_days', label: 'Document from (days)', type: 'number', min: 1, step: 1, placeholder: 'Never' },
  ] },
  // Créés tout seuls chaque année (backend leaves/holidays.py) ; chaque année garde SES lignes (jamais remplacées).
  // Page à part (holidays-panel.tsx) : une année à la fois, onglets "fixes" / "variables" (décision du 2026-11-03).
  { name: 'public-holidays', api: '/api/leaves/lists', title: 'Jours fériés', singular: 'Jour férié', byDate: true, panel: 'holidays', extra: [
    { name: 'date', label: 'Date', type: 'date', required: true },
    { name: 'estimated', label: 'Estimated (to confirm)', type: 'checkbox' },
  ] },
  // Les règles du solde (2 ans, max 36, ancienneté, 6 mois) : Admin RH, avec avertissement et historique.
  { name: 'leave-settings', title: 'Réglages des congés', singular: 'Réglage', panel: 'settings' },
]

// La liste du module Notes de frais (adresse /api/expenses/lists/...). Le barème par grade : page Expense claims.
export const EXPENSE_LISTS: ListConfig[] = [
  { name: 'categories', api: '/api/expenses/lists', title: 'Catégories de dépense', singular: 'Catégorie de dépense', extra: [
    { name: 'ceiling', label: 'Ceiling of the scale', type: 'select', required: true, options: [
      { id: 'NONE', name: 'No ceiling' },
      { id: 'DAILY_ALLOWANCE', name: 'Allowance (per day)' },
      { id: 'TRANSPORT', name: 'Transport (per trip)' },
      { id: 'HOTEL', name: 'Hotel (per night)' },
    ] },
    { name: 'receipt_required', label: 'Receipt required', type: 'checkbox' },
  ] },
]

// La liste du module Documents administratifs (adresse /api/documents/lists/...) : les documents qu'on peut demander.
// "Generated by the app" seulement pour un modèle écrit dans le code (documents/pdf.py) ; sinon les RH le préparent.
export const DOCUMENT_LISTS: ListConfig[] = [
  { name: 'types', api: '/api/documents/lists', title: 'Types de document', singular: 'Type de document', extra: [
    { name: 'template', label: 'Prepared by', type: 'select', options: [
      { id: '', name: 'HR (upload the signed PDF)' },
      { id: 'WORK', name: 'The app: work certificate' },
    ] },
    // Le délai promis au collaborateur ("expected by ..."), en jours ouvrés ; 0 = tout de suite (document généré).
    { name: 'delivery_days', label: 'Delay (working days)', type: 'number', required: true, min: 0, step: 1, placeholder: '2' },
  ] },
  // Qui signe les documents générés, et comment (à la main, ou signature + cachet posés par l'application) : par pôle.
  { name: 'signatories', title: 'Signatures', singular: 'Signature', panel: 'signatures' },
]

/** La valeur d'un champ en plus, en texte pour un <input> ("true" / "false" pour une case). */
export function extraValue(item: ListValue | null, field: ExtraField): string {
  const value = item?.[field.name]
  if (field.type === 'checkbox') return value ? 'true' : 'false'
  // Une nouvelle valeur : la première option (ex. "No ceiling").
  if (field.type === 'select' && (value === undefined || value === null)) return field.options?.[0]?.id ?? ''
  return value === null || value === undefined ? '' : String(value)
}

/** Le texte d'un <input> -> ce que Django attend (une case : true / false ; un nombre vide : null). */
export function extraToJson(field: ExtraField, text: string): boolean | string | null {
  if (field.type === 'checkbox') return text === 'true'
  if (field.type === 'number') return text.trim() === '' ? null : text.trim()
  return text
}

// L'organisation, du haut vers le bas : chaque niveau dépend de celui au-dessus.
export const ORGANISATION: ListConfig[] = [
  { name: 'poles', title: 'Pôles', singular: 'Pôle' },
  { name: 'entities', title: 'Entités', singular: 'Entité', parentField: 'pole' },
  { name: 'directions', title: 'Directions', singular: 'Direction', parentField: 'entity', headFilter: 'direction' },
  { name: 'departments', title: 'Services', singular: 'Service', parentField: 'direction', headFilter: 'department' },
  { name: 'positions', title: 'Postes', singular: 'Poste', parentField: 'department' },
]

// Les listes simples : les mêmes pour tout le monde, sans parent.
export const OTHER_LISTS: ListConfig[] = [
  { name: 'contract-types', title: 'Types de contrat', singular: 'Type de contrat' },
  { name: 'temp-agencies', title: "Agences d'intérim", singular: "Agence d'intérim" },
  { name: 'categories', title: 'Catégories', singular: 'Catégorie' },
  { name: 'grades', title: 'Grades', singular: 'Grade' },
  { name: 'divisions', title: 'Divisions', singular: 'Division' },
  { name: 'assignments', title: 'Affectations', singular: 'Affectation' },
  { name: 'regions', title: 'Régions', singular: 'Région' },
  { name: 'cost-centers', title: 'Centres de coût', singular: 'Centre de coût', withCode: true },
  { name: 'banks', title: 'Banques', singular: 'Banque' },
  { name: 'cities', title: 'Villes', singular: 'Ville' },
]

/**
 * Les niveaux à choisir AVANT de voir une liste de l'organisation, ex. pour les postes :
 * Entité -> Direction -> Service ("Ventes" existe dans plusieurs entités).
 * Les entités se choisissent par pôle ; les niveaux plus bas partent de l'entité (comme le formulaire).
 */
export function filtersOf(list: ListConfig): ListConfig[] {
  const index = ORGANISATION.findIndex((level) => level.name === list.name)
  if (index <= 0) return []  // une liste simple, ou les pôles
  return ORGANISATION.slice(index === 1 ? 0 : 1, index)
}
