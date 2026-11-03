'use client'

/*
 * MES vraies notes de frais pour le tableau de bord (avant : des exemples dans data.ts), lues UNE fois et
 * partagées par les cases qui en ont besoin ("Expenses in approval" et "Requests & approvals").
 */
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import type { ExpenseClaim } from '@/lib/expenses'

/** null : pas encore de réponse ; [] : aucune note (ou compte sans dossier RH). */
export function useExpenseClaims(): ExpenseClaim[] | null {
  const [claims, setClaims] = useState<ExpenseClaim[] | null>(null)

  useEffect(() => {
    apiFetch('/api/expenses/mine/')
      .then(async (response) => setClaims(response.ok ? await response.json() : []))
      .catch(() => setClaims([]))
  }, [])

  return claims
}
