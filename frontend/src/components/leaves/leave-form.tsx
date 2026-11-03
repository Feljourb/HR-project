'use client'

/*
 * Le formulaire "New leave request". Pendant qu'on choisit le type et les dates, Django calcule
 * (POST /api/leaves/mine/preview/, rien n'est enregistré) : le nombre de jours, le détail jour par jour,
 * le solde après, et la règle qui bloquerait l'envoi. Ce sont les MÊMES règles que l'envoi :
 * le frontend ne recalcule rien lui-même (une seule vérité, côté Django).
 */
import { useEffect, useState, type FormEvent } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { formatDate, formatDays, type Leave, type LeavePreview, type LeaveType } from '@/lib/leaves'
import { cn } from '@/lib/utils'
import { firstMessage, sendChange } from '@/lib/workflows'
import { Field, SelectField, TextField, controlClass } from '@/components/employees/form-fields'

type Draft = {
  leave_type: string
  start_date: string
  end_date: string
  starts_afternoon: boolean
  ends_noon: boolean
  reason: string
}

const EMPTY: Draft = { leave_type: '', start_date: '', end_date: '', starts_afternoon: false, ends_noon: false, reason: '' }

// Le calcul reçu, avec la "clé" des choix pour lesquels il a été fait (pour ne pas montrer un vieux calcul).
type Computed = { key: string; preview: LeavePreview | null; error: string }

export function LeaveForm({ onSent }: { onSent: () => void }) {
  const [types, setTypes] = useState<LeaveType[]>([])
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [computed, setComputed] = useState<Computed | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState<Leave | null>(null)

  useEffect(() => {
    apiFetch('/api/leaves/types/').then((response) => (response.ok ? response.json() : [])).then(setTypes).catch(() => setTypes([]))
  }, [])

  // Ce que le calcul dépend : tout sauf le motif. Vide tant qu'il manque le type ou une date.
  const { reason, ...counted } = draft
  // Une date "finie" : l'année tapée en entier (pendant la frappe, le navigateur donne 0002, 0020, 0202...).
  const finished = (date: string) => Number(date.slice(0, 4)) >= 2000
  const previewKey = draft.leave_type && finished(draft.start_date) && finished(draft.end_date) ? JSON.stringify(counted) : ''

  useEffect(() => {
    if (!previewKey) return
    const controller = new AbortController()
    // 250 ms d'attente : on ne demande pas un calcul à chaque chiffre tapé dans une date.
    const timer = setTimeout(() => {
      apiFetch('/api/leaves/mine/preview/', { method: 'POST', body: previewKey, signal: controller.signal })
        .then(async (response) => {
          const data = await response.json()
          setComputed(response.ok ? { key: previewKey, preview: data, error: '' } : { key: previewKey, preview: null, error: firstMessage(data) })
        })
        .catch(() => { /* annulé (les choix ont changé) ou serveur injoignable : on garde l'ancien affichage */ })
    }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [previewKey])

  // Seulement le calcul des choix ACTUELS (pas celui d'avant un changement de date).
  const current = computed && computed.key === previewKey ? computed : null
  const selectedType = types.find((type) => String(type.id) === draft.leave_type)
  const blocked = !current?.preview || Boolean(current.preview.error) || current.preview.days <= 0

  function set<K extends keyof Draft>(name: K, value: Draft[K]) {
    setDraft((old) => {
      const next = { ...old, [name]: value }
      // Une date de début après la fin (ou pas encore de fin) : la fin suit le début (un congé d'un jour).
      if (name === 'start_date' && value && (!old.end_date || old.end_date < String(value))) next.end_date = String(value)
      return next
    })
    setSent(null)
    setError('')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const result = await sendChange<Leave>(
      () => apiFetch('/api/leaves/mine/', { method: 'POST', body: JSON.stringify({ ...counted, reason }) }),
      'You cannot send this request.')
    if ('data' in result) {
      setSent(result.data)
      setDraft(EMPTY)
      setComputed(null)
      onSent()  // la page relit le solde et "My leaves"
    } else {
      setError(result.error)  // ex. "Solde insuffisant..." (le solde a changé entre l'aperçu et l'envoi)
    }
    setBusy(false)
  }

  return <form onSubmit={submit} className="rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <header className="border-b border-slate-100 px-4 py-3">
      <h2 className="text-sm font-semibold text-[#192646]">New leave request</h2>
      <p className="text-[11px] text-slate-500">Saturday counts half a day (its morning), Sunday and public holidays count nothing.</p>
    </header>

    <div className="grid gap-4 p-4 sm:grid-cols-2">
      <SelectField id="leave_type" label="Type of leave" required className="sm:col-span-2" placeholder="Choose a type"
        value={draft.leave_type} onChange={(value) => set('leave_type', value)}
        options={types.map((type) => ({ id: String(type.id), name: type.name }))}
        hint={selectedType ? typeHint(selectedType) : undefined} />

      <div>
        <TextField id="start_date" label="From" type="date" required value={draft.start_date} onChange={(value) => set('start_date', value)} />
        <Check id="starts_afternoon" label="Starts in the afternoon" checked={draft.starts_afternoon} onChange={(value) => set('starts_afternoon', value)} />
      </div>
      <div>
        <TextField id="end_date" label="To" type="date" required value={draft.end_date} onChange={(value) => set('end_date', value)} />
        <Check id="ends_noon" label="Ends at noon" checked={draft.ends_noon} onChange={(value) => set('ends_noon', value)} />
      </div>

      <Field id="reason" label="Comment" hint="Optional, for your N+1 and HR." className="sm:col-span-2">
        <textarea id="reason" rows={2} maxLength={1000} value={draft.reason} onChange={(e) => set('reason', e.target.value)}
          className={cn(controlClass, 'h-auto py-2')} />
      </Field>

      <div className="sm:col-span-2">
        <PreviewBox ready={Boolean(previewKey)} computed={current} />
      </div>
    </div>

    <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 px-4 py-3">
      {error && <p role="alert" className="mr-auto text-xs font-medium text-red-600">{error}</p>}
      {sent && <p role="status" className="mr-auto flex items-center gap-1.5 text-xs font-medium text-emerald-700">
        <CheckCircle2 className="size-4" /> Sent: {sent.leave_type_label}, {formatDays(sent.days)}. Your N+1 has been notified.
      </p>}
      <button type="submit" disabled={busy || blocked}
        className="flex items-center gap-1.5 rounded-lg bg-[#192646] px-4 py-2 text-xs font-semibold text-white hover:bg-[#23355d] disabled:cursor-not-allowed disabled:opacity-50">
        {busy && <Loader2 className="size-3.5 animate-spin" />} Send the request
      </button>
    </footer>
  </form>
}

function typeHint(type: LeaveType) {
  const balance = type.deducts_balance ? 'Taken from your balance.' : 'Not taken from your balance.'
  return type.max_days ? `${balance} Legal maximum: ${formatDays(type.max_days)}.` : balance
}

function Check({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label htmlFor={id} className="mt-2 flex items-center gap-2 text-xs text-slate-600">
    <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
      className="size-4 rounded border-slate-300 accent-[#192646]" />
    {label}
  </label>
}

// Le résultat du calcul : le total, le détail jour par jour, le solde après, ou la règle qui bloque.
function PreviewBox({ ready, computed }: { ready: boolean; computed: Computed | null }) {
  if (!ready) return <p className="rounded-lg bg-slate-50 px-3 py-3 text-xs text-slate-500">Choose a type and the dates to see the number of days.</p>
  if (!computed) return <p className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-3 text-xs text-slate-500"><Loader2 className="size-3.5 animate-spin" /> Counting...</p>
  if (!computed.preview) return <p role="alert" className="rounded-lg bg-red-50 px-3 py-3 text-xs font-medium text-red-700">{computed.error || 'Check the dates.'}</p>

  const { days, detail, balance, balance_after, error } = computed.preview
  return <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3" aria-live="polite">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <p className="text-sm text-slate-700"><span className="text-lg font-semibold text-[#192646]">{formatDays(days)}</span> of leave</p>
      {balance_after === null
        ? <p className="text-[11px] text-slate-500">Not taken from your balance</p>
        : <p className="text-[11px] text-slate-600">
            Balance: {formatDays(balance.available)} → <span className={cn('font-semibold', balance_after < 0 ? 'text-red-600' : 'text-[#192646]')}>{formatDays(balance_after)}</span> after this leave
          </p>}
    </div>

    {/* Le détail : chaque jour et ce qu'il compte (un jour férié a son nom ; 0 en gris). */}
    {detail.length > 0 && <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Day by day">
      {detail.map((line) => (
        <li key={line.date} title={line.holiday ?? undefined}
          className={cn('rounded-md border px-2 py-1 text-[11px] tabular-nums',
            line.days === 0 ? 'border-slate-200 bg-white text-slate-400' : 'border-[#23355d]/20 bg-white text-slate-700')}>
          {formatDate(line.date, true).slice(0, 9)} · <span className="font-semibold">{line.days}</span>
          {line.holiday && <span className="text-[#8C6D52]"> · {line.holiday}</span>}
        </li>
      ))}
    </ul>}

    {error && <p role="alert" className="mt-2 rounded-md bg-red-50 px-2 py-1.5 text-xs font-medium text-red-700">{error}</p>}
  </div>
}
