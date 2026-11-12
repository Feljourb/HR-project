'use client'

/*
 * Le champ date de l'application (2026-11-11), à la place du <input type="date"> du navigateur :
 * - un vrai calendrier à nos couleurs (le même sur tous les ordinateurs, en anglais comme les pages) ;
 * - le champ est en 3 CASES, comme celui de Chrome ou d'Outlook (2026-11-12, après le test de l'utilisateur) :
 *   jj / mm / aaaa. Un clic sur le jour sélectionne SEULEMENT le jour : on le retape, ou Retour arrière l'efface,
 *   sans toucher au mois ni à l'année. Après 2 chiffres du jour, on passe tout seul au mois, puis à l'année
 *   (les "/" sont toujours là) ; l'année s'arrête à 4 chiffres (avant : on pouvait taper 2026666666).
 *   Flèches ← → : changer de case ; ↑ ↓ : +1 / -1 ; "/" : case suivante ; coller "25/11/2026" marche aussi.
 * - une date impossible (31/02/2026) ou hors limites (min / max) n'est jamais envoyée : le champ le dit.
 * Comme l'ancien champ : la valeur est "AAAA-MM-JJ" (ou '' si vide / incomplète), ce que Django attend.
 */
import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { controlClass } from './control-class'

const pad = (n: number) => String(n).padStart(2, '0')
const toIso = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`  // month : 1 à 12
const display = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '')
const todayIso = () => { const now = new Date(); return toIso(now.getFullYear(), now.getMonth() + 1, now.getDate()) }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']  // la semaine commence le lundi (Maroc)

// Les 3 cases : [jour, mois, année] = les chiffres tapés (pas encore complétés). "dd/mm/yyyy" : où commence chacune.
type Parts = [string, string, string]
const EMPTY: Parts = ['', '', '']
const SIZE = [2, 2, 4]
const HOLDER = ['dd', 'mm', 'yyyy']
const START = [0, 3, 6]

const partsOf = (iso: string): Parts => (iso ? [iso.slice(8, 10), iso.slice(5, 7), iso.slice(0, 4)] : EMPTY)

/** Ce que montre le champ : "25/mm/yyyy" (une case vide montre son modèle ; un "2" dans le jour montre "02"). */
function shown(parts: Parts) {
  return parts.map((part, index) => (part === '' ? HOLDER[index] : index < 2 ? part.padStart(2, '0') : part.padEnd(4, 'y'))).join('/')
}

/** Les 3 cases -> "2026-11-25", ou null (incomplet, ou n'existe pas : 31/02). */
function isoOf([day, month, year]: Parts): string | null {
  if (!day || !month || year.length !== 4) return null
  const [d, m, y] = [Number(day), Number(month), Number(year)]
  if (y < 1900 || m < 1 || m > 12 || d < 1 || d > new Date(y, m, 0).getDate()) return null
  return toIso(y, m, d)
}

type DatePickerProps = {
  id: string
  value: string                    // "2026-11-11", ou ''
  onChange: (value: string) => void
  min?: string
  max?: string
  required?: boolean
  disabled?: boolean
  invalid?: boolean                // une erreur venue d'ailleurs (ex. Django) : bordure rouge
  describedBy?: string
  className?: string               // pour l'enveloppe (ex. "mt-0" dans une ligne serrée)
}

export function DatePicker({ id, value, onChange, min, max, required, disabled, invalid, describedBy, className }: DatePickerProps) {
  const [parts, setParts] = useState<Parts>(partsOf(value))
  // La valeur reçue la dernière fois, et la dernière que NOUS avons envoyée : si le parent change la date
  // lui-même (ex. "To" suit "From"), les cases suivent ; sinon on ne touche pas à ce qu'on est en train de taper.
  const [seen, setSeen] = useState(value)
  const [sent, setSent] = useState(value)
  if (value !== seen) {
    setSeen(value)
    if (value !== sent) setParts(partsOf(value))
  }

  const [active, setActive] = useState(0)      // la case sélectionnée (0 jour, 1 mois, 2 année)
  const [fresh, setFresh] = useState(true)     // le prochain chiffre REMPLACE la case (vrai après un clic / un passage)
  const [focused, setFocused] = useState(false)
  const [open, setOpen] = useState(false)
  const [view, setView] = useState({ year: 2026, month: 0 })  // le mois affiché du calendrier (month : 0 à 11)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const typed = isoOf(parts)
  const filled = parts.some(Boolean)
  const complete = parts[0] !== '' && parts[1] !== '' && parts[2].length === 4
  // Le problème de la date tapée (affiché sous le champ), ou ''.
  const problem = !complete ? ''
    : !typed ? 'This date does not exist.'
      : min && typed < min ? `The date must be on or after ${display(min)}.`
        : max && typed > max ? `The date must be on or before ${display(max)}.` : ''

  // Le message du navigateur à l'envoi du formulaire (comme un champ "required" vide).
  useEffect(() => {
    inputRef.current?.setCustomValidity(problem || (filled && !complete ? 'Complete the date (dd/mm/yyyy).' : ''))
  }, [problem, filled, complete])

  // La case active reste SÉLECTIONNÉE (surlignée) après chaque frappe : on voit ce qu'on va remplacer.
  useEffect(() => {
    const input = inputRef.current
    if (input && focused && document.activeElement === input) input.setSelectionRange(START[active], START[active] + SIZE[active])
  }, [active, parts, focused])

  // Un clic en dehors ferme le calendrier.
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!boxRef.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  /** Nouvelles cases -> la valeur pour le parent : seulement une date COMPLÈTE, qui existe et dans les limites. */
  function update(next: Parts) {
    setParts(next)
    const iso = isoOf(next)
    const ok = iso && (!min || iso >= min) && (!max || iso <= max) ? iso : ''
    setSent(ok)
    if (ok !== value) onChange(ok)
  }

  function go(index: number) {
    setActive(Math.max(0, Math.min(2, index)))
    setFresh(true)
  }

  function typeDigit(digit: string) {
    const index = active
    // L'année déjà complète (4 chiffres) et pas resélectionnée : un 5e chiffre est ignoré.
    if (!fresh && parts[index].length >= SIZE[index]) return
    let part = fresh ? digit : parts[index] + digit
    let done = part.length === SIZE[index]
    // "4" dans le jour ne peut être que 04 (pas de 40) ; "2" dans le mois ne peut être que 02 : case finie.
    if (part.length === 1 && ((index === 0 && digit > '3') || (index === 1 && digit > '1'))) {
      part = `0${digit}`
      done = true
    }
    const next = [...parts] as Parts
    next[index] = part
    update(next)
    if (done && index < 2) go(index + 1)  // jour fini -> mois ; mois fini -> année
    else setFresh(false)
  }

  function erase(key: string) {
    if (parts[active] !== '') {
      const next = [...parts] as Parts
      next[active] = ''  // SEULEMENT cette case (le mois et l'année restent)
      update(next)
      setFresh(true)
    } else if (key === 'Backspace') {
      go(active - 1)  // case déjà vide : on recule d'une case
    }
  }

  function step(delta: number) {
    const [low, high] = active === 0 ? [1, 31] : active === 1 ? [1, 12] : [1900, 2100]
    const current = Number(parts[active]) || (active === 2 ? new Date().getFullYear() - delta : low - delta)
    let number = current + delta
    if (number > high) number = low
    if (number < low) number = high
    const next = [...parts] as Parts
    next[active] = active === 2 ? String(number) : pad(number)
    update(next)
    setFresh(true)
  }

  function key(event: KeyboardEvent<HTMLInputElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey) return  // copier, coller, tout sélectionner... : normal
    const { key: name } = event
    const handled = () => event.preventDefault()
    if (/^\d$/.test(name)) { handled(); typeDigit(name) }
    else if (name === 'Backspace' || name === 'Delete') { handled(); erase(name) }
    else if (name === 'ArrowLeft') { handled(); go(active - 1) }
    else if (name === 'ArrowRight' || name === '/' || name === '.' || name === '-' || name === ' ') { handled(); go(active + 1) }
    else if (name === 'ArrowUp') { handled(); step(1) }
    else if (name === 'ArrowDown') { handled(); step(-1) }
    else if (name.length === 1) handled()  // une lettre : ignorée
    // Tab, Entrée, Échap : comportement normal (quitter le champ, envoyer le formulaire...).
  }

  /** Un clic dans le champ : la case cliquée est sélectionnée (jour, mois ou année). */
  function pick() {
    const position = inputRef.current?.selectionStart ?? 0
    const index = position <= 2 ? 0 : position <= 5 ? 1 : 2
    setActive(index)
    setFresh(true)
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(START[index], START[index] + SIZE[index]))
  }

  /** Coller "25/11/2026", "2026-11-25" ou "25112026". */
  function paste(event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault()
    const text = event.clipboardData.getData('text').trim()
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
    const digits = text.replace(/\D/g, '')
    if (iso) update([iso[3], iso[2], iso[1]])
    else if (digits.length === 8) update([digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)])
  }

  /** Un téléphone (son clavier ne passe pas par les touches ci-dessus) : les chiffres remplissent les cases dans l'ordre. */
  function changeFromPhone(raw: string) {
    const digits = raw.replace(/\D/g, '').slice(0, 8)
    update([digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)])
  }

  function choose(iso: string) {
    setParts(partsOf(iso))
    setSent(iso)
    if (iso !== value) onChange(iso)
    setOpen(false)
    inputRef.current?.focus()
  }

  function openCalendar() {
    // On ouvre sur le mois de la date choisie ; sinon aujourd'hui (ramené dans les limites).
    let start = typed ?? (value || todayIso())
    if (min && start < min) start = min
    if (max && start > max) start = max
    setView({ year: Number(start.slice(0, 4)), month: Number(start.slice(5, 7)) - 1 })
    setOpen(true)
  }

  function move(months: number) {
    setView(({ year, month }) => {
      const index = year * 12 + month + months
      return { year: Math.floor(index / 12), month: index % 12 }
    })
  }

  // Les années proposées : les limites si elles existent, sinon de 1930 à dans 5 ans.
  const thisYear = new Date().getFullYear()
  const firstYear = min ? Number(min.slice(0, 4)) : 1930
  const lastYear = max ? Number(max.slice(0, 4)) : thisYear + 5
  const years = Array.from({ length: Math.max(lastYear - firstYear + 1, 1) }, (_, index) => lastYear - index)

  // Les 6 semaines du mois affiché (du lundi), avec les jours du mois d'avant / d'après en pâle.
  const offset = (new Date(view.year, view.month, 1).getDay() + 6) % 7
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(view.year, view.month, index - offset + 1)
    return { iso: toIso(date.getFullYear(), date.getMonth() + 1, date.getDate()), day: date.getDate(), inMonth: date.getMonth() === view.month, sunday: date.getDay() === 0 }
  })
  const today = todayIso()
  const outside = (iso: string) => Boolean((min && iso < min) || (max && iso > max))

  return <div ref={boxRef} className={cn('relative mt-1.5', className)}
    onKeyDown={(event) => { if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); inputRef.current?.focus() } }}>
    {/* Vide et pas en train d'écrire : '' (le modèle gris "dd/mm/yyyy" s'affiche) ; sinon les 3 cases. */}
    <input ref={inputRef} id={id} type="text" inputMode="numeric" autoComplete="off" placeholder="dd/mm/yyyy" spellCheck={false}
      value={focused || filled ? shown(parts) : ''} required={required} disabled={disabled}
      onKeyDown={key} onClick={pick} onPaste={paste} onChange={(event) => changeFromPhone(event.target.value)}
      onFocus={() => { setFocused(true); if (!filled) { setActive(0); setFresh(true) } }} onBlur={() => setFocused(false)}
      aria-invalid={invalid || problem ? true : undefined} aria-describedby={describedBy}
      className={cn(controlClass, 'mt-0 pr-10 tabular-nums', filled ? 'text-slate-800' : 'text-slate-400')} />
    <button type="button" onClick={() => (open ? setOpen(false) : openCalendar())} disabled={disabled}
      aria-label="Open the calendar" aria-expanded={open} aria-controls={`${id}-calendar`}
      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-[#23355d] disabled:opacity-50">
      <CalendarDays className="size-4" />
    </button>
    {problem && <p className="mt-1 text-[11px] font-medium text-red-600">{problem}</p>}

    {open && <div id={`${id}-calendar`} role="dialog" aria-label="Choose a date"
      className="absolute left-0 top-full z-50 mt-1.5 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
      {/* Le mois : ‹ [Mois] [Année] › (les listes : aller vite à 1985 pour une date de naissance). */}
      <div className="mb-2 flex items-center gap-1">
        <button type="button" onClick={() => move(-1)} aria-label="Previous month" className={navClass}><ChevronLeft className="size-4" /></button>
        <select aria-label="Month" value={view.month} onChange={(event) => setView((old) => ({ ...old, month: Number(event.target.value) }))} className={selectClass}>
          {MONTHS.map((name, index) => <option key={name} value={index}>{name}</option>)}
        </select>
        <select aria-label="Year" value={view.year} onChange={(event) => setView((old) => ({ ...old, year: Number(event.target.value) }))} className={cn(selectClass, 'w-20 flex-none')}>
          {!years.includes(view.year) && <option value={view.year}>{view.year}</option>}
          {years.map((year) => <option key={year} value={year}>{year}</option>)}
        </select>
        <button type="button" onClick={() => move(1)} aria-label="Next month" className={navClass}><ChevronRight className="size-4" /></button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 text-center">
        {WEEKDAYS.map((name) => <span key={name} className="py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{name}</span>)}
        {days.map(({ iso, day, inMonth, sunday }) => {
          const selected = iso === (typed ?? value)
          const blocked = outside(iso)
          return <button key={iso} type="button" disabled={blocked} onClick={() => choose(iso)}
            aria-label={display(iso)} aria-pressed={selected}
            className={cn('h-8 rounded-lg text-xs tabular-nums transition-colors',
              selected ? 'bg-[#192646] font-semibold text-white'
                : blocked ? 'cursor-not-allowed text-slate-300 line-through decoration-slate-200'
                  : cn('hover:bg-[#E4E9F2] hover:text-[#23355d]', inMonth ? (sunday ? 'text-slate-400' : 'text-slate-700') : 'text-slate-300'),
              iso === today && !selected && 'font-semibold text-[#23355d] ring-1 ring-inset ring-[#23355d]/40')}>
            {day}
          </button>
        })}
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
        <button type="button" onClick={() => { update(EMPTY); setOpen(false) }} className="rounded-md px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100">Clear</button>
        <button type="button" disabled={outside(today)} onClick={() => choose(today)}
          className="rounded-md px-2 py-1 text-xs font-semibold text-[#23355d] hover:bg-[#E4E9F2] disabled:cursor-not-allowed disabled:opacity-40">Today</button>
      </div>
    </div>}
  </div>
}

const navClass = 'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-[#23355d]'
const selectClass = 'h-8 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-1.5 text-xs font-semibold text-[#192646] outline-none focus:border-[#23355d]'
