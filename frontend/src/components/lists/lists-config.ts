// Les 17 listes de référence gérées par l'Admin RH (voir LIST_VIEWSETS dans backend/employees/views.py,
// et les listes du module Congés dans backend/leaves/urls.py).
import type { ReferenceItem } from '@/lib/employees'

// Une valeur telle que l'API l'envoie (+ "code" pour les centres de coût,
// + le responsable pour les directions et les services, + les champs des listes du module Congés).
export type ListValue = ReferenceItem & {
  code?: string; head?: number | null; head_label?: string | null
  deducts_balance?: boolean; max_days?: string | null; max_days_back?: number; counting?: string; document_from_days?: number | null; date?: string; estimated?: boolean; fixed?: boolean
  ceiling?: string; receipt_required?: boolean; above_ceiling_allowed?: boolean
  rate_to_mad?: string; automatic?: boolean  // devises : le taux (1 unité = ... MAD), mis à jour tout seul ou à la main
  template?: string  // types de document : "WORK" = généré par l'application, "" = préparé par les RH
  delivery_days?: number  // types de document : le délai promis, en jours ouvrés
  manager_can_request?: boolean  // types de document : le manager peut le demander pour son équipe
  hr_review?: boolean            // types de document : les RH relisent le texte généré avant l'envoi
}

// Un champ en plus du nom (listes des modules Congés, Notes de frais, Documents) : affiché en colonne, modifiable avec le nom.
export type ExtraField = {
  name: 'deducts_balance' | 'max_days' | 'max_days_back' | 'counting' | 'document_from_days' | 'date' | 'estimated' | 'ceiling' | 'receipt_required'
    | 'template' | 'delivery_days' | 'manager_can_request' | 'hr_review' | 'above_ceiling_allowed' | 'rate_to_mad' | 'automatic'
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
  fixed?: boolean       // pas de "Add a value" ni de "Deactivate" (les pôles) : seulement renommer
  panel?: 'holidays' | 'leave-settings' | 'signatures' | 'expense-settings' | 'document-settings' | 'journey-settings'  // une page à part
}

// Les listes du module Congés (adresse /api/leaves/lists/...). Depuis le 2026-11-19, TOUTES dans UNE page
// "Réglages des congés" (leave-settings-all.tsx : types, jours fériés, règles du solde) : une seule place.
export const LEAVE_TYPES_LIST: ListConfig =
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
  ] }
// Créés tout seuls chaque année (backend leaves/holidays.py) ; chaque année garde SES lignes (jamais remplacées).
// holidays-panel.tsx : une année à la fois, onglets "fixes" / "variables" (décision du 2026-11-03).
export const HOLIDAYS_LIST: ListConfig =
  { name: 'public-holidays', api: '/api/leaves/lists', title: 'Jours fériés', singular: 'Jour férié', byDate: true, panel: 'holidays', extra: [
    { name: 'date', label: 'Date', type: 'date', required: true },
    { name: 'estimated', label: 'Estimated (to confirm)', type: 'checkbox' },
  ] }
export const LEAVE_LISTS: ListConfig[] = [
  { name: 'leave-settings', title: 'Réglages des congés', singular: 'Réglage', panel: 'leave-settings' },
]

// Le module Notes de frais : TOUS ses réglages dans UNE page (2026-11-18, expense-settings-all.tsx) : le barème par
// grade, les catégories, les devises, qui peut corriger un montant (avant : 4 endroits).
export const EXPENSE_LISTS: ListConfig[] = [
  { name: 'expense-settings', title: 'Réglages des notes de frais', singular: 'Réglage', panel: 'expense-settings' },
]

// La liste du module Documents administratifs (adresse /api/documents/lists/...) : les documents qu'on peut demander.
// "Generated by the app" seulement pour un modèle écrit dans le code (documents/pdf.py) ; sinon les RH le préparent.
// 2026-11-19 : les types sont un ONGLET de Réglages des documents (une seule place), plus une entrée à part.
export const DOCUMENT_TYPES_LIST: ListConfig =
  { name: 'types', api: '/api/documents/lists', title: 'Types de document', singular: 'Type de document', extra: [
    // (Comment il est fait -- préparé par les RH ou généré à partir d'un texte -- et "les RH relisent" : une seule
    // place depuis le 2026-11-17, Réglages des documents -> "How each document is made" -> Set up.)
    // Le délai promis au collaborateur ("expected by ..."), en jours ouvrés ; 0 = tout de suite (document généré).
    { name: 'delivery_days', label: 'Delay (working days)', type: 'number', required: true, min: 0, step: 1, placeholder: '2' },
    // ("Managers can request" : dans Réglages des documents -> 4. Managers, avec le choix des managers : une seule place.)
  ] }
export const DOCUMENT_LISTS: ListConfig[] = [
  // Tous les réglages des documents, en 4 questions dans UNE page (2026-11-17) : ce que le collaborateur demande,
  // comment le PDF est fait (les signatures, par pôle : automatique ou par les RH), les modèles, les managers.
  { name: 'document-settings', title: 'Réglages des documents', singular: 'Réglage', panel: 'document-settings' },
]

// Arrivées et départs (2026-11-23) : le modèle des tâches, dans UNE page (journey-settings.tsx, 2 onglets).
export const JOURNEY_LISTS: ListConfig[] = [
  { name: 'journey-settings', title: 'Réglages des arrivées et départs', singular: 'Réglage', panel: 'journey-settings' },
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
  // fixed : les 2 pôles (SBD, Riaya) ne se désactivent pas (2026-11-20) ; ils se renomment seulement.
  { name: 'poles', title: 'Pôles', singular: 'Pôle', fixed: true },
  { name: 'entities', title: 'Entités', singular: 'Entité', parentField: 'pole' },
  // B7 (2026-11-20) : une direction des DEUX pôles (ex. l'Informatique) = choisir l'entité "Les deux pôles" au-dessus.
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
