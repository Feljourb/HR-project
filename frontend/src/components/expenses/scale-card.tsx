'use client'

/*
 * "My ceilings" (sous le formulaire) : le MÊME dessin qu'avant le 18/11/2026 (l'utilisatrice le préférait) :
 * - en haut, MES plafonds en petites cartes (icône, montant, unité) ;
 * - "See all grades" ouvre un petit tableau : une ligne par grade (le mien en couleur), une colonne par catégorie.
 * Seule la source change : les plafonds par catégorie et par grade (Reference lists -> Réglages des notes de frais).
 */
import { useState } from 'react'
import { BedDouble, Car, ChevronDown, ReceiptText, Scale as ScaleIcon, UtensilsCrossed } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { type MyCeiling } from '@/lib/expenses'
import { cn } from '@/lib/utils'

type All = { grades: { id: number; name: string }[]; categories: { id: number; name: string; per: string }[]; ceilings: { category: number; grade: number; amount: number }[] }

// L'icône et l'unité, selon le maximum (par nuit = un lit, par jour = un repas, par trajet = une voiture).
const ICONS: Record<string, typeof Car> = { 'par nuit': BedDouble, 'par jour': UtensilsCrossed, 'par trajet': Car }
const PER: Record<string, string> = { 'par nuit': 'per night', 'par jour': 'per day', 'par trajet': 'per trip', 'par dépense': 'per expense' }
const label = (category: string) => category.split('(')[0].trim()  // "Hébergement (hôtel)" -> "Hébergement"
// Un plafond est un montant rond : "400 MAD" (pas "400,00 MAD", plus léger à lire) ; "99,99 MAD" garde ses centimes.
const short = (amount: number) => `${amount.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} MAD`

export function ScaleCard({ grade, ceilings }: { grade: string | null; ceilings: MyCeiling[] }) {
  const [open, setOpen] = useState(false)
  const [all, setAll] = useState<All | null>(null)

  // Tous les grades : lus au premier clic seulement.
  async function toggle() {
    setOpen((old) => !old)
    if (all) return
    const response = await apiFetch('/api/expenses/ceilings/').catch(() => null)
    if (response?.ok) setAll(await response.json())
  }

  const columns = all ? all.categories.filter((category) => all.ceilings.some((cell) => cell.category === category.id)) : []
  return <section className="rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <header className="flex items-center gap-2 px-4 pt-3">
      <ScaleIcon className="size-4 shrink-0 text-[#8C6D52]" aria-hidden />
      <h2 className="min-w-0 flex-1 text-sm font-semibold text-[#192646]">My ceilings</h2>
      {grade && <span className="truncate rounded-full bg-[#E4E9F2] px-2 py-0.5 text-[11px] font-semibold text-[#23355d]">{grade}</span>}
    </header>

    {!grade
      ? <p className="px-4 py-3 text-xs text-slate-500">No grade on your HR file yet: ask HR to complete it.</p>
      : ceilings.length === 0
        ? <p className="px-4 py-3 text-xs text-slate-500">No ceiling for your grade.</p>
        : <div className="grid grid-cols-3 gap-2 p-4 pt-3">
            {ceilings.map((item) => {
              const Icon = ICONS[item.per] ?? ReceiptText
              return <div key={item.category} className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5">
                <p className="flex items-center gap-1.5 truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500" title={item.category}>
                  <Icon className="size-3.5 shrink-0 text-[#8C6D52]" aria-hidden /> {label(item.category)}
                </p>
                <p className="mt-1 text-base font-semibold tabular-nums text-[#192646]">{short(item.amount)}</p>
                <p className="text-[11px] text-slate-400">{PER[item.per] ?? item.per}</p>
              </div>
            })}
          </div>}

    <button type="button" onClick={toggle} aria-expanded={open}
      className="flex w-full items-center justify-center gap-1 border-t border-slate-100 px-4 py-2.5 text-xs font-semibold text-[#23355d] hover:bg-slate-50">
      {open ? 'Hide the grades' : `See all grades${all ? ` (${all.grades.length})` : ''}`}
      <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
    </button>

    {open && <div className="overflow-x-auto border-t border-slate-100">
      {!all
        ? <p className="px-4 py-3 text-xs text-slate-400">Loading...</p>
        : <table className="w-full min-w-[460px] text-xs">
            <thead>
              <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2">Grade</th>
                {columns.map((category) => <th key={category.id} className="px-2 py-2 text-right" title={category.name}>
                  {label(category.name)} <span className="font-normal normal-case">/ {(PER[category.per] ?? category.per).replace('per ', '')}</span>
                </th>)}
              </tr>
            </thead>
            <tbody>
              {all.grades.map((item) => {
                const mine = item.name === grade
                return <tr key={item.id} className={cn('border-t border-slate-100', mine && 'bg-[#F5F7FB]')}>
                  <td className="px-4 py-2 font-semibold text-[#192646]">
                    {item.name}{mine && <span className="ml-1.5 rounded-full bg-[#192646] px-1.5 py-0.5 text-[9px] font-semibold text-white">Mine</span>}
                  </td>
                  {columns.map((category) => {
                    const cell = all.ceilings.find((one) => one.category === category.id && one.grade === item.id)
                    return <td key={category.id} className="px-2 py-2 text-right tabular-nums text-slate-600">{cell ? short(cell.amount) : '—'}</td>
                  })}
                </tr>
              })}
            </tbody>
          </table>}
    </div>}
  </section>
}
