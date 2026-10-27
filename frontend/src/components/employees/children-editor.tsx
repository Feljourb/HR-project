'use client'

/*
 * La liste des enfants dans le formulaire : une ligne par enfant (prénom + date de naissance),
 * "+ Ajouter un enfant" et une croix pour enlever une ligne.
 * Le nombre d'enfants n'est pas saisi : c'est la longueur de cette liste.
 */
import { Plus, X } from 'lucide-react'
import type { Child } from '@/lib/employees'
import { controlClass } from './form-fields'

type ChildrenEditorProps = {
  items: Child[]   // (pas "children" : ce nom est réservé par React pour le contenu d'un composant)
  onChange: (items: Child[]) => void
  // Les erreurs de Django pour l'enfant n° index, ex. { birth_date: "Cette date est dans le futur." }.
  errorOf: (index: number, field: 'first_name' | 'birth_date') => string | undefined
}

export function ChildrenEditor({ items, onChange, errorOf }: ChildrenEditorProps) {
  // Change un champ d'une ligne (on recrée la liste : React voit le changement).
  function update(index: number, field: 'first_name' | 'birth_date', value: string) {
    onChange(items.map((child, i) => (i === index ? { ...child, [field]: value } : child)))
  }

  return <div className="sm:col-span-2 xl:col-span-3">
    <p className="text-xs font-semibold text-slate-700">Children <span className="font-normal text-slate-500">({items.length})</span></p>

    {items.length > 0 && <ul className="mt-2 space-y-2">
      {items.map((child, index) => {
        const nameError = errorOf(index, 'first_name')
        const dateError = errorOf(index, 'birth_date')
        return <li key={index} className="grid items-start gap-2 sm:grid-cols-[1fr_200px_auto]">
          <div>
            <label htmlFor={`child-${index}-name`} className="sr-only">First name of child {index + 1}</label>
            <input id={`child-${index}-name`} required placeholder="First name" value={child.first_name}
              onChange={(e) => update(index, 'first_name', e.target.value)} aria-invalid={nameError ? true : undefined} className={controlClass} />
            {nameError && <p className="mt-1 text-[11px] font-medium text-red-600">{nameError}</p>}
          </div>
          <div>
            <label htmlFor={`child-${index}-birth`} className="sr-only">Birth date of child {index + 1}</label>
            <input id={`child-${index}-birth`} type="date" required value={child.birth_date}
              onChange={(e) => update(index, 'birth_date', e.target.value)} aria-invalid={dateError ? true : undefined} className={controlClass} />
            {dateError && <p className="mt-1 text-[11px] font-medium text-red-600">{dateError}</p>}
          </div>
          <button type="button" aria-label={`Remove child ${index + 1}`} onClick={() => onChange(items.filter((_, i) => i !== index))}
            className="mt-1.5 flex size-10 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-red-600">
            <X className="size-4" />
          </button>
        </li>
      })}
    </ul>}

    <button type="button" onClick={() => onChange([...items, { first_name: '', birth_date: '' }])}
      className="mt-2 flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-[#23355d]/30 hover:text-[#23355d]">
      <Plus className="size-3.5" /> Add a child
    </button>
  </div>
}
