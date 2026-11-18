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
import { MAX_RECEIPTS, formatMad, type Currency, type ExpenseCategory, type ExpenseClaim } from '@/lib/expenses'
import { isoDate } from '@/lib/leaves'
import { cn } from '@/lib/utils'
import { controlClass } from '@/components/employees/form-fields'
import { DatePicker } from '@/components/ui/date-picker'

// justification : seulement quand la dépense dépasse le plafond ET qu'Admin RH le permet pour sa catégorie.
// currency : la devise du REÇU (id ; '' = MAD, le défaut) ; amount = le montant du reçu.
type Line = { key: number; date: string; category: string; amount: string; currency: string; description: string; justification: string; files: File[] }

let nextKey = 1
const emptyLine = (): Line => ({ key: nextKey++, date: '', category: '', amount: '', currency: '', description: '', justification: '', files: [] })
const MAX_LINES = 20
const MAX_RECEIPT_SIZE = 5 * 1024 * 1024  // le même maximum que Django (5 Mo par justificatif)
// Le même maximum que Django (MAX_LINE_AMOUNT) : une sécurité contre un zéro de trop.
const MAX_AMOUNT = 100000

// L'unité du plafond d'une catégorie (une ligne = une dépense / un jour / un trajet / une nuit).
const PER: Record<string, string> = { EXPENSE: 'per expense', DAY: 'per day', TRIP: 'per trip', NIGHT: 'per night' }

// inPanel : le formulaire est dans le panneau "New expense claim" (le panneau a déjà le titre et l'aide).
export function ClaimForm({ categories, grade, currencies = [], onSent, inPanel = false }: {
  categories: ExpenseCategory[]; grade: string | null; currencies?: Currency[]; onSent: (claim: ExpenseClaim) => void; inPanel?: boolean
}) {
  const [title, setTitle] = useState('')
  const [lines, setLines] = useState<Line[]>(() => [emptyLine()])
  const [errors, setErrors] = useState<Record<string, string[]>>({})
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<ExpenseClaim | null>(null)
  const today = isoDate(new Date())
  // Les devises autres que le MAD (le MAD = la valeur vide de la liste, le défaut).
  const foreign = currencies.filter((currency) => currency.name !== 'MAD')
  const currencyOf = (line: Line) => foreign.find((currency) => String(currency.id) === line.currency)
  // Le montant en MAD d'une ligne (un aperçu : Django refait le calcul avec le taux du jour à l'envoi).
  const madOf = (line: Line) => {
    const currency = currencyOf(line)
    const amount = Number(line.amount) || 0
    return currency ? Math.round(amount * currency.rate_to_mad * 100) / 100 : amount
  }
  const total = lines.reduce((sum, line) => sum + madOf(line), 0)
  // Le maximum de chaque ligne (2026-11-18, la même règle que Django) : "par jour" / "par nuit" = le TOTAL de la
  // catégorie ce jour-là, "par trajet" = toute la mission, "par dépense" = la ligne seule. before = ce que les lignes
  // précédentes du même groupe ont déjà pris.
  const used: Record<string, number> = {}
  const limits = lines.map((line) => {
    const category = categories.find((c) => String(c.id) === line.category)
    const max = category?.my_ceiling ?? null
    if (!category || max === null) return null
    if (category.per === 'EXPENSE') return { max, before: 0 }
    const key = category.per === 'TRIP' ? `${category.id}` : `${category.id}-${line.date}`
    const before = used[key] ?? 0
    used[key] = before + madOf(line)
    return { max, before }
  })
  const WHEN: Record<string, string> = { DAY: 'on this day', NIGHT: 'for this night', TRIP: 'on this mission' }

  function change(key: number, field: keyof Line, value: string | File[]) {
    setLines((old) => old.map((line) => (line.key === key ? { ...line, [field]: value } : line)))
    setErrors({})
    setSent(null)
  }

  // Les fichiers choisis s'AJOUTENT à ceux de la ligne (on peut cliquer "Add" plusieurs fois), au plus 5.
  // Refusés tout de suite (2026-11-18, standard) : un format autre que PDF / JPG / PNG, ou plus de 5 Mo.
  function addFiles(line: Line, picked: FileList | null) {
    if (!picked?.length) return
    const files = Array.from(picked)
    const wrong = files.find((file) => !/\.(pdf|jpe?g|png)$/i.test(file.name) || file.size > MAX_RECEIPT_SIZE)
    if (wrong) {
      setErrors({ [`line_${lines.indexOf(line)}`]: [`${wrong.name}: only PDF, JPG or PNG, 5 MB max each.`] })
      return
    }
    change(line.key, 'files', [...line.files, ...files].slice(0, MAX_RECEIPTS))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setErrors({})
    const body = new FormData()
    body.append('title', title)
    body.append('lines', JSON.stringify(lines.map(({ date, category, amount, currency, description, justification }) =>
      ({ date, category, amount, currency: currency || null, description, justification }))))
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
        One line per expense (one day, one trip, one night), with its receipts (e.g. the invoice and the card slip). Your N+1 validates, then HR checks it.
        {grade && <> Your grade: <b className="font-semibold text-slate-700">{grade}</b>.</>}
      </p>
    </header>}

    <div className="flex flex-col gap-3 p-4">
      {/* La règle de l'entreprise (comme leur outil actuel, demandé par les RH le 2026-11-16). */}
      <p className="rounded-lg border border-red-100 bg-red-50/60 px-3 py-2 text-[11px] font-medium text-red-700">
        Expense claims must be submitted by the 10th of the following month at the latest.
      </p>
      <div>
        <label htmlFor="claim-title" className="block text-xs font-semibold text-slate-700">Purpose <span className="text-red-500" aria-hidden>*</span></label>
        <input id="claim-title" required value={title} maxLength={150} placeholder="e.g. Mission Agadir, client visit..."
          onChange={(e) => { setTitle(e.target.value); setErrors({}) }} className={controlClass} />
        {errors.title && <p className="mt-1 text-[11px] font-medium text-red-600">{errors.title[0]}</p>}
      </div>

      {lines.map((line, index) => {
        const category = categories.find((c) => String(c.id) === line.category)
        const limit = limits[index]  // le maximum de MON grade, et ce que les lignes d'avant en ont déjà pris
        const ceiling = limit ? limit.max : null
        const room = limit ? Math.max(limit.max - limit.before, 0) : null  // ce qui reste pour cette ligne
        const currency = currencyOf(line)
        const mad = madOf(line)  // le plafond se compare en MAD
        const over = room !== null && mad > room
        // Au-dessus du plafond, mais permis par Admin RH pour cette catégorie : on demande pourquoi (orange, pas rouge).
        const allowed = over && Boolean(category?.above_ceiling_allowed)
        const tooHigh = mad > MAX_AMOUNT
        const lineErrors = errors[`line_${index}`]
        return <fieldset key={line.key} className={cn('rounded-lg border p-3', lineErrors ? 'border-red-200 bg-red-50/30' : 'border-slate-200')}>
          <legend className="px-1 text-[11px] font-semibold text-slate-500">Expense {index + 1}</legend>
          <div className={cn('grid gap-2', foreign.length ? 'sm:grid-cols-[150px_minmax(0,1fr)_100px_80px]' : 'sm:grid-cols-[150px_minmax(0,1fr)_110px]')}>
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
              <input id={`amount-${line.key}`} type="number" required min="0.01" max={MAX_AMOUNT} step="0.01" placeholder={currency?.name ?? 'MAD'} value={line.amount}
                aria-invalid={(over && !allowed) || tooHigh || undefined} onChange={(e) => change(line.key, 'amount', e.target.value)} className={cn(controlClass, 'mt-0')} />
            </div>
            {/* La devise du reçu (MAD par défaut), comme l'outil NOOR des RH. */}
            {foreign.length > 0 && <div>
              <label htmlFor={`currency-${line.key}`} className="sr-only">Currency</label>
              <select id={`currency-${line.key}`} value={line.currency} onChange={(e) => change(line.key, 'currency', e.target.value)}
                className={cn(controlClass, 'mt-0 px-2')}>
                <option value="">MAD</option>
                {foreign.map((option) => <option key={option.id} value={String(option.id)}>{option.name}</option>)}
              </select>
            </div>}
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
          {/* Ce qui est accepté, écrit sous le bouton (standard : Concur, Expensify, Gmail). */}
          <p className="mt-1 text-[11px] text-slate-400">Receipts: PDF, JPG or PNG · 5 MB max each · up to {MAX_RECEIPTS} files (e.g. the invoice and the card slip).</p>
          {/* Une autre devise : la conversion en MAD, au taux du jour. */}
          {currency && Number(line.amount) > 0 && <p className="mt-1.5 text-[11px] text-slate-600">
            {line.amount} {currency.name} × {currency.rate_to_mad.toLocaleString('fr-FR')} = <b className="font-semibold text-[#192646]">{formatMad(mad)}</b>
            <span className="text-slate-400"> (rate of the day)</span>
          </p>}
          {/* L'aide du barème (le plafond de MON grade), puis les messages de Django pour cette ligne. */}
          {tooHigh && <p className="mt-1.5 text-[11px] font-medium text-red-600">
            Too high: at most {formatMad(MAX_AMOUNT)} per expense (check the amount).
          </p>}
          {ceiling !== null && !tooHigh && !allowed && <p className={cn('mt-1.5 text-[11px]', over ? 'font-medium text-red-600' : 'text-slate-500')}>
            Max for your grade: {formatMad(ceiling)} {PER[category!.per]}
            {limit && limit.before > 0 ? ` (already ${formatMad(limit.before)} ${WHEN[category!.per]}: ${formatMad(room ?? 0)} left)` : ''}
            {over ? ' — this amount is above.' : '.'}
          </p>}
          {/* Le dépassement permis : la raison est obligatoire, le N+1 et les RH la lisent avant de décider. */}
          {allowed && !tooHigh && <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/60 p-2.5">
            <label htmlFor={`justification-${line.key}`} className="block text-[11px] font-semibold text-amber-800">
              Above your maximum ({formatMad(ceiling!)} {PER[category!.per]}) by {formatMad(mad - (room ?? 0))}: why? <span className="text-red-500" aria-hidden>*</span>
            </label>
            <input id={`justification-${line.key}`} required value={line.justification} maxLength={300}
              placeholder="e.g. Only hotel available during the festival"
              onChange={(e) => change(line.key, 'justification', e.target.value)} className={cn(controlClass, 'mt-1 bg-white')} />
            <p className="mt-1 text-[11px] text-amber-700">Your N+1 and HR see it and decide.</p>
          </div>}
          {lineErrors?.map((message) => <p key={message} role="alert" className="mt-1 text-[11px] font-medium text-red-600">{message}</p>)}
        </fieldset>
      })}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" disabled={lines.length >= MAX_LINES} onClick={() => setLines((old) => [...old, emptyLine()])}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-[#23355d] hover:bg-slate-50 disabled:opacity-50">
          <Plus className="size-3.5" /> Add an expense
        </button>
        <p className="text-sm text-slate-600">Total to reimburse: <b className="font-semibold tabular-nums text-[#192646]">{formatMad(total)}</b></p>
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
