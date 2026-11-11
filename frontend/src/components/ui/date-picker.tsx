'use client'

/*
 * Le champ date de l'application (2026-11-11), à la place du <input type="date"> du navigateur :
 * - un vrai calendrier à nos couleurs (le même sur tous les ordinateurs, en anglais comme les pages) ;
 * - on tape seulement des CHIFFRES, les "/" se mettent tout seuls : 11112026 -> 11/11/2026 ;
 *   l'année s'arrête à 4 chiffres (avant : on pouvait taper 2026666666) ;
 * - une date impossible (31/02/2026) ou hors limites (min / max) n'est jamais envoyée : le champ le dit.
 * Comme l'ancien champ : la valeur est "AAAA-MM-JJ" (ou '' si vide / incomplète), ce que Django attend.
 */
import { useEffect, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { controlClass } from './control-class'

const pad = (n: number) => String(n).padStart(2, '0')
const toIso = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`  // month : 1 à 12
const display = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '')
const todayIso = () => { const now = new Date(); return toIso(now.getFullYear(), now.getMonth() + 1, now.getDate()) }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']  // la semaine commence le lundi (Maroc)

/** Ce qu'on tape -> "jj/mm/aaaa" : seulement des chiffres (8 au plus), les "/" ajoutés tout seuls. */
function mask(typed: string) {
  const digits = typed.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

/** "31/02/2026" -> null (n'existe pas) ; "11/11/2026" -> "2026-11-11". */
function parse(text: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text)
  if (!match) return null
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > new Date(year, month, 0).getDate()) return null
  return toIso(year, month, day)
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
  const [text, setText] = useState(display(value))
  // La valeur reçue la dernière fois, et la dernière que NOUS avons envoyée : si le parent change la date
  // lui-même (ex. "To" suit "From"), le texte suit ; sinon on ne touche pas à ce qu'on est en train de taper.
  const [seen, setSeen] = useState(value)
  const [sent, setSent] = useState(value)
  if (value !== seen) {
    setSeen(value)
    if (value !== sent) setText(display(value))
  }

  const [open, setOpen] = useState(false)
  const [view, setView] = useState({ year: 2026, month: 0 })  // le mois affiché (month : 0 à 11)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Le problème de la date tapée (affiché sous le champ), ou ''.
  const typed = parse(text)
  const complete = text.replace(/\D/g, '').length === 8
  const problem = !complete ? ''
    : !typed ? 'This date does not exist.'
      : min && typed < min ? `The date must be on or after ${display(min)}.`
        : max && typed > max ? `The date must be on or before ${display(max)}.` : ''

  // Le message du navigateur à l'envoi du formulaire (comme un champ "required" vide).
  useEffect(() => {
    inputRef.current?.setCustomValidity(problem || (text && !complete ? 'Complete the date (dd/mm/yyyy).' : ''))
  }, [problem, text, complete])

  // Un clic en dehors ferme le calendrier.
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!boxRef.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  function emit(iso: string) {
    setSent(iso)
    if (iso !== value) onChange(iso)
  }

  function type(raw: string) {
    const next = mask(raw)
    setText(next)
    const iso = parse(next)
    // Seulement une date COMPLÈTE, qui existe et dans les limites ; sinon '' (rien d'envoyé à moitié).
    emit(iso && (!min || iso >= min) && (!max || iso <= max) ? iso : '')
  }

  function choose(iso: string) {
    setText(display(iso))
    emit(iso)
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
    <input ref={inputRef} id={id} type="text" inputMode="numeric" autoComplete="off" placeholder="dd/mm/yyyy" maxLength={10}
      value={text} required={required} disabled={disabled} onChange={(event) => type(event.target.value)}
      aria-invalid={invalid || problem ? true : undefined} aria-describedby={describedBy}
      className={cn(controlClass, 'mt-0 pr-10 tabular-nums')} />
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
        <button type="button" onClick={() => { setText(''); emit(''); setOpen(false) }} className="rounded-md px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100">Clear</button>
        <button type="button" disabled={outside(today)} onClick={() => choose(today)}
          className="rounded-md px-2 py-1 text-xs font-semibold text-[#23355d] hover:bg-[#E4E9F2] disabled:cursor-not-allowed disabled:opacity-40">Today</button>
      </div>
    </div>}
  </div>
}

const navClass = 'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-[#23355d]'
const selectClass = 'h-8 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-1.5 text-xs font-semibold text-[#192646] outline-none focus:border-[#23355d]'
