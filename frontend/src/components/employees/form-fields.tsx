'use client'

/*
 * Les petits morceaux du formulaire : un champ = un libellé + le contrôle + son erreur.
 * Même style que les pages de connexion (gris clair, bleu SBD au focus).
 */
import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { ReferenceItem } from '@/lib/employees'
import { controlClass } from '@/components/ui/control-class'
import { DatePicker } from '@/components/ui/date-picker'

export { controlClass }

type FieldProps = {
  id: string
  label: string
  required?: boolean
  error?: string       // le message renvoyé par Django pour ce champ
  hint?: string        // une aide sous le champ
  className?: string
  children: ReactNode
}

export function Field({ id, label, required, error, hint, className, children }: FieldProps) {
  return <div className={className}>
    <label htmlFor={id} className="block text-xs font-semibold text-slate-700">
      {label}{required && <span className="text-red-500" aria-hidden> *</span>}
    </label>
    {children}
    {error
      ? <p id={`${id}-error`} className="mt-1 text-[11px] font-medium text-red-600">{error}</p>
      : hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
  </div>
}

type TextFieldProps = Omit<FieldProps, 'children'> & {
  value: string
  onChange: (value: string) => void
  type?: string
  placeholder?: string
  suggestions?: string[]  // des propositions pendant la frappe (ex. les villes), avec un <datalist>
  min?: string            // type "date" : la première / la dernière date possible ("AAAA-MM-JJ")
  max?: string
}

export function TextField({ value, onChange, type = 'text', placeholder, suggestions, min, max, ...field }: TextFieldProps) {
  // Une date : le calendrier de l'application (ui/date-picker), pas celui du navigateur.
  if (type === 'date') {
    return <Field {...field}>
      <DatePicker id={field.id} value={value} onChange={onChange} min={min} max={max} required={field.required}
        invalid={Boolean(field.error)} describedBy={field.error ? `${field.id}-error` : undefined} />
    </Field>
  }
  return <Field {...field}>
    <input
      id={field.id} type={type} value={value} placeholder={placeholder} required={field.required}
      list={suggestions ? `${field.id}-options` : undefined} autoComplete={suggestions ? 'off' : undefined}
      onChange={(e) => onChange(e.target.value)}
      aria-invalid={field.error ? true : undefined}
      aria-describedby={field.error ? `${field.id}-error` : undefined}
      className={controlClass}
    />
    {suggestions && <datalist id={`${field.id}-options`}>
      {suggestions.map((name) => <option key={name} value={name} />)}
    </datalist>}
  </Field>
}

type PhoneFieldProps = Omit<FieldProps, 'children'> & {
  value: string            // "+212612345678", ou '' si vide
  onChange: (value: string) => void
}

/** Un numéro marocain : "+212" est écrit d'avance, on tape seulement les 9 chiffres.
 *  Le 0 du début (0612...) et un indicatif collé (+212 / 00212) sont enlevés tout seuls.
 *  Django vérifie aussi le format (moroccan_phone) : son message s'affiche sous le champ. */
export function PhoneField({ value, onChange, ...field }: PhoneFieldProps) {
  function change(typed: string) {
    const digits = typed.replace(/\D/g, '').replace(/^(00212|212|0+)/, '').slice(0, 9)
    onChange(digits ? `+212${digits}` : '')
  }
  return <Field {...field}>
    <div className="mt-1.5 flex">
      <span className="flex h-10 items-center rounded-l-lg border border-r-0 border-slate-200 bg-slate-100 px-3 text-sm text-slate-500">+212</span>
      <input
        id={field.id} type="tel" inputMode="numeric" value={value.replace(/^\+212/, '')} placeholder="612345678"
        required={field.required} onChange={(e) => change(e.target.value)}
        aria-invalid={field.error ? true : undefined}
        aria-describedby={field.error ? `${field.id}-error` : undefined}
        className={cn(controlClass, 'mt-0 rounded-l-none')}
      />
    </div>
  </Field>
}

// La valeur de l'option "+ Ajouter…" (ce n'est pas un vrai id).
const ADD_OPTION = '__add__'

type SelectFieldProps = Omit<FieldProps, 'children'> & {
  value: string
  onChange: (value: string) => void
  options: ReferenceItem[] | { id: string; name: string }[]
  placeholder?: string   // la première ligne vide, ex. "Choose a direction"
  disabled?: boolean
  onAdd?: () => void     // si présent : une option "+ Ajouter…" à la fin (Admin RH / IT seulement)
}

export function SelectField({ value, onChange, options, placeholder = 'Choose...', disabled, onAdd, ...field }: SelectFieldProps) {
  return <Field {...field}>
    <select
      id={field.id} value={value} required={field.required} disabled={disabled}
      // "+ Ajouter…" ouvre le cadre, sans changer la valeur choisie
      // (React remet tout seul l'ancienne valeur, car `value` n'a pas changé).
      onChange={(e) => (e.target.value === ADD_OPTION ? onAdd?.() : onChange(e.target.value))}
      aria-invalid={field.error ? true : undefined}
      aria-describedby={field.error ? `${field.id}-error` : undefined}
      className={cn(controlClass, 'px-2.5')}
    >
      <option value="">{placeholder}</option>
      {/* Une valeur désactivée (gardée car c'est celle du dossier) est signalée : à ne plus choisir. */}
      {options.map((option) => <option key={option.id} value={String(option.id)}>
        {option.name}{'is_active' in option && !option.is_active ? ' (inactive)' : ''}
      </option>)}
      {onAdd && <option value={ADD_OPTION}>+ Ajouter…</option>}
    </select>
  </Field>
}

type SearchSelectFieldProps = Omit<SelectFieldProps, 'disabled'>

/**
 * Une LONGUE liste (ex. 100 villes) : on tape "cas", le navigateur propose "Casablanca" (<datalist>).
 * Comme SelectField, la valeur est l'id : un texte qui n'est pas dans la liste donne '' (Django refuse).
 */
export function SearchSelectField({ value, onChange, options, placeholder = 'Type to search...', onAdd, ...field }: SearchSelectFieldProps) {
  // Ce que l'utilisateur est en train de taper ; null : on affiche le nom de la valeur choisie.
  const [typed, setTyped] = useState<string | null>(null)
  const shown = typed ?? options.find((option) => String(option.id) === value)?.name ?? ''

  function change(text: string) {
    const match = options.find((option) => option.name.toLowerCase() === text.trim().toLowerCase())
    setTyped(text)
    onChange(match ? String(match.id) : '')
  }

  return <Field {...field}>
    <input
      id={field.id} list={`${field.id}-options`} value={shown} placeholder={placeholder} required={field.required}
      autoComplete="off" onChange={(e) => change(e.target.value)}
      // En quittant le champ : si une valeur est choisie, on affiche son nom exact ("casablanca" -> "Casablanca").
      onBlur={() => { if (value) setTyped(null) }}
      aria-invalid={field.error ? true : undefined}
      aria-describedby={field.error ? `${field.id}-error` : undefined}
      className={controlClass}
    />
    <datalist id={`${field.id}-options`}>
      {options.map((option) => <option key={option.id} value={option.name} />)}
    </datalist>
    {onAdd && <button type="button" onClick={() => { setTyped(null); onAdd() }}
      className="mt-1 text-[11px] font-semibold text-[#23355d] hover:underline">+ Ajouter…</button>}
  </Field>
}

/** Un bloc du formulaire (Identité, Organisation...) avec son titre. */
export function FormSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className="rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <header className="border-b border-slate-100 px-4 py-3">
      <h2 className="text-sm font-semibold text-[#192646]">{title}</h2>
      {description && <p className="text-[11px] text-slate-500">{description}</p>}
    </header>
    <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
  </section>
}
