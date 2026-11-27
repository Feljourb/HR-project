'use client'

/*
 * Bouton "Rehire" de la fiche d'un "Sorti" qui revient (2026-11-27, standard Workday / SAP "Rehire").
 *
 * 1. Clic -> cadre : GET /api/employees/<id>/rehire/ dit ce que Django propose (la période d'avant, l'ancienneté
 *    d'avant, le choix par défaut d'Admin RH, le droit annuel valable au départ).
 * 2. Les RH choisissent : la nouvelle date d'embauche, l'ancienneté (remise à 0 = la loi, ou gardée), le droit.
 * 3. POST -> Django fait tout (journeys.services.rehire) et renvoie la fiche à jour : la page la recharge.
 * 4. Dernier écran : ce qu'il reste à faire (le poste, le contrat... puis un mot de passe temporaire).
 */
import { useEffect, useRef, useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { seniorityLabel, type EmployeeFiche } from '@/lib/employees'
import { frDate } from '@/lib/journeys'
import { DatePicker } from '@/components/ui/date-picker'

type Proposal = {
  previous: { hire_date: string; departure_date: string; months: number }
  open_departure_tasks: number  // les tâches de son départ pas encore faites (les RH les trient)
  keep_seniority: boolean
  annual_leave_days: number
}

/** "2026-11-26" -> "2026-11-27" : le premier jour possible (après la date de sortie). */
function dayAfter(day: string) {
  const date = new Date(`${day}T12:00:00`)
  date.setDate(date.getDate() + 1)
  return date.toISOString().slice(0, 10)
}

/** 22 mois -> "1 year 10 months" (le même texte que l'ancienneté de la fiche). */
function before(proposal: Proposal) {
  const months = proposal.previous.months
  return seniorityLabel({ years: Math.floor(months / 12), months: months % 12 } as Parameters<typeof seniorityLabel>[0])
}

export function RehireButton({ employeeId, name, onDone }: { employeeId: number; name: string; onDone: (fiche: EmployeeFiche) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [hireDate, setHireDate] = useState('')
  const [keep, setKeep] = useState(false)
  const [right, setRight] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  // La fiche à jour, donnée à la page SEULEMENT en fermant le cadre : la page cache ce bouton dès que la fiche n'est
  // plus "Sorti", et le cadre partirait avec lui avant l'écran "is back ✓" (trouvé par l'utilisatrice, 2026-11-27).
  const [updated, setUpdated] = useState<EmployeeFiche | null>(null)

  // Ouvre / ferme le vrai <dialog> (fond grisé, Échap).
  useEffect(() => {
    const dialog = dialogRef.current
    if (open && dialog && !dialog.open) dialog.showModal()
    if (!open && dialog?.open) dialog.close()
  }, [open])

  // À l'ouverture : la proposition de Django (les valeurs par défaut du formulaire).
  async function start() {
    setOpen(true)
    setError('')
    setDone(false)
    setHireDate('')
    try {
      const response = await apiFetch(`/api/employees/${employeeId}/rehire/`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data.detail ?? data[0] ?? 'Could not load the proposal.')
        return
      }
      setProposal(data)
      setKeep(data.keep_seniority)
      setRight(String(data.annual_leave_days))
    } catch {
      setError('Cannot reach the server.')
    }
  }

  function close() {
    setOpen(false)
    setProposal(null)
    if (updated) {
      setUpdated(null)
      onDone(updated)  // la page affiche la fiche à jour (Actif, nouvelle date, période d'avant)
    }
  }

  async function confirm() {
    setSaving(true)
    setError('')
    try {
      const response = await apiFetch(`/api/employees/${employeeId}/rehire/`, {
        method: 'POST',
        body: JSON.stringify({ hire_date: hireDate, keep_seniority: keep, annual_leave_days: right }),
      })
      const data = await response.json().catch(() => ({}))
      if (response.ok) {
        setUpdated(data)  // donnée à la page en fermant (voir close)
        setDone(true)
      } else {
        setError(data.hire_date?.[0] ?? data.annual_leave_days?.[0] ?? data.detail ?? 'Something went wrong. Please try again.')
      }
    } catch {
      setError('Cannot reach the server.')
    }
    setSaving(false)
  }

  // ⚠ Son départ a encore des tâches pas faites : l'app ne les ferme pas (solde de tout compte, CNSS : obligatoires).
  const openTasks = proposal && proposal.open_departure_tasks > 0
    ? <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
        ⚠ {proposal.open_departure_tasks} departure task{proposal.open_departure_tasks > 1 ? 's are' : ' is'} still open: see <b>Arrivals & departures</b>.
      </p>
    : null

  const radio = (value: boolean, title: string, text: string) => (
    <label className={`flex cursor-pointer gap-2.5 rounded-lg border p-3 text-xs ${keep === value ? 'border-[#23355d] bg-[#23355d]/5' : 'border-slate-200 hover:border-slate-300'}`}>
      <input type="radio" name="keep" checked={keep === value} onChange={() => setKeep(value)} className="mt-0.5" />
      <span><b className="block font-semibold text-[#192646]">{title}</b><span className="text-slate-500">{text}</span></span>
    </label>
  )

  return <>
    <button type="button" onClick={start} className="flex items-center gap-1.5 rounded-lg bg-[#23355d] px-3 py-2 text-xs font-semibold text-white hover:bg-[#192646]">
      <RotateCcw className="size-3.5" /> Rehire
    </button>

    <dialog ref={dialogRef} onClose={close} onClick={(e) => { if (e.target === dialogRef.current) close() }}
      className="m-auto w-[min(92vw,460px)] rounded-xl border border-slate-200 bg-white p-0 shadow-2xl backdrop:bg-slate-900/40">
      {done ? (
        // Dernier écran : ce qu'il reste à faire, dans l'ordre.
        <div className="p-5">
          <h2 className="text-sm font-semibold text-[#192646]">{name} is back ✓</h2>
          <p className="mt-1 text-xs text-slate-500">Same file, same employee number. Their leave balance starts from 0.</p>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-xs text-slate-700">
            <li>Check the <b>job</b> on the file: service, position, contract, trial period. Then <b>Save changes</b>.</li>
            <li>Give them a password: <b>Réinitialiser le mot de passe</b> (top of the file).</li>
            <li>Their <b>arrival checklist</b> has started if the first day is close (Arrivals & departures).</li>
          </ol>
          {openTasks}
          <div className="mt-4 flex justify-end">
            <button type="button" onClick={close} className="rounded-lg bg-[#23355d] px-4 py-2 text-xs font-semibold text-white hover:bg-[#192646]">OK</button>
          </div>
        </div>
      ) : (
        <div className="p-5">
          <h2 className="text-sm font-semibold text-[#192646]">Rehire {name}</h2>
          {!proposal && !error && <p className="mt-3 flex items-center gap-2 text-xs text-slate-500"><Loader2 className="size-3.5 animate-spin" /> Loading…</p>}
          {proposal && <>
            <p className="mt-1 text-xs text-slate-500">
              Previous period: {frDate(proposal.previous.hire_date)} → {frDate(proposal.previous.departure_date)} ({before(proposal)}).
              The same file and account come back; nothing is deleted.
            </p>

            <label htmlFor="rehire-date" className="mt-4 block text-xs font-semibold text-slate-700">New hire date *</label>
            <DatePicker id="rehire-date" value={hireDate} onChange={setHireDate} min={dayAfter(proposal.previous.departure_date)} required className="mt-1.5" />

            <p className="mt-4 text-xs font-semibold text-slate-700">Seniority</p>
            <div className="mt-1.5 grid grid-cols-1 gap-2">
              {radio(false, 'Start again from 0', 'The law: a new contract. Leave bonus, notice and indemnity count from the new hire date.')}
              {radio(true, `Keep the ${before(proposal)} of before`, 'Company choice: the years before count. The time away does not.')}
            </div>

            <label htmlFor="rehire-right" className="mt-4 block text-xs font-semibold text-slate-700">Annual leave entitlement (days / year)</label>
            <input id="rehire-right" type="number" min={0} max={60} step={0.5} value={right} onChange={(e) => setRight(e.target.value)}
              className="mt-1.5 h-10 w-28 rounded-lg border border-slate-200 px-3 text-sm" />
            <p className="mt-1 text-[11px] text-slate-500">Their right on their last day. The balance starts from 0: the days left were paid when they left.</p>
            {openTasks}
          </>}
          {error && <p role="alert" className="mt-3 text-[11px] font-medium text-red-600">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={close} className="rounded-lg px-4 py-2 text-xs font-semibold text-slate-500 hover:text-[#23355d]">Cancel</button>
            <button type="button" onClick={confirm} disabled={saving || !proposal || !hireDate} className="flex items-center gap-2 rounded-lg bg-[#23355d] px-4 py-2 text-xs font-semibold text-white hover:bg-[#192646] disabled:opacity-60">
              {saving && <Loader2 className="size-3.5 animate-spin" />} Rehire
            </button>
          </div>
        </div>
      )}
    </dialog>
  </>
}
