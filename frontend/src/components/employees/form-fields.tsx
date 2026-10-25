'use client'

/*
 * Les petits morceaux du formulaire : un champ = un libellé + le contrôle + son erreur.
 * Même style que les pages de connexion (gris clair, bleu SBD au focus).
 */
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { ReferenceItem } from '@/lib/employees'

export const controlClass = 'mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-[#23355d] focus:bg-white focus:ring-3 focus:ring-[#23355d]/15 disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-red-300 aria-invalid:bg-red-50/40'

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
}

export function TextField({ value, onChange, type = 'text', placeholder, ...field }: TextFieldProps) {
  return <Field {...field}>
    <input
      id={field.id} type={type} value={value} placeholder={placeholder} required={field.required}
      onChange={(e) => onChange(e.target.value)}
      aria-invalid={field.error ? true : undefined}
      aria-describedby={field.error ? `${field.id}-error` : undefined}
      className={controlClass}
    />
  </Field>
}

type SelectFieldProps = Omit<FieldProps, 'children'> & {
  value: string
  onChange: (value: string) => void
  options: ReferenceItem[] | { id: string; name: string }[]
  placeholder?: string   // la première ligne vide, ex. "Choose a direction"
  disabled?: boolean
}

export function SelectField({ value, onChange, options, placeholder = 'Choose...', disabled, ...field }: SelectFieldProps) {
  return <Field {...field}>
    <select
      id={field.id} value={value} required={field.required} disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      aria-invalid={field.error ? true : undefined}
      aria-describedby={field.error ? `${field.id}-error` : undefined}
      className={cn(controlClass, 'px-2.5')}
    >
      <option value="">{placeholder}</option>
      {options.map((option) => <option key={option.id} value={String(option.id)}>{option.name}</option>)}
    </select>
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
