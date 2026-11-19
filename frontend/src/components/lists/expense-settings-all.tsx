'use client'

/*
 * "Réglages des notes de frais" : TOUT au même endroit (2026-11-18, l'utilisatrice était perdue entre 4 pages), en
 * 3 questions numérotées :
 *   ① Categories and ceilings : UN tableau, une ligne par catégorie, une colonne par grade (le plafond en MAD ; vide =
 *      pas de plafond pour ce grade), l'unité (par dépense / jour / trajet / nuit), justificatif obligatoire, dépassement
 *      permis avec une raison (standard SAP Concur : une limite par type de dépense et par groupe d'employés) ;
 *   ② Currencies : les devises (une liste à choisir), leur taux mis à jour tout seul chaque matin, ou tapé à la main ;
 *   ③ Who can correct an amount : le N+1 et les RH / les RH / personne.
 * Chaque changement est enregistré tout de suite (sauf ③ : son bouton Save). Rien n'est supprimé : on désactive.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Coins, Loader2, Pencil, Plus, ReceiptText } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import { sendChange } from '@/lib/workflows'
import { controlClass } from '@/components/employees/form-fields'
import { formatDateTime } from '@/components/employees/history-changes'
import { actionClass } from '@/components/expenses/claim-actions'
import { SidePanel } from '@/components/ui/side-panel'
import { ExpenseSettingsPanel } from './expense-settings-panel'
import { SettingsTabs } from './settings-tabs'

const API = '/api/expenses/lists'

// 2026-11-19 : en ONGLETS (settings-tabs.tsx, comme Réglages des congés et des documents) : une question à la fois.
export function ExpenseSettingsAll() {
  return <SettingsTabs title="Réglages des notes de frais" storageKey="expense-settings-tab"
    text="Everything about expense claims in one place. Choose a section."
    tabs={[
      { id: 'categories', label: 'Categories and ceilings', icon: ReceiptText, hint: 'What employees can claim, and the maximum of each grade.',
        content: <Card number={1} title="Categories and ceilings" text="What employees can claim, and up to how much for each grade. Click Edit to change a category.">
          <CategoriesAndCeilings />
        </Card> },
      { id: 'currencies', label: 'Currencies', icon: Coins, hint: 'The currencies of the receipts and their rate to MAD, updated every morning.',
        content: <Card number={2} title="Currencies" text="The employee types the amount of the receipt (e.g. 20 EUR); the app converts it to MAD with this rate, updated every morning.">
          <Currencies />
        </Card> },
      { id: 'correct', label: 'Who can change an amount', icon: Pencil, hint: 'Who may change an amount while validating a claim.',
        content: <Card number={3} title="Who can correct an amount?" text="While validating, change an amount (e.g. the receipt says 150, the line says 200), between 0 and what the employee asked. A reason is required; the employee is notified.">
          <ExpenseSettingsPanel embedded />
        </Card> },
    ]} />
}

function Card({ number, title, text, children }: { number: number; title: string; text: string; children: ReactNode }) {
  return <section className="min-w-0 rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <header className="flex gap-3 border-b border-slate-100 px-4 py-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#23355d] text-[11px] font-bold text-white">{number}</span>
      <div>
        <h2 className="text-sm font-semibold text-[#192646]">{title}</h2>
        <p className="text-[11px] text-slate-500">{text}</p>
      </div>
    </header>
    <div className="p-4">{children}</div>
  </section>
}

/** Une liste (catégories, devises) : lire tout (actifs et désactivés), changer une ligne, en ajouter une. */
function useList<T extends { id: number; name: string }>(name: string) {
  const [items, setItems] = useState<T[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    apiFetch(`${API}/${name}/?all=1`)
      .then(async (response) => {
        if (!response.ok) throw new Error()
        setItems(await response.json())
      })
      // (2026-11-18 : une liste vide sans rien dire, pendant un redémarrage du serveur : on le dit.)
      .catch(() => { setItems([]); setError('Could not load this list: refresh the page.') })
  }, [name])

  async function change(item: T, values: Partial<T>) {
    setError('')
    const result = await sendChange<T>(() => apiFetch(`${API}/${name}/${item.id}/`, { method: 'PATCH', body: JSON.stringify(values) }),
      'Only Admin RH can change this.')
    if ('error' in result) return setError(`${item.name}: ${result.error}`)
    setItems((old) => old && old.map((other) => (other.id === item.id ? result.data : other)))
  }

  async function add(values: Record<string, unknown>) {
    setError('')
    const result = await sendChange<T>(() => apiFetch(`${API}/${name}/`, { method: 'POST', body: JSON.stringify(values) }),
      'Only Admin RH can change this.')
    if ('error' in result) { setError(result.error); return false }
    setItems((old) => [...(old ?? []), result.data].sort((a, b) => a.name.localeCompare(b.name)))
    return true
  }

  return { items, setItems, error, setError, change, add }
}

type Category = { id: number; name: string; is_active: boolean; per: string; receipt_required: boolean; above_ceiling_allowed: boolean }
type Grade = { id: number; name: string }
type Cell = { category: number; grade: number; amount: number | null }
const PER = [
  { id: 'EXPENSE', name: 'per expense' },
  { id: 'DAY', name: 'per day' },
  { id: 'TRIP', name: 'per trip' },
  { id: 'NIGHT', name: 'per night' },
]
// "Grade A — Direction" -> "Grade A" (court, dans la liste) ; le nom complet dans le panneau.
const shortGrade = (name: string) => name.split('—')[0].trim()

// ① La liste des catégories (2026-11-18, 2e version : le grand tableau à cases était "difficile, pas clair") : une ligne
// lisible par catégorie (ses plafonds en résumé, ses règles en puces), et "Edit" ouvre un panneau avec un petit
// formulaire clair. "+ Add a category" ouvre le même panneau, vide.
function CategoriesAndCeilings() {
  const { items, setItems, error } = useList<Category>('categories')
  const [grades, setGrades] = useState<Grade[]>([])
  const [ceilings, setCeilings] = useState<Record<string, number>>({})  // "categorie-grade" -> montant
  const [open, setOpen] = useState<Category | 'new' | null>(null)

  const loadCeilings = () => apiFetch('/api/expenses/ceilings/')
    .then(async (response) => {
      if (!response.ok) return
      const data: { grades: Grade[]; ceilings: Cell[] } = await response.json()
      setGrades(data.grades)
      setCeilings(Object.fromEntries(data.ceilings.map((cell) => [`${cell.category}-${cell.grade}`, cell.amount ?? 0])))
    })
    .catch(() => {})
  useEffect(() => { loadCeilings() }, [])

  if (items === null) return <p className="text-[11px] text-slate-400">Loading...</p>
  // (3e version, 2026-11-18 : l'utilisatrice préférait le TABLEAU, mais sans cases à remplir : un tableau à LIRE,
  // les montants en texte, "Edit" ouvre le panneau pour changer une catégorie.)
  const amount = (category: number, grade: number) => ceilings[`${category}-${grade}`]
  return <div className="flex flex-col gap-2">
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[720px] text-xs">
        <thead className="bg-slate-50/80">
          <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            <th className="px-3 py-2.5">Category</th>
            <th className="px-3 py-2.5">Maximum</th>
            {grades.map((grade) => <th key={grade.id} className="px-2 py-2.5 text-right" title={grade.name}>{shortGrade(grade.name)}</th>)}
            <th className="px-3 py-2.5 text-center">Receipt</th>
            <th className="px-3 py-2.5 text-center">Can pass</th>
            <th className="px-3 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const limited = grades.some((grade) => amount(item.id, grade.id) !== undefined)
            return <tr key={item.id} className={cn('border-t border-slate-100 hover:bg-slate-50/60', !item.is_active && 'opacity-50')}>
              <td className="px-3 py-2.5 font-semibold text-[#192646]">
                {item.name}{!item.is_active && <span className="ml-2 text-[10px] font-semibold text-slate-500">Inactive</span>}
              </td>
              <td className="px-3 py-2.5 text-slate-500">{limited ? PER.find((option) => option.id === item.per)?.name : 'No maximum'}</td>
              {grades.map((grade) => {
                const value = amount(item.id, grade.id)
                return <td key={grade.id} className={cn('px-2 py-2.5 text-right tabular-nums', value === undefined ? 'text-slate-300' : 'font-medium text-slate-700')}>
                  {value === undefined ? '—' : value.toLocaleString('fr-FR')}
                </td>
              })}
              <td className="px-3 py-2.5 text-center">{item.receipt_required ? <span className="font-semibold text-[#23355d]">✓</span> : <span className="text-slate-300">—</span>}</td>
              <td className="px-3 py-2.5 text-center">{item.above_ceiling_allowed && limited ? <span className="font-semibold text-amber-600">✓</span> : <span className="text-slate-300">—</span>}</td>
              <td className="px-3 py-2.5 text-right"><button type="button" onClick={() => setOpen(item)} className={actionClass}>Edit</button></td>
            </tr>
          })}
        </tbody>
      </table>
    </div>
    {/* La légende (règle "Don't Make Me Think", 2026-11-18) : ce que veut dire chaque colonne. */}
    <ul className="grid gap-x-6 gap-y-0.5 text-[11px] text-slate-500 sm:grid-cols-2">
      <li><b className="text-slate-600">Amounts</b> in MAD, by grade · <b className="text-slate-600">—</b> = no maximum</li>
      <li><b className="text-slate-600">Maximum per day</b> = the total of the day · <b className="text-slate-600">per night</b> = each night ·
        <b className="text-slate-600"> per trip</b> = the whole mission · <b className="text-slate-600">per expense</b> = each receipt</li>
      <li><b className="text-slate-600">Receipt ✓</b> = the expense cannot be sent without a receipt (photo or PDF)</li>
      <li><b className="text-slate-600">Can pass ✓</b> = the employee may go above the maximum if he writes why (the N+1 and HR see it and decide)</li>
    </ul>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => setOpen('new')} className={cn(actionClass, 'bg-[#23355d] text-white hover:bg-[#192646]')}>
        <Plus className="size-3.5" /> Add a category
      </button>
      {error && <p role="alert" className="text-[11px] font-medium text-red-600">{error}</p>}
    </div>
    <SidePanel open={open !== null} onClose={() => setOpen(null)} width={560}
      title={open === 'new' ? 'New category' : open ? open.name : ''} description="What employees can claim, and up to how much.">
      {open && <CategoryForm key={open === 'new' ? 'new' : open.id} category={open === 'new' ? null : open} grades={grades} ceilings={ceilings}
        onSaved={(saved) => {
          setItems((old) => {
            const others = (old ?? []).filter((item) => item.id !== saved.id)
            return [...others, saved].sort((a, b) => a.name.localeCompare(b.name))
          })
          loadCeilings()
          setOpen(null)
        }} />}
    </SidePanel>
  </div>
}

/** Le formulaire d'une catégorie : son nom, a-t-elle un plafond (et combien pour chaque grade), justificatif, dépassement. */
function CategoryForm({ category, grades, ceilings, onSaved }: {
  category: Category | null; grades: Grade[]; ceilings: Record<string, number>; onSaved: (saved: Category) => void
}) {
  const start = (grade: number) => (category && ceilings[`${category.id}-${grade}`] !== undefined ? String(ceilings[`${category.id}-${grade}`]) : '')
  const [name, setName] = useState(category?.name ?? '')
  const [limited, setLimited] = useState(category ? grades.some((grade) => start(grade.id) !== '') : false)
  const [per, setPer] = useState(category?.per ?? 'EXPENSE')
  const [amounts, setAmounts] = useState<Record<number, string>>(() => Object.fromEntries(grades.map((grade) => [grade.id, start(grade.id)])))
  const [receipt, setReceipt] = useState(category?.receipt_required ?? false)
  const [canPass, setCanPass] = useState(category?.above_ceiling_allowed ?? false)
  const [active, setActive] = useState(category?.is_active ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const values = { name: name.trim(), per, receipt_required: receipt, above_ceiling_allowed: limited && canPass, is_active: active }
    const saved = await sendChange<Category>(() => apiFetch(category ? `${API}/categories/${category.id}/` : `${API}/categories/`,
      { method: category ? 'PATCH' : 'POST', body: JSON.stringify(values) }), 'Only Admin RH can change this.')
    if ('error' in saved) { setBusy(false); return setError(saved.error) }
    // Les plafonds qui ont changé (sans plafond : tous enlevés).
    for (const grade of grades) {
      const wanted = limited ? (amounts[grade.id] ?? '').trim() : ''
      if (wanted === start(grade.id)) continue
      const result = await sendChange(() => apiFetch('/api/expenses/ceilings/', {
        method: 'POST', body: JSON.stringify({ category: saved.data.id, grade: grade.id, amount: wanted }) }), 'Only Admin RH can change the ceilings.')
      if ('error' in result) { setBusy(false); return setError(`${grade.name}: ${result.error}`) }
    }
    setBusy(false)
    onSaved(saved.data)
  }

  const choice = (selected: boolean) => cn('flex cursor-pointer gap-2 rounded-lg border px-3 py-2 text-xs',
    selected ? 'border-[#23355d] bg-[#E4E9F2]/50 ring-1 ring-[#23355d]' : 'border-slate-200 hover:border-slate-300')
  return <form onSubmit={save} className="flex flex-col gap-4">
    <div>
      <label htmlFor="category-name" className="text-xs font-semibold text-slate-700">Name</label>
      <input id="category-name" required value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="e.g. Parking" className={controlClass} />
    </div>

    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-xs font-semibold text-slate-700">Maximum amount</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={choice(!limited)}><input type="radio" checked={!limited} onChange={() => setLimited(false)} className="mt-0.5 accent-[#192646]" />
          <span><b className="block text-[#192646]">No maximum</b><span className="text-[11px] text-slate-500">Any amount (e.g. a plane ticket).</span></span></label>
        <label className={choice(limited)}><input type="radio" checked={limited} onChange={() => setLimited(true)} className="mt-0.5 accent-[#192646]" />
          <span><b className="block text-[#192646]">A maximum per grade</b><span className="text-[11px] text-slate-500">E.g. Grade E: at most 400 MAD per night.</span></span></label>
      </div>
      {limited && <div className="rounded-lg border border-slate-200 p-3">
        {/* (2026-11-18 : "One line of the claim = one expense" n'était pas compris.) */}
        <label className="flex flex-wrap items-center gap-2 text-xs text-slate-700">Maximum
          <select value={per} onChange={(e) => setPer(e.target.value)} className={cn(controlClass, 'mt-0 h-8 w-36 px-2 text-xs')}>
            {PER.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </label>
        <p className="mt-1 text-[11px] text-slate-500">
          Per day = the TOTAL of all the expenses of this category on the same day (e.g. 3 taxis: 100 + 120 + 80 = 300).
          Per night = each night. Per trip = the total of the whole mission. Per expense = each receipt on its own.
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {grades.map((grade) => <li key={grade.id} className="flex items-center gap-3 text-xs">
            <label htmlFor={`ceiling-${grade.id}`} className="min-w-0 flex-1 text-slate-700">{grade.name}</label>
            <input id={`ceiling-${grade.id}`} type="number" min="0.01" step="0.01" value={amounts[grade.id] ?? ''} placeholder="No ceiling"
              onChange={(e) => setAmounts((old) => ({ ...old, [grade.id]: e.target.value }))} className={cn(controlClass, 'mt-0 h-8 w-32 text-right')} />
            <span className="w-8 text-slate-400">MAD</span>
          </li>)}
        </ul>
        <p className="mt-2 text-[11px] text-slate-500">Empty = no ceiling for that grade.</p>
        <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs">
          <input type="checkbox" checked={canPass} onChange={(e) => setCanPass(e.target.checked)} className="mt-0.5 accent-[#192646]" />
          <span><b className="text-[#192646]">Can pass the ceiling with a reason</b>
            <span className="block text-[11px] text-slate-500">The employee writes why; the N+1 and HR see it in orange and decide. Otherwise the line is refused.</span></span>
        </label>
      </div>}
    </fieldset>

    <label className="flex cursor-pointer items-start gap-2 text-xs">
      <input type="checkbox" checked={receipt} onChange={(e) => setReceipt(e.target.checked)} className="mt-0.5 accent-[#192646]" />
      <span><b className="text-[#192646]">Receipt required</b><span className="block text-[11px] text-slate-500">A line of this category cannot be sent without a receipt.</span></span>
    </label>

    <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
      {category && <button type="button" onClick={() => setActive((old) => !old)}
        className={cn('text-[11px] font-semibold hover:underline', active ? 'text-red-600' : 'text-emerald-700')}>
        {active ? 'Deactivate this category' : 'Reactivate this category'}
      </button>}
      {category && active !== category.is_active && <span className="text-[11px] text-slate-500">(on Save)</span>}
      {error && <p role="alert" className="text-xs font-medium text-red-600">{error}</p>}
      <button type="submit" disabled={busy || !name.trim()}
        className="ml-auto flex items-center gap-1.5 rounded-lg bg-[#23355d] px-4 py-2 text-xs font-semibold text-white hover:bg-[#192646] disabled:opacity-50">
        {busy && <Loader2 className="size-3.5 animate-spin" />} Save
      </button>
    </div>
  </form>
}

type Currency = { id: number; name: string; is_active: boolean; rate_to_mad: string; automatic: boolean; rate_updated_at: string | null }

// Les devises qu'on peut ajouter (les plus courantes pour un voyage depuis le Maroc).
const KNOWN = [
  ['EUR', 'Euro'], ['USD', 'US dollar'], ['GBP', 'British pound'], ['CHF', 'Swiss franc'], ['CAD', 'Canadian dollar'],
  ['AED', 'Emirati dirham'], ['SAR', 'Saudi riyal'], ['QAR', 'Qatari riyal'], ['TRY', 'Turkish lira'], ['EGP', 'Egyptian pound'],
  ['TND', 'Tunisian dinar'], ['DZD', 'Algerian dinar'], ['XOF', 'CFA franc (West Africa)'], ['CNY', 'Chinese yuan'], ['JPY', 'Japanese yen'],
]

// ② Les devises : le taux (1 EUR = ... MAD), "Automatic" (chaque matin), désactiver ; le MAD vaut toujours 1.
function Currencies() {
  const { items, setItems, error, change, add } = useList<Currency>('currencies')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    if (await add({ name: code, rate_to_mad: '1', automatic: true })) {
      setCode('')
      // Django cherche son taux tout de suite : la liste est relue pour l'afficher.
      const response = await apiFetch(`${API}/currencies/?all=1`).catch(() => null)
      if (response?.ok) setItems(await response.json())
    }
    setBusy(false)
  }

  if (items === null) return <p className="text-[11px] text-slate-400">Loading...</p>
  const present = new Set(items.map((item) => item.name.toUpperCase()))
  const label = (name: string) => KNOWN.find(([id]) => id === name.toUpperCase())?.[1]
  return <div className="flex flex-col gap-2">
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[560px] text-xs">
        <thead>
          <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            <th className="px-3 py-2">Currency</th><th className="px-3 py-2">1 unit = ... MAD</th><th className="px-3 py-2">Updated every morning</th>
            <th className="px-3 py-2">Last update</th><th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const mad = item.name.toUpperCase() === 'MAD'
            return <tr key={item.id} className={cn('border-t border-slate-100', !item.is_active && 'opacity-50')}>
              <td className="px-3 py-2"><span className="font-semibold text-[#192646]">{item.name}</span>
                {label(item.name) && <span className="ml-1.5 text-slate-500">{label(item.name)}</span>}{mad && <span className="ml-1.5 text-slate-500">Moroccan dirham</span>}</td>
              <td className="px-3 py-2">{mad ? '1' : <RateInput item={item} onSave={(value) => change(item, { rate_to_mad: value, automatic: false })} />}</td>
              <td className="px-3 py-2">{!mad && <input type="checkbox" checked={item.automatic} aria-label={`${item.name} updated automatically`}
                onChange={(e) => change(item, { automatic: e.target.checked })} className="size-4 accent-[#192646]" />}</td>
              <td className="px-3 py-2 text-[11px] text-slate-500">{mad ? '—' : item.rate_updated_at ? formatDateTime(item.rate_updated_at) : 'by hand'}</td>
              <td className="px-3 py-2 text-right">{!mad && <button type="button" onClick={() => change(item, { is_active: !item.is_active })} className={actionClass}>
                {item.is_active ? 'Deactivate' : 'Reactivate'}
              </button>}</td>
            </tr>
          })}
        </tbody>
      </table>
    </div>
    <p className="text-[11px] text-slate-500">Typing a rate yourself turns &ldquo;Updated every morning&rdquo; off for that currency (the app keeps your rate).</p>
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <label htmlFor="new-currency" className="text-xs font-semibold text-slate-700">Add a currency</label>
      <select id="new-currency" value={code} onChange={(e) => setCode(e.target.value)} className={cn(controlClass, 'mt-0 h-8 w-60 px-2 text-xs')}>
        <option value="">Choose...</option>
        {KNOWN.filter(([id]) => !present.has(id)).map(([id, name]) => <option key={id} value={id}>{name} ({id})</option>)}
      </select>
      <button type="submit" disabled={busy || !code} className={cn(actionClass, 'bg-[#23355d] text-white hover:bg-[#192646] disabled:opacity-50')}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Add
      </button>
      <span className="text-[11px] text-slate-400">Its rate is taken from the internet at once.</span>
      {error && <p role="alert" className="w-full text-[11px] font-medium text-red-600">{error}</p>}
    </form>
  </div>
}

/** Le taux d'une devise : enregistré en quittant le champ (ou Entrée), seulement s'il a changé. */
function RateInput({ item, onSave }: { item: Currency; onSave: (value: string) => void }) {
  const [value, setValue] = useState(String(Number(item.rate_to_mad)))
  const save = () => { if (Number(value) > 0 && Number(value) !== Number(item.rate_to_mad)) onSave(value) }
  return <input type="number" min="0.0001" step="0.0001" value={value} aria-label={`Rate of ${item.name}`}
    onChange={(e) => setValue(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') save() }}
    className={cn(controlClass, 'mt-0 h-8 w-28')} />
}
