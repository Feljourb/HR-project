'use client'

/*
 * La page "Leave requests" (tous les rôles) : MON solde, le formulaire de demande (avec le calcul
 * en direct) et "My leaves". Tout vient de /api/leaves/mine/... : Django ne renvoie que mes congés.
 * La page garde la liste et le solde : quand on envoie ou annule un congé, elle met les deux à jour.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { apiFetch } from '@/lib/api'
import { formatDate, formatDays, type Adjustment, type Balance, type Leave, type RightChange } from '@/lib/leaves'
import { LeaveForm } from './leave-form'
import { MyLeaves } from './my-leaves'
import { StatTiles } from './stat-tiles'

// Ce que les RH ont changé dans MON solde (corrections, droit annuel), avec le motif.
type Changes = { adjustments: Adjustment[]; right_changes: RightChange[] }
type Loaded = { leaves: Leave[]; balance: Balance; changes: Changes }

export function LeavesPage() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [problem, setProblem] = useState('')  // '' : pas de problème
  // +1 après chaque envoi / annulation : la liste et le solde sont relus (le solde a changé).
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((old) => old + 1), [])

  useEffect(() => {
    Promise.all([apiFetch('/api/leaves/mine/'), apiFetch('/api/leaves/mine/balance/'), apiFetch('/api/leaves/mine/balance-changes/')])
      .then(async ([leaves, balance, changes]) => {
        // 404 sur le solde : un compte sans dossier RH (ex. un compte IT) n'a pas de congés.
        if (balance.status === 404) return setProblem('No HR file is linked to this account: there is no leave to show.')
        if (!leaves.ok || !balance.ok || !changes.ok) throw new Error()
        setLoaded({ leaves: await leaves.json(), balance: await balance.json(), changes: await changes.json() })
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
          <BalanceChanges changes={loaded.changes} />
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

/**
 * "Balance changes" : ce que les RH ont changé dans MON solde, et pourquoi (le collaborateur reçoit aussi une 🔔).
 * Ex. "-2,5 days · 31/12/2025 · Leaves 2025 (Excel)" ; "Annual right: 30 days / year from 01/09/2026 · Promotion".
 * Rien à montrer : la section n'apparaît pas.
 */
function BalanceChanges({ changes }: { changes: Changes }) {
  const rows = [
    ...changes.adjustments.map((item) => ({
      key: `a-${item.id}`, at: item.created_at, by: item.created_by, reason: item.reason,
      what: <><b className={item.days > 0 ? 'text-emerald-700' : 'text-red-600'}>{item.days > 0 ? '+' : ''}{formatDays(item.days)}</b> · dated {formatDate(item.date)}</>,
    })),
    ...changes.right_changes.map((item) => ({
      key: `r-${item.id}`, at: item.created_at, by: item.changed_by, reason: item.reason,
      what: <>Annual right: <b className="text-[#192646]">{formatDays(item.annual_days)} / year</b> from {formatDate(item.effective_from)}</>,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at))  // le plus récent d'abord
  if (rows.length === 0) return null

  return <section className="rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <header className="border-b border-slate-100 px-4 py-3">
      <h2 className="text-sm font-semibold text-[#192646]">Balance changes</h2>
      <p className="text-[11px] text-slate-500">Changes made by HR to your balance, with the reason. They are already counted in the numbers above.</p>
    </header>
    <ul className="divide-y divide-slate-100 text-xs">
      {rows.map((row) => <li key={row.key} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-4 py-2.5">
        <span className="text-slate-700">{row.what}</span>
        <span className="text-slate-500">· {row.reason}</span>
        <span className="ml-auto text-[11px] text-slate-400">{row.by ? `by ${row.by} · ` : ''}{formatDate(row.at.slice(0, 10))}</span>
      </li>)}
    </ul>
  </section>
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
