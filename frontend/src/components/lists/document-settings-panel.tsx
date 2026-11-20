'use client'

/*
 * Les réglages des documents (Reference lists -> Documents -> "Réglages des documents"), Admin RH (2026-11-17,
 * remarques de la réunion ; principe : on n'enlève rien, Admin RH choisit) :
 * - les formats proposés au collaborateur (PDF / original signé / les deux ; au moins un) ;
 * - les managers peuvent-ils demander pour leur équipe : non (défaut) / tous / seulement ceux choisis
 *   (ex. les chefs d'équipe de l'usine, dont les ouvriers n'utilisent pas l'application).
 * Lu et enregistré dans /api/documents/settings/.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { CheckCircle2, FileText, Files, ListChecks, Loader2, PenLine, UsersRound, X } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import type { DocumentType } from '@/lib/documents'
import { cn } from '@/lib/utils'
import { sendChange } from '@/lib/workflows'
import { formatDateTime } from '@/components/employees/history-changes'
import { PersonPicker, type Person } from '@/components/requests/out-of-office'
import { DocumentTypesSetup } from './document-types-setup'
import { ListCard } from './list-card'
import { DOCUMENT_TYPES_LIST } from './lists-config'
import { SettingsTabs } from './settings-tabs'

// La légende du tableau des types (règle "Don't Make Me Think").
const TYPES_LEGEND: [string, string][] = [
  ['Delay (working days)', 'How long HR take to prepare it, shown to the employee as “expected by …” (Saturday, Sunday and public holidays not counted). 0 = at once.'],
  ['Status', 'Active = offered in the form. Inactive = no longer offered (old requests keep it). A document is never deleted.'],
]
import { SignaturesPanel } from './signatures-panel'

type Settings = {
  offer_pdf: boolean; offer_original: boolean; offer_both: boolean
  manager_requests: 'OFF' | 'ALL' | 'CHOSEN'; chosen_managers: number[]; chosen_labels: { id: number; name: string }[]
  pickup_days: number[]  // les jours de retrait des originaux (après-midi) : 0 = lundi ... 4 = vendredi
  min_notice_days: number  // la "Date souhaitée" au plus tôt N jours après la demande
  codes: Record<string, string>  // les codes du publipostage ({{ nom }} -> "Nom (en majuscules)")
  updated_at: string; updated_by: string | null
}
type Draft = Pick<Settings, 'offer_pdf' | 'offer_original' | 'offer_both' | 'manager_requests' | 'pickup_days' | 'min_notice_days'>
  & { chosen: { id: number; name: string }[] }

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']

const FORMATS: { name: 'offer_pdf' | 'offer_original' | 'offer_both'; title: string; text: string }[] = [
  { name: 'offer_pdf', title: 'PDF', text: 'Downloaded from the app.' },
  { name: 'offer_original', title: 'Signed original', text: 'Paper, picked up at the HR office.' },
  { name: 'offer_both', title: 'PDF + original', text: 'Both.' },
]
const MANAGERS = [
  { id: 'OFF', title: 'No', text: 'Only the employee (or HR) requests a document.' },
  { id: 'ALL', title: 'Yes, every manager', text: 'Each N+1 can request for the people of his team.' },
  { id: 'CHOSEN', title: 'Only chosen managers', text: 'E.g. the factory team leaders, for workers who do not use the app.' },
] as const

const draftOf = (data: Settings): Draft => ({
  offer_pdf: data.offer_pdf, offer_original: data.offer_original, offer_both: data.offer_both,
  manager_requests: data.manager_requests, chosen: data.chosen_labels, pickup_days: [...data.pickup_days].sort(),
  min_notice_days: data.min_notice_days,
})

export function DocumentSettingsPanel() {
  const [saved, setSaved] = useState<Settings | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [picker, setPicker] = useState<Person | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    apiFetch('/api/documents/settings/')
      .then(async (response) => {
        if (!response.ok) throw new Error()
        const data: Settings = await response.json()
        setSaved(data)
        setDraft(draftOf(data))
      })
      .catch(() => setFailed(true))
  }, [])

  function edit(change: Partial<Draft>) {
    setDraft((old) => (old ? { ...old, ...change } : old))
    setDone(false)
    setError('')
  }

  // Un manager choisi dans la recherche : ajouté à la liste (une seule fois), la recherche se vide.
  function addManager(person: Person | null) {
    if (person && draft && !draft.chosen.some((item) => item.id === person.id)) {
      edit({ chosen: [...draft.chosen, { id: person.id, name: `${person.first_name} ${person.last_name}` }] })
    }
    setPicker(null)
  }

  const noFormat = draft !== null && !draft.offer_pdf && !draft.offer_original && !draft.offer_both
  const changed = saved !== null && draft !== null && JSON.stringify(draft) !== JSON.stringify(draftOf(saved))

  async function save() {
    if (!draft) return
    setBusy(true)
    setError('')
    try {
      const body = { offer_pdf: draft.offer_pdf, offer_original: draft.offer_original, offer_both: draft.offer_both,
        manager_requests: draft.manager_requests, chosen_managers: draft.chosen.map((item) => item.id), pickup_days: draft.pickup_days,
        min_notice_days: draft.min_notice_days }
      const response = await apiFetch('/api/documents/settings/', { method: 'PATCH', body: JSON.stringify(body) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        const first = Object.values(data)[0]
        throw new Error(Array.isArray(first) ? String(first[0]) : data.detail ?? 'Could not save.')
      }
      setSaved(data)
      setDraft(draftOf(data))
      setDone(true)
    } catch (problem) {
      setError(problem instanceof Error && problem.message !== 'Failed to fetch' ? problem.message : 'Cannot reach the server. Please try again later.')
    }
    setBusy(false)
  }

  // Le bouton Save des réglages (sections 1 et 4) : le même enregistrement, à la fin de chacune.
  const saveBar = (saved: Settings) => <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 pt-3">
    {error && <p role="alert" className="mr-auto text-xs font-medium text-red-600">{error}</p>}
    {done && <p role="status" className="mr-auto flex items-center gap-1.5 text-xs font-medium text-emerald-700"><CheckCircle2 className="size-4" /> Saved.</p>}
    {!done && !error && saved.updated_by && <p className="mr-auto text-[11px] text-slate-400">Last change {formatDateTime(saved.updated_at)} by {saved.updated_by}</p>}
    <button type="button" onClick={save} disabled={busy || !changed || noFormat}
      className="flex items-center gap-1.5 rounded-lg bg-[#23355d] px-4 py-2 text-xs font-semibold text-white hover:bg-[#192646] disabled:cursor-not-allowed disabled:opacity-50">
      {busy && <Loader2 className="size-3.5 animate-spin" />} Save
    </button>
  </div>

  if (saved === null || draft === null) {
    return <p className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
      {failed ? 'Could not load the settings (Admin RH only).' : 'Loading...'}
    </p>
  }
  const pdfOffered = draft.offer_pdf || draft.offer_both

  // 4 questions, dans l'ordre (2026-11-17, l'utilisatrice : "simple, clair, professionnel") :
  // 1. ce que le collaborateur peut demander ; 2. comment le PDF est fait (seulement si le PDF est proposé) ;
  // 3. les modèles des documents ; 4. les managers.
  // 2026-11-19 : en ONGLETS (settings-tabs.tsx, comme Réglages des congés) : une question visible à la fois.
  const requests = <Card number={1} title="What employees can request" text="The format, the date they need it, and when originals can be picked up.">
      <fieldset>
        <legend className="text-xs font-semibold text-slate-700">Formats</legend>
        <p className="text-[11px] text-slate-500">By default only the signed original. Add the PDF if you want it (step 2 says how it is made). One ticked: the form does not ask.</p>
        <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
          {FORMATS.map((option) => <label key={option.name} className={cn('flex cursor-pointer gap-2 rounded-lg border px-2.5 py-2',
            draft[option.name] ? 'border-[#23355d] bg-[#E4E9F2]/50 ring-1 ring-[#23355d]' : 'border-slate-200 hover:border-slate-300')}>
            <input type="checkbox" checked={draft[option.name]} onChange={(e) => edit({ [option.name]: e.target.checked })}
              className="mt-0.5 accent-[#192646]" />
            <span>
              <span className="block text-xs font-semibold text-[#192646]">{option.title}</span>
              <span className="block text-[11px] leading-snug text-slate-500">{option.text}</span>
            </span>
          </label>)}
        </div>
        {noFormat && <p className="mt-1.5 text-[11px] font-medium text-red-600">Tick at least one format.</p>}
      </fieldset>
      <div>
        <label htmlFor="min-notice" className="text-xs font-semibold text-slate-700">&ldquo;Needed by&rdquo;: at the earliest</label>
        <div className="mt-1.5 flex items-center gap-2">
          <input id="min-notice" type="number" min={0} max={15} step={1} value={draft.min_notice_days}
            onChange={(e) => edit({ min_notice_days: Math.max(0, Math.min(15, Number(e.target.value) || 0)) })}
            className="w-20 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-[#23355d] focus:bg-white" />
          <span className="text-xs text-slate-500">days after the request (Sundays and public holidays not counted)</span>
        </div>
      </div>
      <fieldset>
        <legend className="text-xs font-semibold text-slate-700">Pickup days at the HR office (afternoon)</legend>
        <p className="text-[11px] text-slate-500">Requested before noon on a pickup day: ready that afternoon, otherwise on the next one. Shown to employees in the form.</p>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {WEEKDAYS.map((day, index) => {
            const on = draft.pickup_days.includes(index)
            return <label key={day} className={cn('flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium',
              on ? 'border-[#23355d] bg-[#E4E9F2]/50 text-[#192646]' : 'border-slate-200 text-slate-600 hover:border-slate-300')}>
              <input type="checkbox" checked={on} className="accent-[#192646]"
                onChange={() => edit({ pickup_days: on ? draft.pickup_days.filter((other) => other !== index) : [...draft.pickup_days, index].sort() })} />
              {day}
            </label>
          })}
        </div>
      </fieldset>
      {saveBar(saved)}
    </Card>

  // 2. Qui signe (TOUJOURS : nom, fonction, "Fait à" sont imprimés aussi sur les originaux) ; et, seulement si le PDF
  //    est proposé, comment le PDF est fait : automatique (signature + cachet de l'app) ou par les RH.
  const signs = <Card number={2} title="Who signs" text={pdfOffered
      ? 'Per pôle: the signatory printed on every document. And how the PDF is made: Automatic (the app adds the signature and stamp) or By HR (they download the filled form, sign, stamp, scan and upload it). The paper original is always signed by hand.'
      : 'Per pôle: the signatory printed on every document (name, title, the city of "Fait à"). The original is printed, signed and stamped by HR.'}>
      <SignaturesPanel embedded showMode={pdfOffered} />
    </Card>

  const models = <Card number={3} title="Document models" text="The form of each document: its text, filled with the employee's data. Without a model, HR upload their own document (e.g. a payslip).">
      <DocumentTypesSetup codes={saved.codes} />
    </Card>

  const managers = <Card number={4} title="Managers" text="Can a manager request a document for someone of his team?">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {MANAGERS.map((option) => {
          const selected = draft.manager_requests === option.id
          return <label key={option.id} className={cn('flex cursor-pointer gap-2 rounded-lg border px-2.5 py-2',
            selected ? 'border-[#23355d] bg-[#E4E9F2]/50 ring-1 ring-[#23355d]' : 'border-slate-200 hover:border-slate-300')}>
            <input type="radio" name="manager-requests" checked={selected} onChange={() => edit({ manager_requests: option.id })}
              className="mt-0.5 accent-[#192646]" />
            <span>
              <span className="block text-xs font-semibold text-[#192646]">{option.title}</span>
              <span className="block text-[11px] leading-snug text-slate-500">{option.text}</span>
            </span>
          </label>
        })}
      </div>
      {draft.manager_requests === 'CHOSEN' && <div className="rounded-lg border border-slate-200 p-3">
        <PersonPicker id="chosen-manager" label="Add a manager" value={picker} onChange={addManager}
          source={(search) => `/api/employees/?search=${search}`} />
        {draft.chosen.length === 0
          ? <p className="mt-2 text-[11px] text-amber-700">Nobody chosen yet: no manager can request.</p>
          : <ul className="mt-2 flex flex-wrap gap-1.5">
              {draft.chosen.map((item) => <li key={item.id}
                className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-1 pl-2.5 pr-1 text-[11px] font-medium text-slate-700">
                {item.name}
                <button type="button" aria-label={`Remove ${item.name}`} onClick={() => edit({ chosen: draft.chosen.filter((other) => other.id !== item.id) })}
                  className="rounded-full p-0.5 text-slate-500 hover:bg-slate-200"><X className="size-3" /></button>
              </li>)}
            </ul>}
      </div>}
      {/* Quels documents (même place que "quels managers", 2026-11-17) : enregistré à chaque clic. */}
      {draft.manager_requests !== 'OFF' && <ManagerDocuments />}
      {saveBar(saved)}
    </Card>

  return <SettingsTabs title="Réglages des documents" storageKey="document-settings-tab"
    text="Everything about administrative documents in one place. Choose a section."
    tabs={[
      // (2026-11-19 : avant, une entrée "Types de document" à part dans Reference lists.)
      { id: 'types', label: 'Document types', icon: ListChecks, hint: 'The documents employees can request, and the delay HR promise for each one.',
        content: <ListCard list={DOCUMENT_TYPES_LIST} title="Document types" addLabel="Add a document" legend={TYPES_LEGEND}
          text="The documents employees can request. The legend under the table explains each column." /> },
      { id: 'requests', label: 'What employees can request', icon: FileText, content: requests,
        hint: 'The formats offered (signed original, PDF), the earliest "needed by" date and the pickup days.' },
      { id: 'signs', label: 'Who signs', icon: PenLine, content: signs,
        hint: 'The signatory of each pôle, printed on every document (and how the PDF is signed, when it is offered).' },
      { id: 'models', label: 'Document models', icon: Files, content: models,
        hint: 'The text of each document, filled with the employee’s data.' },
      { id: 'managers', label: 'Managers', icon: UsersRound, content: managers,
        hint: 'Whether managers can request documents for their team, and which documents.' },
    ]} />
}

/** Les documents qu'un manager peut demander pour son équipe (DocumentType.manager_can_request) : une case par
 *  document, enregistrée tout de suite (pas l'attestation de salaire : le salaire ne regarde pas le manager). */
function ManagerDocuments() {
  const [types, setTypes] = useState<DocumentType[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    apiFetch('/api/documents/types/')
      .then(async (response) => { if (response.ok) setTypes(await response.json()) })
      .catch(() => setTypes([]))
  }, [])

  async function toggle(type: DocumentType) {
    setError('')
    const result = await sendChange<DocumentType>(() => apiFetch(`/api/documents/lists/types/${type.id}/`,
      { method: 'PATCH', body: JSON.stringify({ manager_can_request: !type.manager_can_request }) }), 'Only Admin RH can change this.')
    if ('error' in result) return setError(result.error)
    setTypes((old) => old && old.map((item) => (item.id === type.id ? { ...item, manager_can_request: !type.manager_can_request } : item)))
  }

  return <fieldset>
    <legend className="text-xs font-semibold text-slate-700">Documents a manager can request</legend>
    {types === null
      ? <p className="text-[11px] text-slate-400">Loading...</p>
      : <div className="mt-1.5 flex flex-wrap gap-2">
          {types.map((type) => <label key={type.id} className={cn('flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium',
            type.manager_can_request ? 'border-[#23355d] bg-[#E4E9F2]/50 text-[#192646]' : 'border-slate-200 text-slate-600 hover:border-slate-300')}>
            <input type="checkbox" checked={type.manager_can_request} onChange={() => toggle(type)} className="accent-[#192646]" />
            {type.name}
          </label>)}
        </div>}
    {error && <p role="alert" className="mt-1.5 text-[11px] font-medium text-red-600">{error}</p>}
  </fieldset>
}

/** Une section numérotée de la page (une question, une phrase qui l'explique). */
function Card({ number, title, text, children }: { number: number; title: string; text: string; children?: ReactNode }) {
  return <section className="min-w-0 rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <header className="flex gap-3 border-b border-slate-100 px-4 py-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#23355d] text-[11px] font-bold text-white">{number}</span>
      <div>
        <h2 className="text-sm font-semibold text-[#192646]">{title}</h2>
        <p className="text-[11px] text-slate-500">{text}</p>
      </div>
    </header>
    {children && <div className="flex flex-col gap-4 p-4">{children}</div>}
  </section>
}
