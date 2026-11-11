'use client'

/*
 * La page "Expense claims" (tous les rôles) : mes chiffres, une nouvelle note, mes notes, et le barème.
 * Tout vient de /api/expenses/... : Django ne renvoie que MES notes.
 * "My claims" (2026-11-11) : le style de "My leaves" (filtres en pastilles, les 5 dernières puis "Show all").
 * Un clic sur une note l'ouvre dans un panneau à droite, sans quitter la page (la page /expenses/<n°>
 * reste pour les liens de la cloche et de Team approvals).
 */
import { useCallback, useEffect, useState } from 'react'
import { ReceiptText } from 'lucide-react'
import { apiFetch, seesBothPoles, type Me } from '@/lib/api'
import { claimStatus, formatMad, type ExpenseCategory, type ExpenseClaim, type Scale } from '@/lib/expenses'
import { formatDate } from '@/lib/leaves'
import { cn } from '@/lib/utils'
import { SidePanel } from '@/components/ui/side-panel'
import { StatTiles } from '@/components/leaves/stat-tiles'
import { Message } from '@/components/leaves/leaves-page'
import { CancelClaim, PdfButton, actionClass } from './claim-actions'
import { ClaimView } from './claim-detail'
import { ClaimForm } from './claim-form'
import { ScaleCard } from './scale-card'

// grade : le nom de MON grade, ou null (ancienne fiche sans grade : les catégories plafonnées sont refusées).
type Loaded = { claims: ExpenseClaim[]; categories: ExpenseCategory[]; grade: string | null; scale: Scale | null; scales: Scale[] }

export function ExpensesPage({ me }: { me: Me }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [problem, setProblem] = useState('')
  // +1 après un envoi / une annulation : tout est relu.
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((old) => old + 1), [])
  // La note ouverte dans le panneau : son n° de demande (relue après chaque rechargement : statut à jour).
  const [openedId, setOpenedId] = useState<number | null>(null)

  useEffect(() => {
    Promise.all(['/api/expenses/mine/', '/api/expenses/categories/', '/api/expenses/mine/scale/', '/api/expenses/scales/'].map((path) => apiFetch(path)))
      .then(async ([claims, categories, scale, scales]) => {
        // 404 sur MON barème : un compte sans dossier RH (ex. un compte IT) n'a pas de notes de frais.
        if (scale.status === 404) return setProblem('No HR file is linked to this account: there is no expense claim to show.')
        if (![claims, categories, scale, scales].every((r) => r.ok)) throw new Error()
        const mine: { grade: string | null; scale: Scale | null } = await scale.json()
        setLoaded({ claims: await claims.json(), categories: await categories.json(), grade: mine.grade, scale: mine.scale, scales: await scales.json() })
      })
      .catch(() => setProblem('Could not load your expense claims. Please try again later.'))
  }, [version])

  if (loaded === null) return <Message>{problem || 'Loading...'}</Message>
  const { claims } = loaded
  const active = claims.filter((c) => c.status === 'IN_PROGRESS' || c.status === 'APPROVED')
  const opened = claims.find((claim) => claim.request === openedId) ?? null

  return <div className="flex flex-col gap-4">
    <div>
      <h1 className="text-lg font-semibold text-[#192646]">Expense claims</h1>
      <p className="text-xs text-slate-500">Reimbursements with receipts, ceilings by grade, circuit N+1 then HR. Once validated, print the PDF for HR.</p>
    </div>

    {/* Une ancienne fiche sans grade : on le dit clairement (les dépenses plafonnées seraient refusées). */}
    {!loaded.grade && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      Your HR file has no grade yet: ask HR to complete it. Until then, allowance, transport and hotel expenses cannot be sent (no ceiling to apply).
    </p>}

    <StatTiles label="My expense claims" tiles={[
      { label: 'Claims', value: String(claims.length), hint: 'All my claims' },
      { label: 'In approval', value: String(claims.filter((c) => c.status === 'IN_PROGRESS').length), hint: 'Waiting for my N+1' },
      { label: 'Validated', value: String(claims.filter((c) => c.status === 'APPROVED').length), hint: 'Print the PDF for HR' },
      { label: 'Total amount', value: formatMad(active.reduce((sum, c) => sum + c.total, 0)), hint: 'Validated or in approval', strong: true },
    ]} />

    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {/* À gauche : la note à remplir, et juste dessous MES plafonds (ce qui sert en la remplissant). */}
      <div className="flex min-w-0 flex-col gap-4">
        <ClaimForm categories={loaded.categories} scale={loaded.scale} onSent={reload} />
        <ScaleCard scales={loaded.scales} myGrade={loaded.scale?.grade ?? null} editable={seesBothPoles(me)} />
      </div>
      <MyClaims claims={claims} onOpen={(claim) => setOpenedId(claim.request)} onChanged={reload} />
    </div>

    {/* Une note, dans un panneau : on la regarde sans quitter la page. */}
    <SidePanel open={opened !== null} onClose={() => setOpenedId(null)} title={opened ? opened.title : 'Expense claim'} width={760}
      description={opened ? `Claim n° ${opened.request} · sent ${formatDate(opened.created_at.slice(0, 10))}` : undefined}>
      {opened && <ClaimView claim={opened} actions={<CancelClaim claim={opened} onCancelled={reload} />} />}
    </SidePanel>
  </div>
}

// Le statut en anglais (la page est en anglais), avec les couleurs de "My leaves" ; "Reimbursed" passe avant "Approved".
const STATUS: Record<string, { label: string; badge: string }> = {
  IN_PROGRESS: { label: 'In progress', badge: 'bg-amber-50 text-amber-700 ring-amber-200' },
  APPROVED: { label: 'Approved', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  REIMBURSED: { label: 'Reimbursed', badge: 'bg-[#E4E9F2] text-[#23355d] ring-[#23355d]/20' },
  REJECTED: { label: 'Refused', badge: 'bg-red-50 text-red-700 ring-red-200' },
  CANCELLED: { label: 'Cancelled', badge: 'bg-slate-100 text-slate-500 ring-slate-200' },
}

// Les filtres (comme "My leaves") : "Closed" regroupe refusées et annulées (ce qui ne compte plus).
const TABS = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'pending', label: 'In progress', match: (claim: ExpenseClaim) => claim.status === 'IN_PROGRESS' },
  { id: 'approved', label: 'Approved', match: (claim: ExpenseClaim) => claim.status === 'APPROVED' && !claim.reimbursed_at },
  { id: 'reimbursed', label: 'Reimbursed', match: (claim: ExpenseClaim) => Boolean(claim.reimbursed_at) },
  { id: 'closed', label: 'Closed', match: (claim: ExpenseClaim) => claim.status === 'REJECTED' || claim.status === 'CANCELLED' },
]
const FIRST = 5  // combien de lignes avant "Show all"

const SHORT_MONTH = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { month: 'short' })

/** "My claims", dans le style de "My leaves" : filtres en pastilles, les 5 dernières puis "Show all". */
function MyClaims({ claims, onOpen, onChanged }: { claims: ExpenseClaim[]; onOpen: (claim: ExpenseClaim) => void; onChanged: () => void }) {
  const [tab, setTab] = useState('all')
  const [all, setAll] = useState(false)
  const current = TABS.find((item) => item.id === tab) ?? TABS[0]
  const filtered = claims.filter(current.match)  // déjà la dernière note d'abord (Django)
  const shown = all ? filtered : filtered.slice(0, FIRST)

  return <section className="rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <header className="px-4 pt-3">
      <h2 className="text-sm font-semibold text-[#192646]">My claims</h2>
      <p className="text-[11px] text-slate-500">The latest claim first. Open one to see its expenses, receipts and who validated it.</p>
    </header>
    {claims.length === 0
      ? <p className="px-4 py-10 text-center text-sm text-slate-500"><ReceiptText className="mx-auto mb-2 size-6 text-[#8C6D52]" />No claim yet.</p>
      : <>
          <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1.5 border-b border-slate-100 px-4 pb-3 pt-2">
            {TABS.map((item) => {
              const selected = item.id === tab
              return <button key={item.id} type="button" aria-pressed={selected} onClick={() => { setTab(item.id); setAll(false) }}
                className={cn('flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors',
                  selected ? 'border-[#23355d] bg-[#23355d] text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-[#23355d]/40 hover:text-[#23355d]')}>
                {item.label}<span className={cn('tabular-nums', selected ? 'text-white/70' : 'text-slate-400')}>{claims.filter(item.match).length}</span>
              </button>
            })}
          </div>
          {shown.length === 0
            ? <p className="px-4 py-8 text-center text-xs text-slate-500">Nothing here.</p>
            : <ul className="divide-y divide-slate-100">
                {shown.map((claim) => <ClaimLine key={claim.id} claim={claim} onOpen={() => onOpen(claim)} onChanged={onChanged} />)}
              </ul>}
          {filtered.length > FIRST && <button type="button" onClick={() => setAll((old) => !old)}
            className="w-full border-t border-slate-100 px-4 py-2.5 text-xs font-semibold text-[#23355d] hover:bg-slate-50">
            {all ? 'Show less' : `Show all (${filtered.length})`}
          </button>}
        </>}
  </section>
}

function ClaimLine({ claim, onOpen, onChanged }: { claim: ExpenseClaim; onOpen: () => void; onChanged: () => void }) {
  const sent = claim.created_at.slice(0, 10)
  const ended = claim.status === 'REJECTED' || claim.status === 'CANCELLED'
  const status = STATUS[claimStatus(claim).key] ?? STATUS.CANCELLED
  const extras = [
    `${claim.lines.length} expense${claim.lines.length > 1 ? 's' : ''}`,
    `sent ${formatDate(sent)}`,
    claim.waiting_for && `waiting for ${claim.waiting_for}`,
    claim.reimbursed_at && `reimbursed ${formatDate(claim.reimbursed_at)}`,
  ].filter(Boolean)

  return <li className={cn('flex items-start gap-3 px-4 py-3', ended && 'opacity-60')}>
    {/* La puce calendrier : le jour de l'envoi. */}
    <span className="flex w-11 shrink-0 flex-col items-center rounded-lg border border-slate-200 bg-slate-50 py-1" aria-hidden>
      <span className="text-[9px] font-bold uppercase tracking-wide text-[#8C6D52]">{SHORT_MONTH(sent)}</span>
      <span className="text-base font-semibold leading-tight text-[#192646]">{Number(sent.slice(8, 10))}</span>
    </span>

    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <button type="button" onClick={onOpen} className="truncate text-left text-sm font-semibold text-[#192646] hover:underline">{claim.title}</button>
        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-600">{formatMad(claim.total)}</span>
      </div>
      <p className="truncate text-[11px] text-slate-400">{extras.join(' · ')}</p>
    </div>

    <div className="flex shrink-0 flex-col items-end gap-1">
      <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', status.badge)}>{status.label}</span>
      <div className="flex items-center gap-1">
        <PdfButton claim={claim} />
        <CancelClaim claim={claim} onCancelled={onChanged} />
        <button type="button" onClick={onOpen} className={actionClass}>View</button>
      </div>
    </div>
  </li>
}
