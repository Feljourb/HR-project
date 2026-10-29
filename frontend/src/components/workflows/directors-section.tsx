'use client'

/*
 * Les DG (propriétaires de la société, pas des collaborateurs) et le DG de chaque pôle.
 * - DG : ajouter, modifier (nom, e-mail), désactiver / réactiver. Jamais supprimer.
 * - DG par pôle : une liste par pôle, enregistrée dès qu'on choisit.
 * Les règles (e-mail unique, DG encore utilisé...) sont vérifiées par Django : on affiche sa réponse.
 */
import { useState, type FormEvent } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import { SelectField, controlClass } from '@/components/employees/form-fields'
import { sendChange, type Director, type PoleDirector } from '@/lib/workflows'

const actionClass = 'rounded-md px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-[#23355d] disabled:opacity-50'
const inputClass = cn(controlClass, 'mt-0 h-8 text-xs')
const surface = 'rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]'

type DirectorsSectionProps = {
  directors: Director[]
  poles: PoleDirector[]
  onDirector: (director: Director) => void   // ajouté ou modifié : la nouvelle version
  onPole: (pole: PoleDirector) => void
}

export function DirectorsSection({ directors, poles, onDirector, onPole }: DirectorsSectionProps) {
  return <div className="grid items-start gap-4 lg:grid-cols-[1fr_320px]">
    <section className={surface}>
      <header className="border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-[#192646]">DG</h3>
        <p className="text-[11px] text-slate-500">The owners of the company who validate the &quot;DG&quot; steps. Never deleted: deactivate instead.</p>
      </header>
      <ul>
        {directors.map((director) => <DirectorRow key={director.id} director={director} onChanged={onDirector} />)}
        {directors.length === 0 && <li className="px-4 py-4 text-center text-xs text-slate-500">No DG yet.</li>}
      </ul>
      <AddDirector onAdded={onDirector} />
    </section>

    <section className={surface}>
      <header className="border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-[#192646]">DG of each pôle</h3>
        <p className="text-[11px] text-slate-500">Saved as soon as you choose.</p>
      </header>
      <div className="flex flex-col gap-3 p-4">
        {/* Seulement les DG actifs : Django refuse un DG désactivé. */}
        {poles.map((pole) => <PoleRow key={pole.id} pole={pole} directors={directors.filter((d) => d.is_active)} onChanged={onPole} />)}
      </div>
    </section>
  </div>
}

// Un DG : son nom et son e-mail, Modifier, Désactiver / Réactiver.
function DirectorRow({ director, onChanged }: { director: Director; onChanged: (director: Director) => void }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(director.name)
  const [email, setEmail] = useState(director.email)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function send(body: Partial<Director>) {
    setBusy(true)
    setError('')
    const result = await sendChange<Director>(() =>
      apiFetch(`/api/workflows/directors/${director.id}/`, { method: 'PATCH', body: JSON.stringify(body) }))
    if ('data' in result) {
      onChanged(result.data)
      setEditing(false)
    } else {
      // Ex. "Ce DG est encore DG de : SBD. Choisissez d'abord un autre DG."
      setError(result.error)
    }
    setBusy(false)
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    send({ name: name.trim(), email: email.trim() })
  }

  function cancel() {
    setEditing(false)
    setName(director.name)
    setEmail(director.email)
    setError('')
  }

  return <li className="border-b border-slate-100 px-4 py-3">
    {editing
      ? <form onSubmit={save} className="flex flex-wrap items-center gap-2">
          <label htmlFor={`dg-name-${director.id}`} className="sr-only">Name</label>
          <input id={`dg-name-${director.id}`} required autoFocus value={name} onChange={(e) => setName(e.target.value)} className={cn(inputClass, 'w-44')} />
          <label htmlFor={`dg-email-${director.id}`} className="sr-only">E-mail</label>
          <input id={`dg-email-${director.id}`} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={cn(inputClass, 'min-w-48 flex-1')} />
          <button type="submit" disabled={busy} className="flex items-center gap-1.5 rounded-md bg-[#23355d] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#192646] disabled:opacity-60">
            {busy && <Loader2 className="size-3 animate-spin" />} Save
          </button>
          <button type="button" onClick={cancel} className={actionClass}>Cancel</button>
        </form>
      : <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <div className="min-w-0 flex-1">
            <p className={cn('text-sm font-medium', director.is_active ? 'text-[#0F172A]' : 'text-slate-400')}>{director.name}</p>
            <p className="truncate text-[11px] text-slate-500">{director.email}</p>
          </div>
          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold',
            director.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
            {director.is_active ? 'Active' : 'Inactive'}
          </span>
          <button type="button" disabled={busy} onClick={() => setEditing(true)} className={actionClass}>Edit</button>
          <button type="button" disabled={busy} onClick={() => send({ is_active: !director.is_active })} className={actionClass}>
            {director.is_active ? 'Deactivate' : 'Reactivate'}
          </button>
        </div>}
    {error && <p role="alert" className="mt-1 text-[11px] font-medium text-red-600">{error}</p>}
  </li>
}

// Le petit formulaire "Ajouter un DG" sous la liste.
function AddDirector({ onAdded }: { onAdded: (director: Director) => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const result = await sendChange<Director>(() =>
      apiFetch('/api/workflows/directors/', { method: 'POST', body: JSON.stringify({ name: name.trim(), email: email.trim() }) }))
    if ('data' in result) {
      onAdded(result.data)
      setName('')
      setEmail('')
    } else {
      setError(result.error)
    }
    setBusy(false)
  }

  return <form onSubmit={add} className="flex flex-wrap items-center gap-2 px-4 py-3">
    <label htmlFor="new-dg-name" className="sr-only">Name</label>
    <input id="new-dg-name" required value={name} placeholder="Full name" onChange={(e) => setName(e.target.value)} className={cn(inputClass, 'w-44')} />
    <label htmlFor="new-dg-email" className="sr-only">E-mail</label>
    <input id="new-dg-email" type="email" required value={email} placeholder="E-mail" onChange={(e) => setEmail(e.target.value)} className={cn(inputClass, 'min-w-48 flex-1')} />
    <button type="submit" disabled={busy} className="flex items-center gap-1.5 rounded-md bg-[#23355d] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#192646] disabled:opacity-60">
      {busy ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3.5" />} Add a DG
    </button>
    {error && <p role="alert" className="w-full text-[11px] font-medium text-red-600">{error}</p>}
  </form>
}

// Un pôle et la liste de ses DG possibles. "No DG" = null (l'étape DG sera sautée).
function PoleRow({ pole, directors, onChanged }: { pole: PoleDirector; directors: Director[]; onChanged: (pole: PoleDirector) => void }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function choose(id: string) {
    setBusy(true)
    setError('')
    const result = await sendChange<PoleDirector>(() =>
      apiFetch(`/api/workflows/poles/${pole.id}/`, { method: 'PATCH', body: JSON.stringify({ director: id ? Number(id) : null }) }))
    if ('data' in result) onChanged(result.data)
    else setError(result.error)
    setBusy(false)
  }

  return <SelectField id={`pole-dg-${pole.id}`} label={pole.name} value={pole.director ? String(pole.director) : ''}
    options={directors} placeholder="No DG" disabled={busy} error={error} onChange={choose} />
}
