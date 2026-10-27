'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from './api'
import type { Page } from './employees'

/**
 * Charge une page d'une liste paginée de l'API (ex. /api/employees/?page=2&search=alami).
 * Utilisé par le tableau RH et par l'annuaire.
 *
 *   const { data, loading, failed, retry } = usePaged<EmployeeRow>('/api/employees/', params)
 *
 * - data    : la dernière réponse reçue (gardée pendant le chargement suivant, pour ne pas vider l'écran)
 * - loading : une requête pour les paramètres actuels est en cours
 * - failed  : la requête pour les paramètres actuels a échoué -> afficher "Réessayer" (retry)
 */
export function usePaged<T>(path: string, params: URLSearchParams) {
  // La "clé" = les paramètres, ex. "page=2&search=alami". Une clé = une réponse.
  const key = params.toString()
  const [result, setResult] = useState<{ key: string; data: Page<T> } | null>(null)
  const [failedKey, setFailedKey] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)  // +1 sur "Réessayer" pour relancer la requête

  useEffect(() => {
    // AbortController : si les paramètres changent avant la réponse, on annule l'ancienne
    // requête (sinon une vieille réponse lente pourrait remplacer la nouvelle).
    const controller = new AbortController()
    apiFetch(`${path}?${key}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status))
        setResult({ key, data: await response.json() })
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailedKey(key)
      })
    return () => controller.abort()
  }, [path, key, attempt])

  // Next.js garde la page en vie (cachée) quand on la quitte : on oublie les données à ce
  // moment-là, pour qu'un autre utilisateur sur ce navigateur ne les voie jamais.
  useEffect(() => () => setResult(null), [])

  function retry() {
    setFailedKey(null)
    setAttempt((count) => count + 1)
  }

  return {
    data: result?.data,
    loading: result?.key !== key && failedKey !== key,
    failed: failedKey === key,
    retry,
  }
}
