'use client'

/*
 * "New departure" (step 2, comme NOOR "Départ collaborateur" -> "+ Créer") : UN formulaire partagé.
 * - Le manager : choisit quelqu'un de SON équipe ; la demande part chez les RH (Team approvals).
 * - Les RH : n'importe qui de leur pôle (recherche) ; acceptée tout de suite, les tâches commencent.
 * - Le collaborateur lui-même : seulement si Admin RH l'autorise (sinon NOOR dit "référez-vous à votre supérieur").
 * Champs : qui, type (démission...), dernier jour, la lettre (PDF / photo), un commentaire, les personnes à prévenir.
 */
import { useEffect, useState } from 'react'
import { Loader2, Paperclip, X } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { controlClass } from '@/components/ui/control-class'
import { DatePicker } from '@/components/ui/date-picker'
import { PersonPicker, type Person } from '@/components/requests/out-of-office'
import { errorOf, type Departure, type DepartureOptions, type NoticePreview } from '@/lib/journeys'
import { NoticeFacts } from './notice'
import { PayrollPreview } from './departure-payroll'

const MAX_LETTER = 5 * 1024 * 1024
const LETTER_TYPES = ['.pdf', '.jpg', '.jpeg', '.png']

function todayIso() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function DepartureForm({ options, self, onDone }: {
  options: DepartureOptions
  self?: boolean                        // "Request my departure" : la personne connectée elle-même
  onDone: (departure: Departure) => void
}) {
  const [employee, setEmployee] = useState<Person | null>(null)     // RH : la recherche
  const [teamId, setTeamId] = useState('')                          // manager : son équipe
  const [type, setType] = useState('')
  const [lastDay, setLastDay] = useState('')
  const [comment, setComment] = useState('')
  const [letter, setLetter] = useState<File | null>(null)
  const [informed, setInformed] = useState<Person[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // (2026-11-25) la procédure : une démission = un écrit (la lettre jointe, réglage d'Admin RH) ; un licenciement peut
  // être pour faute grave (art. 39 : ni préavis, ni indemnité).
  const [serious, setSerious] = useState(false)
  const letterNeeded = type === 'RESIGNATION' && options.letter_required
  const who = self ? options.me : options.is_hr ? employee?.id : Number(teamId) || null
  const ready = Boolean(who && type && lastDay && (!letterNeeded || letter))

  // Le préavis légal (2026-11-25) : relu dès que la personne et le type sont choisis (Django calcule : la grille
  // d'Admin RH, la catégorie, l'ancienneté). Affiché sous "Last day" : un dernier jour trop tôt = un avertissement.
  // Gardé AVEC sa clé (personne + type) : une autre personne ou un autre type n'affiche pas l'ancien préavis.
  const seriousFlag = type === 'DISMISSAL' && serious ? '1' : '0'
  const key = who && type ? `${who}-${type}-${seriousFlag}` : ''
  const [loaded, setLoaded] = useState<{ key: string; data: NoticePreview | null } | null>(null)
  useEffect(() => {
    if (!key) return
    const controller = new AbortController()
    apiFetch(`/api/journeys/departures/notice-preview/?employee=${who}&type=${type}&serious=${seriousFlag}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: NoticePreview | null) => setLoaded({ key, data }))
      .catch(() => { /* changé entre-temps, ou serveur injoignable : pas d'aperçu */ })
    return () => controller.abort()
  }, [key, who, type, seriousFlag])
  const preview = key && loaded?.key === key ? loaded.data : null

  function chooseLetter(file: File | null) {
    setError('')
    if (file && !LETTER_TYPES.some((ext) => file.name.toLowerCase().endsWith(ext))) return setError('The letter: PDF, JPG or PNG.')
    if (file && file.size > MAX_LETTER) return setError('The letter: 5 MB at most.')
    setLetter(file)
  }

  async function send() {
    if (!ready) return
    setBusy(true)
    setError('')
    const body = new FormData()
    body.append('employee', String(who))
    body.append('departure_type', type)
    body.append('last_day', lastDay)
    body.append('comment', comment)
    if (type === 'DISMISSAL' && serious) body.append('serious_misconduct', 'true')
    for (const person of informed) body.append('informed', String(person.id))
    if (letter) body.append('letter', letter)
    const response = await apiFetch('/api/journeys/departures/', { method: 'POST', body }).catch(() => null)
    setBusy(false)
    if (response?.ok) onDone(await response.json())
    else setError(response ? await errorOf(response) : 'The server does not answer. Try again.')
  }

  return <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void send() }}>
    {/* Qui part */}
    {self
      ? <p className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700">Your own departure.</p>
      : options.is_hr
        ? <PersonPicker id="departure-employee" label="Employee who leaves *" value={employee} onChange={setEmployee}
            source={(search) => `/api/employees/directory/?search=${search}`} />
        : options.team.length === 0
          ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">You have no team: only the manager (N+1) of an employee, or HR, declare a departure.</p>
          : <label className="text-xs font-semibold text-slate-700">Employee who leaves <span className="text-red-600">*</span>
              <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className={controlClass} required>
                <option value="">Choose someone of your team...</option>
                {options.team.map((member) => <option key={member.id} value={member.id}>
                  {member.first_name} {member.last_name} · {member.position}
                </option>)}
              </select>
            </label>}

    <label className="text-xs font-semibold text-slate-700">Type of departure <span className="text-red-600">*</span>
      <select value={type} onChange={(e) => setType(e.target.value)} className={controlClass} required>
        <option value="">Choose...</option>
        {options.types.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label>
    {type === 'DISMISSAL' && <label className="-mt-2 flex items-start gap-2 text-xs text-slate-700">
      <input type="checkbox" checked={serious} onChange={(e) => setSerious(e.target.checked)} className="mt-0.5 size-4 accent-[#23355d]" />
      <span><span className="font-semibold">Serious misconduct</span> (faute grave): no notice and no dismissal indemnity (Code du travail, art. 39).</span>
    </label>}

    <div>
      <label htmlFor="departure-last-day" className="text-xs font-semibold text-slate-700">Last day <span className="text-red-600">*</span></label>
      <DatePicker id="departure-last-day" value={lastDay} onChange={setLastDay} required min={options.is_hr ? undefined : todayIso()} />
      <p className="mt-1 text-[11px] text-slate-500">The last day worked. The day after, the employee becomes “Left” and the account is blocked.</p>
      {preview && <div className="mt-2">
        {preview.applies
          ? <NoticeFacts amount={preview.amount} unit={preview.unit} group={preview.group} years={preview.years} until={preview.until} lastDay={lastDay} />
          : <NoticeFacts amount={null} unit="" group="" years={null} until={null} lastDay={lastDay} serious={seriousFlag === '1'} />}
      </div>}
    </div>

    {/* Les RH : l'aperçu de paie AVANT d'enregistrer (congés à payer, préavis, indemnité), fermé par défaut. */}
    {options.is_hr && !self && who && type && lastDay
      && <PayrollPreview employee={who} type={type} lastDay={lastDay} serious={type === 'DISMISSAL' && serious} />}

    {/* La lettre (démission...) : optionnelle, comme une pièce jointe de NOOR. */}
    <div>
      <p className="text-xs font-semibold text-slate-700">Letter {letterNeeded
        ? <><span className="text-red-600">*</span> <span className="font-normal text-slate-400">(PDF, JPG or PNG · 5 MB max)</span></>
        : <span className="font-normal text-slate-400">(optional · PDF, JPG or PNG · 5 MB max)</span>}</p>
      {letterNeeded && <p className="mt-0.5 text-[11px] text-slate-500">A resignation is a written letter, signed, with the signature legalized (art. 34). Scan it here; HR keep the paper original.</p>}
      {letter
        ? <p className="mt-1.5 flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm">
            <Paperclip className="size-4 text-slate-400" aria-hidden /><span className="min-w-0 flex-1 truncate">{letter.name}</span>
            <button type="button" onClick={() => setLetter(null)} aria-label="Remove the letter" className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="size-3.5" /></button>
          </p>
        : <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => chooseLetter(e.target.files?.[0] ?? null)}
            className="mt-1.5 block w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-slate-700 hover:file:bg-slate-200" />}
    </div>

    <label className="text-xs font-semibold text-slate-700">Comment <span className="font-normal text-slate-400">(optional)</span>
      <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} rows={2}
        className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-[#23355d] focus:bg-white" />
    </label>

    {/* Les personnes à prévenir (NOOR) : une 🔔 "Pour information" quand le départ est validé. */}
    <div className="flex flex-col gap-2">
      <PersonPicker id="departure-informed" label="People to inform (optional)" value={null}
        onChange={(person) => { if (person && !informed.some((item) => item.id === person.id)) setInformed([...informed, person]) }}
        source={(search) => `/api/employees/directory/?search=${search}`} />
      {informed.length > 0 && <ul className="flex flex-wrap gap-1.5">
        {informed.map((person) => <li key={person.id} className="flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-2.5 pr-1 text-[11px] font-medium text-slate-700">
          {person.first_name} {person.last_name}
          <button type="button" onClick={() => setInformed(informed.filter((item) => item.id !== person.id))} aria-label={`Remove ${person.first_name}`}
            className="rounded-full p-0.5 hover:bg-slate-200"><X className="size-3" /></button>
        </li>)}
      </ul>}
      <p className="text-[11px] text-slate-500">They get a bell “for information” once the departure is approved.</p>
    </div>

    <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
      {options.is_hr
        ? 'Recorded by HR: approved at once. The departure tasks start now (IT, HR, manager…).'
        : self
          ? 'Your manager, then HR, approve it. Then the departure tasks start (IT, HR, manager…).'
          // Le manager qui déclare : sa saisie vaut son accord (le moteur passe son étape), les RH valident ensuite.
          : 'You declare it, so your agreement is given: HR approve it in Team approvals. Then the departure tasks start (IT, HR, manager…).'}
    </p>
    {error && <p role="alert" className="text-xs font-medium text-red-600">{error}</p>}
    <button type="submit" disabled={busy || !ready}
      className="flex items-center justify-center gap-1.5 rounded-lg bg-[#23355d] px-3 py-2 text-sm font-semibold text-white hover:bg-[#192646] disabled:opacity-50">
      {busy && <Loader2 className="size-4 animate-spin" />} {options.is_hr ? 'Record the departure' : self ? 'Send to my manager' : 'Send to HR'}
    </button>
  </form>
}
