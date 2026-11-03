'use client'

/*
 * Le barème par grade (plafonds de remboursement). Tout le monde le lit ; Admin RH (et l'IT) change les
 * montants ici (PATCH /api/expenses/scales/<id>/). Les grades eux-mêmes se gèrent dans "Reference lists".
 */
import { useState, type FormEvent } from 'react'
import { Loader2, Scale as ScaleIcon } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { formatMad, type Scale } from '@/lib/expenses'
import { cn } from '@/lib/utils'
import { sendChange } from '@/lib/workflows'
import { controlClass } from '@/components/employees/form-fields'

export function ScaleCard({ scales, myGrade, editable }: { scales: Scale[]; myGrade: number | null; editable: boolean }) {
  return <section className="rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <header className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
      <ScaleIcon className="size-4 text-[#8C6D52]" />
      <div>
        <h2 className="text-sm font-semibold text-[#192646]">Reimbursement ceilings by grade</h2>
        <p className="text-[11px] text-slate-500">Allowance per day · transport per trip · hotel per night{editable ? ' · Admin RH can change the amounts.' : '.'}</p>
      </div>
    </header>
    <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
      {scales.map((scale) => <ScaleBox key={scale.id} scale={scale} mine={scale.grade === myGrade} editable={editable} />)}
    </div>
  </section>
}

function ScaleBox({ scale: initial, mine, editable }: { scale: Scale; mine: boolean; editable: boolean }) {
  const [scale, setScale] = useState(initial)
  const [editing, setEditing] = useState(false)
  const [values, setValues] = useState({ daily_allowance: String(initial.daily_allowance), transport: String(initial.transport), hotel: String(initial.hotel) })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    const result = await sendChange<Scale>(() => apiFetch(`/api/expenses/scales/${scale.id}/`, { method: 'PATCH', body: JSON.stringify(values) }),
      'Only Admin RH can change the scale.')
    if ('data' in result) { setScale(result.data); setEditing(false); setError('') } else setError(result.error)
    setBusy(false)
  }

  return <div className={cn('rounded-lg border px-3 py-2.5', mine ? 'border-[#23355d] bg-[#F5F7FB]' : 'border-slate-200')}>
    <div className="flex items-center gap-2">
      <p className="min-w-0 flex-1 truncate text-sm font-semibold text-[#192646]">{scale.grade_label}</p>
      {mine && <span className="rounded-full bg-[#192646] px-1.5 py-0.5 text-[10px] font-semibold text-white">My grade</span>}
      {editable && !editing && <button type="button" onClick={() => setEditing(true)} className="text-[11px] font-semibold text-[#23355d] hover:underline">Edit</button>}
    </div>
    {editing
      ? <form onSubmit={save} className="mt-2 flex flex-col gap-1.5">
          {([['daily_allowance', 'Allowance / day'], ['transport', 'Transport / trip'], ['hotel', 'Hotel / night']] as const).map(([field, label]) => (
            <label key={field} className="flex items-center justify-between gap-2 text-[11px] text-slate-600">
              {label}
              <input type="number" min="0.01" step="0.01" required value={values[field]}
                onChange={(e) => setValues((old) => ({ ...old, [field]: e.target.value }))} className={cn(controlClass, 'mt-0 h-8 w-28')} />
            </label>
          ))}
          {error && <p role="alert" className="text-[11px] font-medium text-red-600">{error}</p>}
          <div className="flex justify-end gap-1">
            <button type="button" onClick={() => setEditing(false)} className="rounded-md px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
            <button type="submit" disabled={busy} className="flex items-center gap-1 rounded-md bg-[#23355d] px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-60">
              {busy && <Loader2 className="size-3 animate-spin" />} Save
            </button>
          </div>
        </form>
      : <p className="mt-1 text-xs text-slate-600">
          Allowance / day: <b className="font-semibold">{formatMad(scale.daily_allowance)}</b> · Transport: <b className="font-semibold">{formatMad(scale.transport)}</b> · Hotel: <b className="font-semibold">{formatMad(scale.hotel)}</b>
        </p>}
  </div>
}
