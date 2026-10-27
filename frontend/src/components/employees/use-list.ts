'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import type { ReferenceItem } from '@/lib/employees'

type ListOptions = {
  // Cascade : le parent choisi, ex. { field: 'entity', value: '3' } -> les directions de l'entité 3.
  parent?: { field: string; value?: string }
  // La valeur actuelle du dossier qu'on modifie : gardée dans la liste même si elle a été désactivée.
  include?: string
}

/**
 * Les valeurs d'une liste de référence, pour une liste déroulante.
 *
 *   useList('contract-types')                                         -> tous les types de contrat actifs
 *   useList('directions', { parent: { field: 'entity', value: '3' } }) -> CASCADE : les directions de l'entité 3
 *   useList('banks', { include: '7' })                                 -> les banques actives + la banque 7
 *
 * En cascade, tant que le parent n'est pas choisi (value = ''), la liste est vide
 * et aucune requête n'est envoyée.
 *
 * Renvoie { items, add } : `add` ajoute une valeur créée avec "+ Ajouter" (sans recharger).
 */
export function useList(name: string, { parent, include }: ListOptions = {}) {
  // La "clé" de la requête, ex. 'entity=3&include=12', '' (pas de filtre), ou null (parent pas choisi).
  const query = new URLSearchParams()
  if (parent?.value) query.set(parent.field, parent.value)
  if (include) query.set('include', include)
  const key = parent && !parent.value ? null : query.toString()
  const [loaded, setLoaded] = useState<{ key: string; items: ReferenceItem[] } | null>(null)

  useEffect(() => {
    if (key === null) return
    // Si le parent change avant la réponse, on annule l'ancienne requête.
    const controller = new AbortController()
    apiFetch(`/api/employees/lists/${name}/${key ? `?${key}` : ''}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : []))
      .then((items: ReferenceItem[]) => setLoaded({ key, items }))
      .catch(() => {})  // requête annulée : rien à faire
    return () => controller.abort()
  }, [name, key])

  // On ne renvoie que la réponse qui correspond au parent actuel (jamais celle d'un ancien parent).
  const items = key !== null && loaded?.key === key ? loaded.items : []

  // Ajoute la valeur que l'Admin RH vient de créer, à sa place dans l'ordre alphabétique.
  function add(item: ReferenceItem) {
    if (key === null) return
    setLoaded({ key, items: [...items, item].sort((a, b) => a.name.localeCompare(b.name, 'fr')) })
  }

  return { items, add }
}
