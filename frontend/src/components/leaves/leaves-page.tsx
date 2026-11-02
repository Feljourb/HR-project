'use client'

/*
 * La page "Leave requests" (tous les rôles) : MON solde, le formulaire de demande (avec le calcul
 * en direct) et "My leaves". Tout vient de /api/leaves/mine/... : Django ne renvoie que mes congés.
 * La page garde la liste et le solde : quand on envoie ou annule un congé, elle met les deux à jour.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { apiFetch } from '@/lib/api'
import { formatDate, formatDays, type Balance, type Leave } from '@/lib/leaves'
import { LeaveForm } from './leave-form'
import { MyLeaves } from './my-leaves'
import { StatTiles } from './stat-tiles'

type Loaded = { leaves: Leave[]; balance: Balance }

export function LeavesPage() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [problem, setProblem] = useState('')  // '' : pas de problème
  // +1 après chaque envoi / annulation : la liste et le solde sont relus (le solde a changé).
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((old) => old + 1), [])

  useEffect(() => {
    Promise.all([apiFetch('/api/leaves/mine/'), apiFetch('/api/leaves/mine/balance/')])
      .then(async ([leaves, balance]) => {
        // 404 sur le solde : un compte sans dossier RH (ex. un compte IT) n'a pas de congés.
        if (balance.status === 404) return setProblem('No HR file is linked to this account: there is no leave to show.')
        if (!leaves.ok || !balance.ok) throw new Error()
        setLoaded({ leaves: await leaves.json(), balance: await balance.json() })
      })
      .catch(() => setProblem('Could not load your leaves. Please try again later.'))
  }, [version])

  return <div className="flex flex-col gap-4">
    <div>
      <h1 className="text-lg font-semibold text-[#192646]">Leave requests</h1>
      <p className="text-xs text-slate-500">Your balance, a new request and your leaves. A request follows its circuit (N+1, then HR).</p>
    </div>

    {loaded === null
      ? <Message>{problem || 'Loading...'}</Message>
      : <>
          <BalanceTiles balance={loaded.balance} />
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <LeaveForm onSent={reload} />
            <MyLeaves leaves={loaded.leaves} onCancelled={reload} />
          </div>
        </>}
  </div>
}

export function Message({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-slate-200 bg-white px-4 py-12 text-center text-sm text-slate-500">{children}</div>
}

// Les 4 chiffres du solde. "Available" en premier et en couleur : c'est celui qu'on cherche.
// Pas le total gagné depuis l'embauche (il compte aussi les jours perdus) : seulement ce qui sert.
function BalanceTiles({ balance }: { balance: Balance }) {
  const { expiring } = balance
  const tiles = [
    { label: 'Available', value: formatDays(balance.available), hint: 'Earned month after month, usable for 2 years', strong: true },
    { label: 'Taken', value: formatDays(balance.taken), hint: 'Approved annual leaves' },
    { label: 'Pending', value: formatDays(balance.pending), hint: 'Waiting for approval (reserved)' },
    // Les jours de l'an dernier qui seront perdus le 31/12 : pour penser à les prendre.
    { label: expiring ? `Lost on ${formatDate(expiring.on)}` : 'Lost at year end', value: formatDays(expiring?.days ?? 0),
      hint: expiring ? 'Take them first (they are used first)' : 'Nothing to lose this year' },
  ]
  // Pas d'image ici : le téléchargement est réservé aux RH (page Absences).
  return <StatTiles tiles={tiles} label="My leave balance" />
}
