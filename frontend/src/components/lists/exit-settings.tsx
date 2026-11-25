'use client'

/*
 * Réglages des arrivées et départs : la procédure de départ complète (2026-11-25, Admin RH + IT), en 3 morceaux :
 * - ExitDocumentsSetting (onglet "Departure rules") : les documents demandés tout seuls à la validation d'un départ,
 *   et leur délai (certificat de travail : 8 jours après le dernier jour, art. 72) ;
 * - IndemnitySetting (onglet "Notice & indemnity") : l'indemnité de licenciement en HEURES de salaire par année
 *   d'ancienneté (art. 53 par défaut) et l'ancienneté minimum (6 mois, art. 52) ;
 * - ExitQuestionsSetting (onglet "Exit interview") : les questions de l'entretien de sortie (jamais supprimées :
 *   décochées ; un entretien déjà rempli garde sa copie).
 */
import { useCallback, useEffect, useState } from 'react'
import { Loader2, Pencil, Plus } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import { SidePanel } from '@/components/ui/side-panel'
import { controlClass } from '@/components/ui/control-class'
import { errorOf, QUESTION_KIND, type ExitQuestion, type QuestionKind } from '@/lib/journeys'

type Settings = { exit_document_types: number[]; exit_document_days: number; indemnity_hours: [number, number][]; indemnity_min_months: number; updated_by_name: string | null }

const card = 'rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]'

/** Lit les réglages ; patch() enregistre et renvoie la nouvelle version (ou un message d'erreur). */
function useJourneySettings() {
  const [value, setValue] = useState<Settings | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    apiFetch('/api/journeys/settings/')
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then(setValue)
      .catch(() => setError('Could not load these settings: refresh the page.'))
  }, [])
  async function patch(body: Partial<Settings>) {
    setError('')
    const response = await apiFetch('/api/journeys/settings/', { method: 'PATCH', body: JSON.stringify(body) }).catch(() => null)
    if (response?.ok) { setValue(await response.json()); return true }
    setError(response ? await errorOf(response) : 'The server does not answer. Try again.')
    return false
  }
  return { value, error, patch }
}

/** Les documents de sortie demandés tout seuls (module Documents), et leur délai après le dernier jour. */
export function ExitDocumentsSetting() {
  const { value, error, patch } = useJourneySettings()
  const [types, setTypes] = useState<{ id: number; name: string }[]>([])
  const [draftDays, setDays] = useState<string | null>(null)  // null = pas modifié : la valeur enregistrée
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    apiFetch('/api/documents/types/').then((response) => (response.ok ? response.json() : [])).then(setTypes).catch(() => setTypes([]))
  }, [])

  if (!value) return error ? <p role="alert" className="text-xs text-red-600">{error}</p> : null
  const days = draftDays ?? String(value.exit_document_days)
  const toggle = (id: number) => (value.exit_document_types.includes(id) ? value.exit_document_types.filter((x) => x !== id) : [...value.exit_document_types, id])

  return <section className={card}>
    <h2 className="text-sm font-semibold text-[#192646]">④ Exit documents</h2>
    <p className="mt-1 text-xs text-slate-500">Requested automatically when a departure is approved (in Document requests, “To prepare”). The law: the work certificate within 8 days after the last day (art. 72); the final pay receipt (“reçu pour solde de tout compte”) is made by payroll (art. 73).</p>
    <div className="mt-3 flex flex-wrap gap-2">
      {types.map((type) => {
        const on = value.exit_document_types.includes(type.id)
        return <label key={type.id} className={cn('flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium',
          on ? 'border-[#23355d] bg-[#23355d]/5 text-[#192646]' : 'border-slate-200 text-slate-600 hover:border-slate-300')}>
          <input type="checkbox" checked={on} className="size-3.5 accent-[#23355d]" onChange={() => void patch({ exit_document_types: toggle(type.id) }).then(setSaved)} />
          {type.name}
        </label>
      })}
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-700">
      Ready at the latest
      <input type="number" min={0} max={60} value={days} onChange={(e) => { setDays(e.target.value); setSaved(false) }} aria-label="Days after the last day"
        className={cn(controlClass, 'mt-0 h-8 w-16 px-2')} />
      days after the last day.
      {days !== String(value.exit_document_days) && <button type="button" onClick={() => void patch({ exit_document_days: Number(days) }).then((ok) => { setSaved(ok); if (ok) setDays(null) })}
        className="h-8 rounded-md bg-[#23355d] px-2.5 text-[11px] font-semibold text-white hover:bg-[#192646]">Save</button>}
      {saved && <span role="status" className="font-medium text-emerald-700">✓ Saved</span>}
    </div>
    {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
  </section>
}

/** L'indemnité de licenciement : les heures de salaire par année d'ancienneté, par tranche, et le minimum. */
export function IndemnitySetting() {
  const { value, error, patch } = useJourneySettings()
  // null = pas modifié : on montre la valeur enregistrée.
  const [draftRows, setRows] = useState<string[][] | null>(null)
  const [draftMinimum, setMinimum] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  if (!value) return error ? <p role="alert" className="text-xs text-red-600">{error}</p> : null
  const savedRows = value.indemnity_hours.map(([s, h]) => [String(s), String(h)])
  const rows = draftRows ?? savedRows
  const minimum = draftMinimum ?? String(value.indemnity_min_months)
  const changed = JSON.stringify(rows) !== JSON.stringify(savedRows) || minimum !== String(value.indemnity_min_months)

  async function save() {
    const ok = await patch({ indemnity_hours: rows.map(([start, hours]) => [Number(start), Number(hours)] as [number, number]), indemnity_min_months: Number(minimum) })
    setSaved(ok)
    if (ok) { setRows(null); setMinimum(null) }
  }

  return <section className={card}>
    <h2 className="text-sm font-semibold text-[#192646]">④ Dismissal indemnity</h2>
    <p className="mt-1 text-xs text-slate-500">Only for a dismissal, not for serious misconduct (art. 39), after a minimum seniority (art. 52). In HOURS of salary per year of seniority (art. 53); a part of a year counts pro rata. E.g. 4 years and 6 months: 4.5 × 96 = 432 h. Payroll: hours × hourly salary.</p>
    <table className="mt-3 w-full max-w-md text-left text-xs">
      <thead><tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-500">
        <th className="py-2 pr-3 font-semibold">Seniority</th><th className="py-2 font-semibold">Hours of salary per year</th>
      </tr></thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map(([start, hours], index) => {
          const next = rows[index + 1]?.[0]
          return <tr key={index}>
            <td className="py-2 pr-3 text-slate-700">{next ? `From ${start} to ${next} years` : `More than ${start} years`}</td>
            <td className="py-2"><input type="number" min={0} max={1000} value={hours} aria-label={`Hours per year from ${start} years`}
              onChange={(e) => { setRows(rows.map((row, i) => (i === index ? [row[0], e.target.value] : row))); setSaved(false) }}
              className={cn(controlClass, 'mt-0 h-8 w-24 px-2')} /></td>
          </tr>
        })}
      </tbody>
    </table>
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-700">
      Minimum seniority:
      <input type="number" min={0} max={60} value={minimum} onChange={(e) => { setMinimum(e.target.value); setSaved(false) }} aria-label="Minimum seniority in months"
        className={cn(controlClass, 'mt-0 h-8 w-16 px-2')} /> months.
    </div>
    <div className="mt-3 flex items-center gap-2">
      <button type="button" onClick={() => void save()} disabled={!changed}
        className="rounded-md bg-[#23355d] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#192646] disabled:opacity-50">Save</button>
      {saved && <span role="status" className="text-xs font-medium text-emerald-700">✓ Saved</span>}
      {error && <span role="alert" className="text-xs text-red-600">{error}</span>}
    </div>
  </section>
}

/** Les questions de l'entretien de sortie : un tableau en lecture + "Edit" / "Add a question" dans un panneau. */
export function ExitQuestionsSetting() {
  const [rows, setRows] = useState<ExitQuestion[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [editing, setEditing] = useState<ExitQuestion | 'new' | null>(null)

  const load = useCallback(() => {
    apiFetch('/api/journeys/exit-questions/')
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data: ExitQuestion[]) => { setRows(data); setFailed(false) })
      .catch(() => setFailed(true))
  }, [])
  useEffect(load, [load])

  return <section className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-[#192646]">Exit interview questions</h2>
        <p className="text-xs text-slate-500">Asked to the employee when the departure is approved (bell + email, on “My departure”). Confidential: only HR read the answers, never the manager.</p>
      </div>
      <button type="button" onClick={() => setEditing('new')} className="flex items-center gap-1.5 rounded-lg bg-[#23355d] px-3 py-2 text-xs font-semibold text-white hover:bg-[#192646]">
        <Plus className="size-3.5" /> Add a question
      </button>
    </div>
    {failed && <p role="alert" className="px-4 pb-3 text-xs text-red-600">Could not load the questions: refresh the page.</p>}
    {rows && <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-xs">
      <thead><tr className="border-y border-slate-100 bg-slate-50/60 text-[11px] uppercase tracking-wide text-slate-500">
        <th className="px-4 py-2 font-semibold">#</th><th className="px-4 py-2 font-semibold">Question</th>
        <th className="px-4 py-2 font-semibold">Answer</th><th className="px-4 py-2 font-semibold">Required</th><th className="px-4 py-2" />
      </tr></thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((row) => <tr key={row.id} className={cn(!row.is_active && 'opacity-50')}>
          <td className="px-4 py-2.5 text-slate-500">{row.order}</td>
          <td className="px-4 py-2.5 font-medium text-[#192646]">{row.text}{!row.is_active && <span className="ml-2 text-[11px] font-normal text-slate-500">(inactive)</span>}
            {row.kind === 'CHOICE' && <p className="text-[11px] font-normal text-slate-500">{row.choices.join(' · ')}</p>}</td>
          <td className="px-4 py-2.5 text-slate-600">{QUESTION_KIND[row.kind]}</td>
          <td className="px-4 py-2.5 text-slate-600">{row.required ? '✓' : '—'}</td>
          <td className="px-4 py-2.5 text-right"><button type="button" onClick={() => setEditing(row)} className="inline-flex items-center gap-1 text-xs font-semibold text-[#23355d] hover:underline"><Pencil className="size-3.5" /> Edit</button></td>
        </tr>)}
      </tbody>
    </table></div>}
    <p className="border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-500"><span className="font-semibold text-slate-600">Answer:</span> free text, a score from 1 to 5, one choice in a list, or yes / no. A question is never deleted: untick “Active” (past interviews keep their own copy).</p>
    <SidePanel open={editing !== null} onClose={() => setEditing(null)} width={480} title={editing === 'new' ? 'Add a question' : 'Edit the question'}>
      {editing !== null && <QuestionForm question={editing === 'new' ? null : editing} nextOrder={(rows?.length ?? 0) + 1}
        onSaved={() => { setEditing(null); load() }} />}
    </SidePanel>
  </section>
}

function QuestionForm({ question, nextOrder, onSaved }: { question: ExitQuestion | null; nextOrder: number; onSaved: () => void }) {
  const [text, setText] = useState(question?.text ?? '')
  const [kind, setKind] = useState<QuestionKind>(question?.kind ?? 'TEXT')
  const [choices, setChoices] = useState((question?.choices ?? []).join('\n'))
  const [required, setRequired] = useState(question?.required ?? false)
  const [order, setOrder] = useState(String(question?.order ?? nextOrder))
  const [active, setActive] = useState(question?.is_active ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setBusy(true)
    setError('')
    const body = JSON.stringify({ text, kind, choices: choices.split('\n').map((c) => c.trim()).filter(Boolean), required, order: Number(order) || 0, is_active: active })
    const response = await apiFetch(question ? `/api/journeys/exit-questions/${question.id}/` : '/api/journeys/exit-questions/',
      { method: question ? 'PATCH' : 'POST', body }).catch(() => null)
    setBusy(false)
    if (response?.ok) onSaved(); else setError(response ? await errorOf(response) : 'The server does not answer. Try again.')
  }

  return <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void save() }}>
    <label className="text-xs font-semibold text-slate-700">Question <span className="text-red-600">*</span>
      <input value={text} onChange={(e) => setText(e.target.value)} maxLength={200} required className={controlClass} placeholder="e.g. Why are you leaving?" />
    </label>
    <label className="text-xs font-semibold text-slate-700">Answer
      <select value={kind} onChange={(e) => setKind(e.target.value as QuestionKind)} className={controlClass}>
        {(Object.keys(QUESTION_KIND) as QuestionKind[]).map((value) => <option key={value} value={value}>{QUESTION_KIND[value]}</option>)}
      </select>
    </label>
    {kind === 'CHOICE' && <label className="text-xs font-semibold text-slate-700">Choices <span className="font-normal text-slate-400">(one per line, at least 2)</span>
      <textarea value={choices} onChange={(e) => setChoices(e.target.value)} rows={5}
        className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-[#23355d] focus:bg-white" />
    </label>}
    <label className="text-xs font-semibold text-slate-700">Order <span className="font-normal text-slate-400">(1 = first)</span>
      <input type="number" min={0} value={order} onChange={(e) => setOrder(e.target.value)} className={cn(controlClass, 'w-24')} />
    </label>
    <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="size-4 accent-[#23355d]" /> Required</label>
    <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-4 accent-[#23355d]" /> Active (asked in the next interviews)</label>
    {error && <p role="alert" className="text-xs font-medium text-red-600">{error}</p>}
    <button type="submit" disabled={busy || !text.trim()} className="flex items-center justify-center gap-1.5 rounded-lg bg-[#23355d] px-3 py-2 text-sm font-semibold text-white hover:bg-[#192646] disabled:opacity-50">
      {busy && <Loader2 className="size-4 animate-spin" />} Save
    </button>
  </form>
}
