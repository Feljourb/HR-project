// Les 14 listes de référence gérées par l'Admin RH (voir LIST_VIEWSETS dans backend/employees/views.py).
import type { ReferenceItem } from '@/lib/employees'

// Une valeur telle que l'API l'envoie (+ "code" pour les centres de coût).
export type ListValue = ReferenceItem & { code?: string }

export type ListConfig = {
  name: string          // l'adresse dans l'API : /api/employees/lists/<name>/
  title: string         // le nom de la liste, ex. "Services"
  singular: string      // pour le cadre "Ajouter : Service"
  parentField?: string  // organisation : le champ du parent, ex. "direction" pour un service
  withCode?: boolean    // centres de coût : un code en plus du nom
}

// L'organisation, du haut vers le bas : chaque niveau dépend de celui au-dessus.
export const ORGANISATION: ListConfig[] = [
  { name: 'poles', title: 'Pôles', singular: 'Pôle' },
  { name: 'entities', title: 'Entités', singular: 'Entité', parentField: 'pole' },
  { name: 'directions', title: 'Directions', singular: 'Direction', parentField: 'entity' },
  { name: 'departments', title: 'Services', singular: 'Service', parentField: 'direction' },
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
