'use client'

/*
 * Un champ en plus du nom (listes du module Congés) : une case à cocher, un nombre ou une date.
 * Utilisé dans la ligne du tableau (Modifier) et dans le cadre "Ajouter".
 */
import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/leaves'
import { controlClass } from '@/components/employees/form-fields'
import type { ExtraField, ListValue } from './lists-config'

export function ExtraInput({ id, field, value, onChange, compact }: {
  id: string; field: ExtraField; value: string; onChange: (value: string) => void; compact?: boolean
}) {
  if (field.type === 'checkbox') {
    return <label htmlFor={id} className="flex items-center gap-2 text-xs text-slate-700">
      <input id={id} type="checkbox" checked={value === 'true'} onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
        className="size-4 accent-[#192646]" />
      {field.label}
    </label>
  }
  return <>
    <label htmlFor={id} className={compact ? 'sr-only' : 'block text-xs font-semibold text-slate-700'}>{field.label}</label>
    <input id={id} type={field.type} required={field.required} value={value} onChange={(e) => onChange(e.target.value)}
      min={field.type === 'number' ? 0.5 : undefined} step={field.type === 'number' ? 0.5 : undefined}
      placeholder={field.type === 'number' ? 'No maximum' : undefined}
      className={cn(controlClass, compact && 'mt-0 h-8 w-36')} />
  </>
}

/** Ce que la colonne affiche, ex. "Yes", "4 days", "06/11/2026". */
export function extraText(item: ListValue, field: ExtraField) {
  const value = item[field.name]
  if (field.type === 'checkbox') return value ? 'Yes' : 'No'
  if (value === null || value === undefined || value === '') return '—'
  if (field.type === 'number') return `${Number(value)} days`
  return formatDate(String(value))
}
