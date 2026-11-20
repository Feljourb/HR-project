'use client'

/*
 * Une liste déroulante AVEC recherche (2026-11-20, demande de l'utilisatrice : "la ville : une liste avec toutes
 * les villes"). Standard (Gmail, Workday) :
 * - un clic (ou la flèche ▾) ouvre la liste COMPLÈTE, qu'on fait défiler ;
 * - taper filtre la liste ("cas" -> Casablanca), sans tenir compte des accents ni des majuscules ;
 * - clavier : ↑ ↓ pour choisir, Entrée pour prendre, Échap pour fermer.
 * Avant : un <datalist> du navigateur, qui ne montrait que les villes ressemblant au texte déjà écrit.
 * Un seul composant : la fiche employé (SearchSelectField) et "Mon profil" (TextField + suggestions).
 */
import { useId, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { controlClass } from '@/components/ui/control-class'

// "Fès" et "fes" se trouvent l'un l'autre.
const plain = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

export function Combobox({ id, value, onChange, options, placeholder, required, invalid, describedBy }: {
  id: string; value: string; onChange: (text: string) => void; options: string[]
  placeholder?: string; required?: boolean; invalid?: boolean; describedBy?: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)  // la ligne en surbrillance (clavier)
  const listId = useId()
  // Le texte est déjà une valeur de la liste (ou vide) : on montre TOUT ; sinon, ce qui ressemble au texte.
  const exact = options.some((option) => plain(option) === plain(value))
  const shown = !value || exact ? options : options.filter((option) => plain(option).includes(plain(value)))

  function pick(option: string) {
    onChange(option)
    setOpen(false)
  }

  function keyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) return setOpen(true)
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((old) => Math.min(Math.max(old + step, 0), Math.max(shown.length - 1, 0)))
    } else if (event.key === 'Enter' && open && shown[active]) {
      event.preventDefault()
      pick(shown[active])
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  return <div className="relative">
    <input id={id} value={value} placeholder={placeholder} required={required} autoComplete="off"
      role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
      aria-invalid={invalid || undefined} aria-describedby={describedBy}
      onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(0) }}
      onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
      onBlur={() => setOpen(false)} onKeyDown={keyDown}
      className={cn(controlClass, 'pr-9')} />
    <button type="button" tabIndex={-1} aria-label="Show the list" onMouseDown={(e) => e.preventDefault()}
      onClick={() => setOpen((old) => !old)}
      className="absolute right-1 top-[calc(50%+3px)] -translate-y-1/2 rounded p-1.5 text-slate-400 hover:text-[#23355d]">
      <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden />
    </button>
    {open && <ul id={listId} role="listbox"
      className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg">
      {shown.length === 0
        ? <li className="px-3 py-2 text-xs text-slate-400">No match</li>
        : shown.map((option, index) => <li key={option} role="option" aria-selected={plain(option) === plain(value)}
            // onMouseDown (pas onClick) : choisi AVANT que le champ perde le focus (sinon la liste se ferme d'abord).
            onMouseDown={(e) => { e.preventDefault(); pick(option) }} onMouseEnter={() => setActive(index)}
            className={cn('cursor-pointer px-3 py-1.5', index === active && 'bg-slate-100',
              plain(option) === plain(value) && 'font-semibold text-[#192646]')}>
            {option}
          </li>)}
    </ul>}
  </div>
}
