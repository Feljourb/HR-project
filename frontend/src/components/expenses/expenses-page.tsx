'use client'

/*
 * La page "Expense claims" (tous les rôles) : mes chiffres, une nouvelle note, mes notes, et le barème.
 * Tout vient de /api/expenses/... : Django ne renvoie que MES notes.
 */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ReceiptText } from 'lucide-react'
import { apiFetch, seesBothPoles, type Me } from '@/lib/api'
import { STATUS_BADGE, claimStatus, formatMad, type ExpenseCategory, type ExpenseClaim, type Scale } from '@/lib/expenses'
import { formatDate } from '@/lib/leaves'
import { cn } from '@/lib/utils'
import { StatTiles } from '@/components/leaves/stat-tiles'
import { Message } from '@/components/leaves/leaves-page'
import { CancelClaim, PdfButton, actionClass } from './claim-actions'
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
      <ClaimForm categories={loaded.categories} scale={loaded.scale} onSent={reload} />
      <MyClaims claims={claims} onChanged={reload} />
    </div>

    <ScaleCard scales={loaded.scales} myGrade={loaded.scale?.grade ?? null} editable={seesBothPoles(me)} />
  </div>
}

function MyClaims({ claims, onChanged }: { claims: ExpenseClaim[]; onChanged: () => void }) {
  return <section className="rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <header className="border-b border-slate-100 px-4 py-3">
      <h2 className="text-sm font-semibold text-[#192646]">My claims</h2>
      <p className="text-[11px] text-slate-500">Open a claim to see its expenses, receipts and who validated it.</p>
    </header>
    {claims.length === 0
      ? <p className="px-4 py-10 text-center text-sm text-slate-500"><ReceiptText className="mx-auto mb-2 size-6 text-[#8C6D52]" />No claim yet.</p>
      : <ul className="divide-y divide-slate-100">
          {claims.map((claim) => {
            const status = claimStatus(claim)
            return <li key={claim.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <Link href={`/expenses/${claim.request}`} className="text-sm font-semibold text-[#192646] hover:underline">{claim.title}</Link>
                <p className="text-xs text-slate-600">
                  <span className="font-semibold text-slate-700">{formatMad(claim.total)}</span> · {claim.lines.length} expense{claim.lines.length > 1 ? 's' : ''} · sent {formatDate(claim.created_at.slice(0, 10))}
                </p>
                {claim.waiting_for && <p className="text-[11px] text-slate-500">Waiting for {claim.waiting_for}</p>}
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS_BADGE[status.key])}>{status.label}</span>
                <div className="flex flex-wrap items-center justify-end gap-1">
                  <PdfButton claim={claim} />
                  <CancelClaim claim={claim} onCancelled={onChanged} />
                  <Link href={`/expenses/${claim.request}`} className={actionClass}>View</Link>
                </div>
              </div>
            </li>
          })}
        </ul>}
  </section>
}
