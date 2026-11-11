'use client'

/*
 * Les plafonds de remboursement (le barème par grade), en PETIT (2026-11-11 : l'ancienne carte prenait toute la
 * largeur avec 5 grandes cases) :
 * - en haut, MES 3 plafonds (ceux de mon grade), ce qui sert en remplissant une note ;
 * - "See all grades" ouvre un petit tableau de tous les grades. Admin RH (et l'IT) y change les montants
 *   (PATCH /api/expenses/scales/<id>/). Les grades eux-mêmes se gèrent dans "Reference lists".
 */
import { useState, type FormEvent } from 'react'
import { BedDouble, Car, ChevronDown, Loader2, Scale as ScaleIcon, UtensilsCrossed } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { formatMad, type Scale } from '@/lib/expenses'
import { cn } from '@/lib/utils'
import { sendChange } from '@/lib/workflows'
import { controlClass } from '@/components/employees/form-fields'

// Les 3 plafonds : le champ de l'API, le texte, l'unité, l'icône.
const KINDS = [
  { field: 'daily_allowance', label: 'Allowance', per: 'per day', icon: UtensilsCrossed },
  { field: 'transport', label: 'Transport', per: 'per trip', icon: Car },
  { field: 'hotel', label: 'Hotel', per: 'per night', icon: BedDouble },
] as const

export function ScaleCard({ scales: initial, myGrade, editable }: { scales: Scale[]; myGrade: number | null; editable: boolean }) {
  // Gardés ici : un montant changé par Admin RH se voit aussitôt dans "My ceilings" aussi.
  const [scales, setScales] = useState(initial)
  const [open, setOpen] = useState(false)
  const mine = scales.find((scale) => scale.grade === myGrade) ?? null

  return <section className="rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <header className="flex items-center gap-2 px-4 pt-3">
      <ScaleIcon className="size-4 shrink-0 text-[#8C6D52]" aria-hidden />
      <h2 className="min-w-0 flex-1 text-sm font-semibold text-[#192646]">My ceilings</h2>
      {mine && <span className="truncate rounded-full bg-[#E4E9F2] px-2 py-0.5 text-[11px] font-semibold text-[#23355d]">{mine.grade_label}</span>}
    </header>

    {mine
      ? <div className="grid grid-cols-3 gap-2 p-4 pt-3">
          {KINDS.map(({ field, label, per, icon: Icon }) => <div key={field} className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500"><Icon className="size-3.5 text-[#8C6D52]" aria-hidden /> {label}</p>
            <p className="mt-1 text-base font-semibold tabular-nums text-[#192646]">{formatMad(mine[field])}</p>
            <p className="text-[11px] text-slate-400">{per}</p>
          </div>)}
        </div>
      : <p className="px-4 py-3 text-xs text-slate-500">No grade on your HR file yet: ask HR to complete it.</p>}

    <button type="button" onClick={() => setOpen((old) => !old)} aria-expanded={open}
      className="flex w-full items-center justify-center gap-1 border-t border-slate-100 px-4 py-2.5 text-xs font-semibold text-[#23355d] hover:bg-slate-50">
      {open ? 'Hide the grades' : `See all grades (${scales.length})`}{editable && !open ? ' · edit' : ''}
      <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
    </button>

    {open && <div className="overflow-x-auto border-t border-slate-100">
      <table className="w-full min-w-[460px] text-xs">
        <thead>
          <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            <th className="px-4 py-2">Grade</th>
            {KINDS.map((kind) => <th key={kind.field} className="px-2 py-2 text-right">{kind.label} <span className="font-normal normal-case">/ {kind.per.slice(4)}</span></th>)}
            {editable && <th className="px-4 py-2"><span className="sr-only">Edit</span></th>}
          </tr>
        </thead>
        <tbody>
          {scales.map((scale) => <ScaleRow key={scale.id} scale={scale} mine={scale.grade === myGrade} editable={editable}
            onSaved={(saved) => setScales((old) => old.map((item) => (item.id === saved.id ? saved : item)))} />)}
        </tbody>
      </table>
    </div>}
  </section>
}

// Une ligne du tableau ; pour Admin RH, "Edit" la transforme en 3 champs + Save.
function ScaleRow({ scale, mine, editable, onSaved }: { scale: Scale; mine: boolean; editable: boolean; onSaved: (scale: Scale) => void }) {
  const [editing, setEditing] = useState(false)
  const [values, setValues] = useState({ daily_allowance: String(scale.daily_allowance), transport: String(scale.transport), hotel: String(scale.hotel) })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    const result = await sendChange<Scale>(() => apiFetch(`/api/expenses/scales/${scale.id}/`, { method: 'PATCH', body: JSON.stringify(values) }),
      'Only Admin RH can change the scale.')
    if ('data' in result) { onSaved(result.data); setEditing(false); setError('') } else setError(result.error)
    setBusy(false)
  }

  const formId = `scale-${scale.id}`
  return <tr className={cn('border-t border-slate-100', mine && 'bg-[#F5F7FB]')}>
    <td className="px-4 py-2 font-semibold text-[#192646]">
      {scale.grade_label}{mine && <span className="ml-1.5 rounded-full bg-[#192646] px-1.5 py-0.5 text-[9px] font-semibold text-white">Mine</span>}
      {error && <p role="alert" className="mt-1 font-normal text-red-600">{error}</p>}
    </td>
    {KINDS.map(({ field, label }) => <td key={field} className="px-2 py-2 text-right tabular-nums text-slate-600">
      {editing
        ? <input form={formId} type="number" min="0.01" step="0.01" required aria-label={`${label}, ${scale.grade_label}`} value={values[field]}
            onChange={(e) => setValues((old) => ({ ...old, [field]: e.target.value }))} className={cn(controlClass, 'mt-0 h-8 w-24 text-right')} />
        : formatMad(scale[field])}
    </td>)}
    {editable && <td className="whitespace-nowrap px-4 py-2 text-right">
      {editing
        ? <form id={formId} onSubmit={save} className="inline-flex gap-1">
            <button type="button" onClick={() => { setEditing(false); setError('') }} className="rounded-md px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
            <button type="submit" disabled={busy} className="flex items-center gap-1 rounded-md bg-[#23355d] px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-60">
              {busy && <Loader2 className="size-3 animate-spin" />} Save
            </button>
          </form>
        : <button type="button" onClick={() => setEditing(true)} className="text-[11px] font-semibold text-[#23355d] hover:underline">Edit</button>}
    </td>}
  </tr>
}
