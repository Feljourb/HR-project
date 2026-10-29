'use client'

/*
 * Un circuit (ex. "Congé") et ses étapes, qu'Admin RH peut changer :
 * ajouter, enlever, monter / descendre une étape, changer le valideur ou le mode.
 *
 * Les changements restent dans la page (un brouillon) jusqu'à "Save" : on envoie alors
 * TOUTE la liste à Django, qui vérifie les règles et numérote les étapes 1, 2, 3.
 */
import { useState } from 'react'
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import { controlClass } from '@/components/employees/form-fields'
import { APPROVERS, MODES, sendChange, type StepDraft, type Workflow } from '@/lib/workflows'

const iconButton = 'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-[#23355d] disabled:pointer-events-none disabled:opacity-30'
const selectClass = cn(controlClass, 'mt-0 h-8 w-auto px-2 text-xs')

// Le circuit tel qu'il est enregistré, sous la forme du brouillon (pour comparer).
const draftOf = (workflow: Workflow): StepDraft[] => workflow.steps.map(({ approver, mode }) => ({ approver, mode }))

export function CircuitCard({ workflow, onSaved }: { workflow: Workflow; onSaved: (workflow: Workflow) => void }) {
  const [steps, setSteps] = useState<StepDraft[]>(() => draftOf(workflow))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Le bouton Save ne sert que si le brouillon est différent du circuit enregistré.
  const changed = JSON.stringify(steps) !== JSON.stringify(draftOf(workflow))
  // Les valideurs pas encore dans le circuit (le même valideur deux fois est refusé).
  const unused = APPROVERS.filter((approver) => !steps.some((step) => step.approver === approver.id))

  // Toute modification du brouillon efface l'ancien message d'erreur.
  function edit(change: (steps: StepDraft[]) => StepDraft[]) {
    setSteps(change)
    setError('')
  }

  // Échange l'étape avec sa voisine (by = -1 : celle du dessus, +1 : celle du dessous).
  function move(index: number, by: number) {
    edit((list) => {
      const next = [...list]
      ;[next[index], next[index + by]] = [next[index + by], next[index]]
      return next
    })
  }

  function change(index: number, field: keyof StepDraft, value: string) {
    edit((list) => list.map((step, i) => (i === index ? { ...step, [field]: value } : step)))
  }

  async function save() {
    setBusy(true)
    const result = await sendChange<Workflow>(() =>
      apiFetch(`/api/workflows/${workflow.id}/`, { method: 'PATCH', body: JSON.stringify({ steps }) }))
    if ('data' in result) onSaved(result.data)
    else setError(result.error)
    setBusy(false)
  }

  return <section className="rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <header className="border-b border-slate-100 px-4 py-3">
      <h3 className="text-sm font-semibold text-[#192646]">{workflow.name}</h3>
      {/* Le circuit enregistré, en une ligne : "N+1 (Valider) → RH du pôle (Informer)". */}
      <p className="text-[11px] text-slate-500">
        {workflow.steps.map((step) => `${step.approver_label} (${step.mode_label})`).join(' → ')}
      </p>
    </header>

    <ol>
      {steps.map((step, index) => (
        <li key={step.approver} className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#23355d] text-[11px] font-bold text-white">{index + 1}</span>

          <label htmlFor={`${workflow.code}-approver-${index}`} className="sr-only">Validator</label>
          <select id={`${workflow.code}-approver-${index}`} value={step.approver} className={selectClass}
            onChange={(e) => change(index, 'approver', e.target.value)}>
            {/* Son valideur actuel + ceux qui ne sont pas encore dans le circuit. */}
            {APPROVERS.filter((approver) => approver.id === step.approver || unused.includes(approver)).map((approver) =>
              <option key={approver.id} value={approver.id}>{approver.name}</option>)}
          </select>

          <label htmlFor={`${workflow.code}-mode-${index}`} className="sr-only">Mode</label>
          <select id={`${workflow.code}-mode-${index}`} value={step.mode} className={selectClass}
            onChange={(e) => change(index, 'mode', e.target.value)}>
            {MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.name}</option>)}
          </select>

          <div className="ml-auto flex gap-0.5">
            <button type="button" aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)} className={iconButton}>
              <ArrowUp className="size-3.5" />
            </button>
            <button type="button" aria-label="Move down" disabled={index === steps.length - 1} onClick={() => move(index, 1)} className={iconButton}>
              <ArrowDown className="size-3.5" />
            </button>
            <button type="button" aria-label="Remove this step" onClick={() => edit((list) => list.filter((_, i) => i !== index))} className={iconButton}>
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </li>
      ))}
      {steps.length === 0 && <li className="border-b border-slate-100 px-4 py-4 text-center text-xs text-slate-500">No step.</li>}
    </ol>

    <footer className="flex flex-wrap items-center gap-2 px-4 py-3">
      {/* Une nouvelle étape prend le premier valideur libre, à changer ensuite dans sa liste. */}
      <button type="button" disabled={unused.length === 0} onClick={() => edit((list) => [...list, { approver: unused[0].id, mode: 'VALIDATE' }])}
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold text-[#23355d] hover:bg-slate-100 disabled:opacity-40">
        <Plus className="size-3.5" /> Add a step
      </button>
      <div className="ml-auto flex gap-2">
        {changed && <button type="button" disabled={busy} onClick={() => edit(() => draftOf(workflow))}
          className="rounded-md px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>}
        <button type="button" disabled={!changed || busy} onClick={save}
          className="flex items-center gap-1.5 rounded-md bg-[#23355d] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#192646] disabled:opacity-50">
          {busy && <Loader2 className="size-3 animate-spin" />} Save
        </button>
      </div>
      {error && <p role="alert" className="w-full text-[11px] font-medium text-red-600">{error}</p>}
    </footer>
  </section>
}
