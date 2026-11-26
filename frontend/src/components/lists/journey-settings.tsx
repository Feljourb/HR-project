'use client'

/*
 * "Réglages des arrivées et départs" (Reference lists -> Arrivals & departures, Admin RH + IT) : le MODÈLE des
 * tâches, une seule place (2 onglets : Arrival tasks / Departure tasks, le composant partagé SettingsTabs).
 * Un tableau en lecture (tâche, qui, quand, information à noter) + "Edit" / "Add a task" dans un panneau.
 * Changer le modèle ne touche jamais un parcours déjà commencé (ses tâches sont une copie).
 * Jamais supprimer : "Active" décoché = la tâche n'est plus copiée dans les prochains parcours.
 */
import { useCallback, useEffect, useState } from 'react'
import { Hourglass, Loader2, LogIn, LogOut, MessageSquareHeart, Pencil, Plus, UserRoundCheck } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import { SidePanel } from '@/components/ui/side-panel'
import { PersonPicker, type Person } from '@/components/requests/out-of-office'
import { controlClass } from '@/components/ui/control-class'
import { errorOf, OWNER_LABEL, whenLabel, type JourneyKind, type Owner, type TaskTemplate } from '@/lib/journeys'
import { ExitDocumentsSetting, ExitQuestionsSetting, IndemnitySetting } from './exit-settings'
import { NoticeSettings } from './notice-settings'
import { SettingsTabs } from './settings-tabs'

const LEGEND: [string, string][] = [
  ['Who', 'HR = the HR of the person’s pôle. Manager = their N+1 (from the org chart; none → HR). A chosen person = e.g. the IT or the car fleet manager.'],
  ['When', 'Counted from the first day (arrival) or the last day (departure). E.g. “3 days before” the first day 01/12 = 28/11.'],
  ['Information to note', 'Asked when the task is ticked done (optional), e.g. the PC serial number. — = nothing to note.'],
]

export function JourneySettings() {
  return <SettingsTabs title="Réglages des arrivées et départs" storageKey="journey-settings-tab"
    text="The checklist copied for each person who arrives or leaves. A change applies to the NEXT arrivals and departures only."
    tabs={[
      { id: 'arrival', label: 'Arrival tasks', icon: LogIn, content: <TemplateTable kind="ARRIVAL" />,
        hint: 'What must be ready for a new employee’s first day (PC, badge, contract, desk…) and in the first month.' },
      { id: 'departure', label: 'Departure tasks', icon: LogOut, content: <TemplateTable kind="DEPARTURE" />,
        hint: 'What must be given back or closed when someone leaves (PC, badge, car, email, certificate…).' },
      { id: 'who', label: 'Departure rules', icon: UserRoundCheck, content: <div className="flex flex-col gap-4"><DepartureRules /><ExitDocumentsSetting /></div>,
        hint: 'Who may declare a departure, the account after the last day, the resignation letter, and the exit documents.' },
      { id: 'notice', label: 'Notice & indemnity', icon: Hourglass, content: <div className="flex flex-col gap-4"><NoticeSettings /><IndemnitySetting /></div>,
        hint: 'How long an employee keeps working after a resignation or a dismissal, and the dismissal indemnity (the law).' },
      { id: 'exit-interview', label: 'Exit interview', icon: MessageSquareHeart, content: <ExitQuestionsSetting />,
        hint: 'The questions asked to an employee who leaves (confidential: only HR read the answers).' },
    ]} />
}

type Rules = {
  employee_can_request_departure: boolean; auto_block: boolean; letter_required: boolean
  auto_cancel_leaves: boolean; exit_interview_enabled: boolean; show_payroll: boolean  // ⑤ les fonctions à éteindre
  updated_at: string; updated_by_name: string | null
}
type Switch = 'employee_can_request_departure' | 'auto_block' | 'letter_required' | 'auto_cancel_leaves' | 'exit_interview_enabled' | 'show_payroll'

// ⑤ (2026-11-26, règle de l'utilisatrice : "chaque fonction = une case, on ne supprime rien") : tout est allumé par
// défaut ; éteint = la fonction ne fait plus rien, le code reste.
const FEATURES: [Switch, string, string][] = [
  ['auto_cancel_leaves', 'Cancel the leaves after the last day automatically', 'Off: nothing is cancelled; the employee is told and HR see a warning in the departure.'],
  ['exit_interview_enabled', 'Exit interview', 'Off: no invitation (bell, email) and no questionnaire. Interviews already answered stay readable.'],
  ['show_payroll', '“For payroll & CNSS” in the departure', 'Off: the block is hidden (e.g. the company prepares the final pay another way).'],
]
type Choice = [boolean, string, string]

/** Les 2 réglages des départs (une seule place), chacun enregistré au clic :
 *  ① le collaborateur peut-il demander son propre départ (NON par défaut, comme NOOR) ;
 *  ② le compte après le dernier jour : bloqué par l'app (OUI par défaut, sécurité) ou par les RH à la main. */
function DepartureRules() {
  const [value, setValue] = useState<Rules | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    apiFetch('/api/journeys/settings/')
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then(setValue)
      .catch(() => setError('Could not load these settings: refresh the page.'))
  }, [])

  async function change(field: Switch, on: boolean) {
    setError('')
    setSaved(false)
    const response = await apiFetch('/api/journeys/settings/', { method: 'PATCH', body: JSON.stringify({ [field]: on }) }).catch(() => null)
    if (response?.ok) { setValue(await response.json()); setSaved(true) } else setError(response ? await errorOf(response) : 'The server does not answer. Try again.')
  }

  return <section className="flex flex-col gap-5 rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    {value && <>
      <RadioGroup name="self-departure" title="① Who declares a departure" value={value.employee_can_request_departure}
        text="The manager (N+1) declares it for his team (e.g. he received the resignation letter), and HR for anyone of their pôle. HR approve it, then the departure tasks start."
        onChange={(on) => void change('employee_can_request_departure', on)} choices={[
          [false, 'No: the employee goes through his manager (recommended, like NOOR)', 'He has no “My departure” page.'],
          [true, 'Yes: the employee can also request his own departure', 'A “My departure” page appears in his menu (My space). His manager, then HR, approve it.']]} />
      <RadioGroup name="auto-block" title="② The account after the last day" value={value.auto_block}
        text="E.g. last day Friday 28/11: what happens on Saturday 29/11, in the morning."
        onChange={(on) => void change('auto_block', on)} choices={[
          [true, 'Automatic: the app blocks the account (recommended)', 'The fiche becomes “Sorti” and the account is blocked. The history says “by système”.'],
          [false, 'By hand: HR block it', 'Nothing changes on the fiche. HR of the pôle get a 🔔 + email “Compte à bloquer” with a link to the fiche: they set it to “Sorti”.']]} />
      <RadioGroup name="letter-required" title="③ The resignation letter" value={value.letter_required}
        text="The law (art. 34): a resignation is written, signed by the employee, with the signature legalized. HR keep the paper original (a box to tick in the departure)."
        onChange={(on) => void change('letter_required', on)} choices={[
          [true, 'Required: the scanned letter is attached to the request (recommended)', 'The request cannot be sent without it.'],
          [false, 'Optional', 'The request can be sent without the letter; HR collect it later.']]} />
      <div>
        <h2 className="text-sm font-semibold text-[#192646]">⑤ Features</h2>
        <p className="mt-1 text-xs text-slate-500">Untick what your company does not want, or does another way. Nothing is deleted: tick it again any time.</p>
        <div className="mt-3 flex flex-col gap-2">
          {FEATURES.map(([field, label, hint]) => <label key={field} className={cn('flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5',
            value[field] ? 'border-[#23355d] bg-[#23355d]/5' : 'border-slate-200 hover:border-slate-300')}>
            <input type="checkbox" checked={value[field]} onChange={(e) => void change(field, e.target.checked)} className="mt-0.5 size-4 accent-[#23355d]" />
            <span><span className="block text-sm font-medium text-[#192646]">{label}</span><span className="block text-[11px] text-slate-500">{hint}</span></span>
          </label>)}
        </div>
      </div>
      <div>
        {saved && <p role="status" className="text-xs font-medium text-emerald-700">✓ Saved</p>}
        {value.updated_by_name && <p className="text-[11px] text-slate-400">Last change by {value.updated_by_name}.</p>}
      </div>
    </>}
    {error && <p role="alert" className="text-xs font-medium text-red-600">{error}</p>}
  </section>
}

/** Un groupe de choix (cartes radio) : un titre, une phrase, 2 choix. */
function RadioGroup({ name, title, text, value, choices, onChange }: {
  name: string; title: string; text: string; value: boolean; choices: Choice[]; onChange: (on: boolean) => void
}) {
  return <div>
    <h2 className="text-sm font-semibold text-[#192646]">{title}</h2>
    <p className="mt-1 text-xs text-slate-500">{text}</p>
    <div className="mt-3 flex flex-col gap-2">
      {choices.map(([on, label, hint]) =>
        <label key={String(on)} className={cn('flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5',
          value === on ? 'border-[#23355d] bg-[#23355d]/5' : 'border-slate-200 hover:border-slate-300')}>
          <input type="radio" name={name} checked={value === on} onChange={() => onChange(on)} className="mt-0.5 size-4 accent-[#23355d]" />
          <span><span className="block text-sm font-medium text-[#192646]">{label}</span><span className="block text-[11px] text-slate-500">{hint}</span></span>
        </label>)}
    </div>
  </div>
}

function TemplateTable({ kind }: { kind: JourneyKind }) {
  const [rows, setRows] = useState<TaskTemplate[] | null>(null)
  const [failed, setFailed] = useState(false)
  // Le panneau : une tâche à modifier, "new" pour en ajouter une, null = fermé.
  const [editing, setEditing] = useState<TaskTemplate | 'new' | null>(null)

  const load = useCallback(() => {
    apiFetch(`/api/journeys/templates/?kind=${kind}`)
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data: TaskTemplate[]) => { setRows(data); setFailed(false) })
      .catch(() => setFailed(true))
  }, [kind])

  useEffect(() => { load() }, [load])

  return <section className="min-w-0 rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <header className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-[#192646]">{kind === 'ARRIVAL' ? 'Arrival tasks' : 'Departure tasks'}</h2>
        <p className="text-[11px] text-slate-500">{rows ? `${rows.filter((row) => row.is_active).length} active tasks` : ' '}</p>
      </div>
      <button type="button" onClick={() => setEditing('new')}
        className="flex items-center gap-1.5 rounded-lg bg-[#23355d] px-3 py-2 text-xs font-semibold text-white hover:bg-[#192646]">
        <Plus className="size-3.5" /> Add a task
      </button>
    </header>

    {failed && <p role="alert" className="px-4 py-6 text-xs text-red-700">Could not load this list: refresh the page.</p>}
    {!failed && rows === null && <p className="px-4 py-6 text-xs text-slate-500">Loading...</p>}
    {rows && <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-xs">
        <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          <tr><th className="px-4 py-2">Task</th><th className="px-3 py-2">Who</th><th className="px-3 py-2">When</th>
            <th className="px-3 py-2">Information to note</th><th className="px-3 py-2"><span className="sr-only">Edit</span></th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => <tr key={row.id} className={cn(!row.is_active && 'opacity-50')}>
            <td className="px-4 py-2.5 font-medium text-[#192646]">{row.name}
              {!row.is_active && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">Inactive</span>}</td>
            <td className="px-3 py-2.5 text-slate-600">{row.owner === 'PERSON' ? row.person_name : OWNER_LABEL[row.owner]}</td>
            <td className="px-3 py-2.5 text-slate-600">{whenLabel(row.offset_days, kind)}</td>
            <td className="px-3 py-2.5 text-slate-600">{row.detail_label || '—'}</td>
            <td className="px-3 py-2.5 text-right">
              <button type="button" onClick={() => setEditing(row)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold text-[#23355d] hover:bg-slate-100">
                <Pencil className="size-3" /> Edit
              </button>
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>}
    <dl className="flex flex-col gap-1 border-t border-slate-100 px-4 py-3 text-[11px] text-slate-500">
      {LEGEND.map(([term, text]) => <div key={term}><dt className="inline font-semibold text-slate-700">{term}: </dt><dd className="inline">{text}</dd></div>)}
    </dl>

    <SidePanel open={editing !== null} onClose={() => setEditing(null)} width={480}
      title={editing === 'new' ? 'Add a task' : 'Edit the task'} description={kind === 'ARRIVAL' ? 'Arrival checklist' : 'Departure checklist'}>
      {editing !== null && <TemplateForm kind={kind} template={editing === 'new' ? null : editing}
        onSaved={() => { setEditing(null); load() }} />}
    </SidePanel>
  </section>
}

/** Le formulaire d'une tâche du modèle : quoi, qui, quand, l'information à noter, active. */
function TemplateForm({ kind, template, onSaved }: { kind: JourneyKind; template: TaskTemplate | null; onSaved: () => void }) {
  const [name, setName] = useState(template?.name ?? '')
  const [owner, setOwner] = useState<Owner>(template?.owner ?? 'HR')
  const [person, setPerson] = useState<Person | null>(template?.person
    ? { id: template.person, first_name: template.person_name ?? '', last_name: '' } : null)
  const [days, setDays] = useState(String(Math.abs(template?.offset_days ?? 0)))
  const [direction, setDirection] = useState<'before' | 'after'>((template?.offset_days ?? 0) > 0 ? 'after' : 'before')
  const [detailLabel, setDetailLabel] = useState(template?.detail_label ?? '')
  const [active, setActive] = useState(template?.is_active ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dayWord = kind === 'ARRIVAL' ? 'first day' : 'last day'
  const count = Math.max(0, Math.round(Number(days) || 0))
  const offset = direction === 'before' ? -count : count

  async function save() {
    setBusy(true)
    setError('')
    const body = { kind, name, owner, person: owner === 'PERSON' ? person?.id ?? null : null, offset_days: offset, detail_label: detailLabel.trim(), is_active: active }
    const response = await apiFetch(template ? `/api/journeys/templates/${template.id}/` : '/api/journeys/templates/',
      { method: template ? 'PATCH' : 'POST', body: JSON.stringify(body) }).catch(() => null)
    setBusy(false)
    if (response?.ok) onSaved()
    else setError(response ? await errorOf(response) : 'The server does not answer. Try again.')
  }

  return <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void save() }}>
    <label className="text-xs font-semibold text-slate-700">Task <span className="text-red-600">*</span>
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={150} required placeholder="e.g. Prepare the PC and the email" className={controlClass} />
    </label>

    <label className="text-xs font-semibold text-slate-700">Who does it
      <select value={owner} onChange={(e) => setOwner(e.target.value as Owner)} className={controlClass}>
        {(Object.keys(OWNER_LABEL) as Owner[]).map((id) => <option key={id} value={id}>{OWNER_LABEL[id]}</option>)}
      </select>
    </label>
    {owner === 'PERSON' && <PersonPicker id="template-person" label="The person (e.g. the IT, the car fleet manager)" value={person} onChange={setPerson}
      source={(search) => `/api/employees/directory/?search=${search}`} />}

    <fieldset>
      <legend className="text-xs font-semibold text-slate-700">When</legend>
      <div className="mt-1.5 flex items-center gap-2 text-sm text-slate-700">
        <input type="number" min={0} max={365} step={1} value={days} onChange={(e) => setDays(e.target.value)} aria-label="Number of days"
          className="h-10 w-20 rounded-lg border border-slate-200 bg-slate-50 px-3 outline-none focus:border-[#23355d] focus:bg-white" />
        <span>day(s)</span>
        <select value={direction} onChange={(e) => setDirection(e.target.value as 'before' | 'after')} aria-label="Before or after"
          className="h-10 rounded-lg border border-slate-200 bg-slate-50 px-2 outline-none focus:border-[#23355d] focus:bg-white">
          <option value="before">before</option>
          <option value="after">after</option>
        </select>
        <span>the {dayWord}</span>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">= {whenLabel(offset, kind)}. 0 = on the {dayWord} itself.</p>
    </fieldset>

    <label className="text-xs font-semibold text-slate-700">Information to note <span className="font-normal text-slate-400">(optional)</span>
      <input value={detailLabel} onChange={(e) => setDetailLabel(e.target.value)} maxLength={100} placeholder="e.g. PC serial number" className={controlClass} />
      <span className="mt-1 block text-[11px] font-normal text-slate-500">Asked when the task is ticked done. Empty = one click “Done”.</span>
    </label>

    <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
      <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-4 accent-[#23355d]" />
      Active (copied into the next {kind === 'ARRIVAL' ? 'arrivals' : 'departures'})
    </label>

    {error && <p role="alert" className="text-xs font-medium text-red-600">{error}</p>}
    <button type="submit" disabled={busy || !name.trim() || (owner === 'PERSON' && !person)}
      className="flex items-center justify-center gap-1.5 rounded-lg bg-[#23355d] px-3 py-2 text-sm font-semibold text-white hover:bg-[#192646] disabled:opacity-50">
      {busy && <Loader2 className="size-4 animate-spin" />} Save
    </button>
  </form>
}
