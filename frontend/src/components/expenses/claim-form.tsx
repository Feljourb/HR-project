'use client'

/*
 * "New expense claim" : un objet (ex. "Mission Agadir") et une ligne par dépense (un jour d'indemnité,
 * un trajet, une nuit d'hôtel...), chacune avec son justificatif (photo ou PDF).
 * Le plafond du grade s'affiche sous la ligne pendant la saisie ; c'est Django qui décide à l'envoi
 * (ses messages s'affichent sous la ligne concernée : {"line_1": ["Plafond..."]}).
 * Envoi en multipart (FormData) : les lignes en JSON + les fichiers de chaque ligne (receipt_0, receipt_0, receipt_1...).
 * Plusieurs justificatifs par dépense (2026-11-11), ex. la facture de l'hôtel + le ticket de la carte : jusqu'à 5.
 */
import { useState, type FormEvent } from 'react'
import { CheckCircle2, FileText, Loader2, Paperclip, Plus, Trash2, X } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { MAX_RECEIPTS, ceilingOf, formatMad, type ExpenseCategory, type ExpenseClaim, type Scale } from '@/lib/expenses'
import { isoDate } from '@/lib/leaves'
import { cn } from '@/lib/utils'
import { controlClass } from '@/components/employees/form-fields'
import { DatePicker } from '@/components/ui/date-picker'

type Line = { key: number; date: string; category: string; amount: string; description: string; files: File[] }

let nextKey = 1
const emptyLine = (): Line => ({ key: nextKey++, date: '', category: '', amount: '', description: '', files: [] })
const MAX_LINES = 20
// Le même maximum que Django (MAX_LINE_AMOUNT) : une sécurité contre un zéro de trop.
const MAX_AMOUNT = 100000

const PER: Record<string, string> = { DAILY_ALLOWANCE: 'per day', TRANSPORT: 'per trip', HOTEL: 'per night' }

// inPanel : le formulaire est dans le panneau "New expense claim" (le panneau a déjà le titre et l'aide).
export function ClaimForm({ categories, scale, onSent, inPanel = false }: {
  categories: ExpenseCategory[]; scale: Scale | null; onSent: (claim: ExpenseClaim) => void; inPanel?: boolean
}) {
  const [title, setTitle] = useState('')
  const [lines, setLines] = useState<Line[]>(() => [emptyLine()])
  const [errors, setErrors] = useState<Record<string, string[]>>({})
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<ExpenseClaim | null>(null)
  const today = isoDate(new Date())
  const total = lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0)

  function change(key: number, field: keyof Line, value: string | File[]) {
    setLines((old) => old.map((line) => (line.key === key ? { ...line, [field]: value } : line)))
    setErrors({})
    setSent(null)
  }

  // Les fichiers choisis s'AJOUTENT à ceux de la ligne (on peut cliquer "Add" plusieurs fois), au plus 5.
  function addFiles(line: Line, picked: FileList | null) {
    if (picked?.length) change(line.key, 'files', [...line.files, ...Array.from(picked)].slice(0, MAX_RECEIPTS))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setErrors({})
    const body = new FormData()
    body.append('title', title)
    body.append('lines', JSON.stringify(lines.map(({ date, category, amount, description }) => ({ date, category, amount, description }))))
    // Le même nom (receipt_<n°>) pour chaque fichier d'une ligne : Django les lit avec getlist.
    lines.forEach((line, index) => line.files.forEach((file) => body.append(`receipt_${index}`, file)))
    try {
      const response = await apiFetch('/api/expenses/mine/', { method: 'POST', body })
      const data = await response.json().catch(() => ({}))
      if (response.ok) {
        setSent(data)
        setTitle('')
        setLines([emptyLine()])
        onSent(data)
      } else if (response.status === 403 || response.status === 404) {
        setErrors({ detail: [data.detail ?? 'You cannot send an expense claim.'] })
      } else {
        // 400 : {"title": [...]}, {"lines": [...]}, {"line_0": [...]}, ou {"detail": "..."}.
        setErrors(Object.fromEntries(Object.entries(data).map(([key, value]) => [key, Array.isArray(value) ? value.map(String) : [String(value)]])))
      }
    } catch {
      setErrors({ detail: ['Cannot reach the server. Please try again later.'] })
    }
    setBusy(false)
  }

  return <form onSubmit={submit} className="rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    {!inPanel && <header className="border-b border-slate-100 px-4 py-3">
      <h2 className="text-sm font-semibold text-[#192646]">New expense claim</h2>
      <p className="text-[11px] text-slate-500">
        One line per expense (one day, one trip, one night), with its receipts (e.g. the invoice and the card slip). Your N+1 validates, then HR is informed.
        {scale && <> Your grade: <b className="font-semibold text-slate-700">{scale.grade_label}</b>.</>}
      </p>
    </header>}

    <div className="flex flex-col gap-3 p-4">
      <div>
        <label htmlFor="claim-title" className="block text-xs font-semibold text-slate-700">Purpose <span className="text-red-500" aria-hidden>*</span></label>
        <input id="claim-title" required value={title} maxLength={150} placeholder="e.g. Mission Agadir, client visit..."
          onChange={(e) => { setTitle(e.target.value); setErrors({}) }} className={controlClass} />
        {errors.title && <p className="mt-1 text-[11px] font-medium text-red-600">{errors.title[0]}</p>}
      </div>

      {lines.map((line, index) => {
        const category = categories.find((c) => String(c.id) === line.category)
        const ceiling = ceilingOf(scale, category)
        const over = ceiling !== null && Number(line.amount) > ceiling
        const tooHigh = Number(line.amount) > MAX_AMOUNT
        const lineErrors = errors[`line_${index}`]
        return <fieldset key={line.key} className={cn('rounded-lg border p-3', lineErrors ? 'border-red-200 bg-red-50/30' : 'border-slate-200')}>
          <legend className="px-1 text-[11px] font-semibold text-slate-500">Expense {index + 1}</legend>
          <div className="grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)_110px]">
            <div>
              <label htmlFor={`date-${line.key}`} className="sr-only">Date</label>
              <DatePicker id={`date-${line.key}`} required max={today} value={line.date}
                onChange={(value) => change(line.key, 'date', value)} className="mt-0" />
            </div>
            <div>
              <label htmlFor={`category-${line.key}`} className="sr-only">Category</label>
              <select id={`category-${line.key}`} required value={line.category} onChange={(e) => change(line.key, 'category', e.target.value)}
                className={cn(controlClass, 'mt-0 px-2.5')}>
                <option value="">Category...</option>
                {categories.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor={`amount-${line.key}`} className="sr-only">Amount (MAD)</label>
              <input id={`amount-${line.key}`} type="number" required min="0.01" max={MAX_AMOUNT} step="0.01" placeholder="MAD" value={line.amount}
                aria-invalid={over || tooHigh || undefined} onChange={(e) => change(line.key, 'amount', e.target.value)} className={cn(controlClass, 'mt-0')} />
            </div>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <label htmlFor={`description-${line.key}`} className="sr-only">Detail</label>
            <input id={`description-${line.key}`} value={line.description} maxLength={200} placeholder="Detail (e.g. Taxi airport → hotel)"
              onChange={(e) => change(line.key, 'description', e.target.value)} className={cn(controlClass, 'mt-0')} />
            <div className="flex items-center gap-1">
              {/* Les justificatifs : un vrai <input type="file" multiple> caché derrière un bouton lisible.
                  Vidé après chaque choix : on peut rechoisir le même fichier après l'avoir retiré. */}
              <label htmlFor={`receipt-${line.key}`} aria-disabled={line.files.length >= MAX_RECEIPTS || undefined}
                className={cn('flex h-10 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold',
                  line.files.length >= MAX_RECEIPTS ? 'cursor-not-allowed border-slate-200 text-slate-400'
                    : 'cursor-pointer border-slate-200 bg-white text-slate-600 hover:border-[#23355d]/40 hover:text-[#23355d]')}>
                {line.files.length ? <Plus className="size-3.5" /> : <Paperclip className="size-3.5" />}
                {line.files.length ? 'Add a file' : `Receipt${category?.receipt_required === false ? ' (optional)' : ''}`}
              </label>
              <input id={`receipt-${line.key}`} type="file" multiple accept=".pdf,.jpg,.jpeg,.png" className="sr-only"
                disabled={line.files.length >= MAX_RECEIPTS}
                onChange={(e) => { addFiles(line, e.target.files); e.target.value = '' }} />
              {lines.length > 1 && <button type="button" aria-label={`Remove expense ${index + 1}`}
                onClick={() => setLines((old) => old.filter((l) => l.key !== line.key))}
                className="rounded-md p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="size-4" /></button>}
            </div>
          </div>
          {/* Les fichiers choisis : une puce par fichier, avec une croix pour le retirer. */}
          {line.files.length > 0 && <ul aria-label={`Receipts of expense ${index + 1}`} className="mt-2 flex flex-wrap items-center gap-1.5">
            {line.files.map((file, position) => <li key={`${file.name}-${position}`}
              className="flex max-w-full items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 py-1 pl-2.5 pr-1 text-[11px] font-medium text-emerald-800">
              <FileText className="size-3 shrink-0" aria-hidden />
              <span className="max-w-44 truncate" title={file.name}>{file.name}</span>
              <button type="button" aria-label={`Remove ${file.name}`}
                onClick={() => change(line.key, 'files', line.files.filter((_, other) => other !== position))}
                className="rounded-full p-0.5 text-emerald-700 hover:bg-emerald-100"><X className="size-3" /></button>
            </li>)}
            <li className="text-[11px] text-slate-400">{line.files.length} / {MAX_RECEIPTS}</li>
          </ul>}
          {/* L'aide du barème (le plafond de MON grade), puis les messages de Django pour cette ligne. */}
          {tooHigh && <p className="mt-1.5 text-[11px] font-medium text-red-600">
            Too high: at most {formatMad(MAX_AMOUNT)} per expense (check the amount).
          </p>}
          {ceiling !== null && !tooHigh && <p className={cn('mt-1.5 text-[11px]', over ? 'font-medium text-red-600' : 'text-slate-500')}>
            Max for your grade: {formatMad(ceiling)} {PER[category!.ceiling]}{over ? ' — this amount is above.' : '.'}
          </p>}
          {lineErrors?.map((message) => <p key={message} role="alert" className="mt-1 text-[11px] font-medium text-red-600">{message}</p>)}
        </fieldset>
      })}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" disabled={lines.length >= MAX_LINES} onClick={() => setLines((old) => [...old, emptyLine()])}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-[#23355d] hover:bg-slate-50 disabled:opacity-50">
          <Plus className="size-3.5" /> Add an expense
        </button>
        <p className="text-sm text-slate-600">Total: <b className="font-semibold tabular-nums text-[#192646]">{formatMad(total)}</b></p>
      </div>
    </div>

    <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 px-4 py-3">
      {(errors.detail || errors.lines) && <p role="alert" className="mr-auto text-xs font-medium text-red-600">{(errors.detail ?? errors.lines)[0]}</p>}
      {sent && <p role="status" className="mr-auto flex items-center gap-1.5 text-xs font-medium text-emerald-700">
        <CheckCircle2 className="size-4" /> Sent: {formatMad(sent.total)}. {sent.waiting_for ? `Waiting for ${sent.waiting_for}.` : ''}
      </p>}
      <button type="submit" disabled={busy}
        className="flex items-center gap-1.5 rounded-lg bg-[#192646] px-4 py-2 text-xs font-semibold text-white hover:bg-[#23355d] disabled:opacity-50">
        {busy && <Loader2 className="size-3.5 animate-spin" />} Send the claim
      </button>
    </footer>
  </form>
}
