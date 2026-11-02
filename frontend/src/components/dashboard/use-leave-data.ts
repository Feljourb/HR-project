'use client'

/*
 * Les VRAIES données de congés pour le tableau de bord (avant : des chiffres d'exemple dans data.ts) :
 * mon solde, mes congés et les jours fériés, lus UNE fois et partagés par les cases qui en ont besoin
 * ("Leave balance" et "Time off & holidays"). Les mêmes adresses que la page /leaves.
 */
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import type { Balance, Holiday, Leave } from '@/lib/leaves'

export type LeaveData = { balance: Balance; leaves: Leave[]; holidays: Holiday[] }

/**
 * null : pas encore de réponse (les cases restent grises) ;
 * 'none' : pas de congés à montrer (compte sans dossier RH, ex. l'IT ; ou serveur injoignable).
 */
export function useLeaveData(): LeaveData | 'none' | null {
  const [data, setData] = useState<LeaveData | 'none' | null>(null)

  useEffect(() => {
    Promise.all([apiFetch('/api/leaves/mine/balance/'), apiFetch('/api/leaves/mine/'), apiFetch('/api/leaves/holidays/')])
      .then(async ([balance, leaves, holidays]) => {
        if (!balance.ok || !leaves.ok || !holidays.ok) return setData('none')
        setData({ balance: await balance.json(), leaves: await leaves.json(), holidays: await holidays.json() })
      })
      .catch(() => setData('none'))
  }, [])

  return data
}
