'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import type { ReferenceItem } from '@/lib/employees'

/**
 * Les valeurs d'une liste de référence, pour une liste déroulante.
 *
 *   useList('contract-types')                    -> tous les types de contrat actifs
 *   useList('directions', 'entity', entityId)    -> CASCADE : les directions de cette entité
 *
 * En cascade, tant que le parent n'est pas choisi (entityId = ''), la liste est vide
 * et aucune requête n'est envoyée.
 */
export function useList(name: string, parentField?: string, parentValue?: string) {
  // La "clé" de la requête : '' (pas de filtre), 'entity=3' (filtre), ou null (parent pas choisi).
  const key = parentField ? (parentValue ? `${parentField}=${parentValue}` : null) : ''
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
  return key !== null && loaded?.key === key ? loaded.items : []
}
