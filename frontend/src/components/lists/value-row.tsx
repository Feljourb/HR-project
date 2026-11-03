'use client'

/*
 * Une ligne du tableau des listes : la valeur, son état (active ou non), et les actions
 * Renommer, Désactiver / Réactiver. Jamais Supprimer (décision de l'encadrant) : on désactive.
 *
 * Les règles (doublon, valeur utilisée, Admin RH seulement) sont vérifiées par Django :
 * ici on affiche simplement sa réponse sous la valeur.
 */
import { useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import { controlClass } from '@/components/employees/form-fields'
import { ManagerPicker } from '@/components/employees/manager-picker'
import { ExtraInput, extraText } from './extra-input'
import { LISTS_API, extraToJson, extraValue, type ExtraField, type ListConfig, type ListValue } from './lists-config'

type ValueRowProps = {
  list: string                 // la liste dans l'API, ex. "positions"
  api?: string                 // l'adresse des listes (par défaut celle de l'app employees)
  item: ListValue
  withCode?: boolean
  headFilter?: ListConfig['headFilter']  // directions et services : la colonne "responsable"
  extra?: ExtraField[]                   // listes du module Congés : des colonnes en plus (modifiables avec le nom)
  readOnly?: boolean                     // pas d'actions (ex. les jours fériés d'une année passée : l'historique)
  onChanged: (item: ListValue) => void   // renommée, désactivée ou réactivée : la nouvelle version
}

// Les valeurs des champs en plus, en texte, ex. { max_days: "4", deducts_balance: "false" }.
const extrasOf = (item: ListValue, extra: ExtraField[]) =>
  Object.fromEntries(extra.map((field) => [field.name, extraValue(item, field)]))

const actionClass = 'rounded-md px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-[#23355d] disabled:opacity-50'

/** Le premier message d'erreur de Django, ex. {"name": ["Cette valeur existe déjà."]}. */
function firstMessage(data: Record<string, unknown>) {
  const messages = Object.values(data)[0]
  return Array.isArray(messages) ? String(messages[0]) : 'Something went wrong. Please try again.'
}

export function ValueRow({ list, api = LISTS_API, item, withCode, headFilter, extra = [], readOnly, onChanged }: ValueRowProps) {
  const [editing, setEditing] = useState(false)
  const [choosingHead, setChoosingHead] = useState(false)  // la recherche du responsable est ouverte
  const [name, setName] = useState(item.name)
  const [code, setCode] = useState(item.code ?? '')
  const [extras, setExtras] = useState(() => extrasOf(item, extra))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Envoie la modification à Django (PATCH) et affiche sa réponse.
  async function send(body: object) {
    setBusy(true)
    setError('')
    try {
      const response = await apiFetch(`${api}/${list}/${item.id}/`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      if (response.ok) {
        onChanged(await response.json())
        setEditing(false)
        setChoosingHead(false)
      } else if (response.status === 403) {
        setError('Only Admin RH can change the lists.')
      } else {
        // 400 : doublon ("Cette valeur existe déjà."), nom vide...
        setError(firstMessage(await response.json().catch(() => ({}))))
      }
    } catch {
      setError('Cannot reach the server. Please try again later.')
    }
    setBusy(false)
  }

  function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const body: Record<string, unknown> = withCode ? { name: name.trim(), code: code.trim() } : { name: name.trim() }
    for (const field of extra) body[field.name] = extraToJson(field, extras[field.name])
    send(body)
  }

  function cancel() {
    setEditing(false)
    setName(item.name)
    setCode(item.code ?? '')
    setExtras(extrasOf(item, extra))
    setError('')
  }

  return <tr className="border-t border-slate-100 align-top">
    <td className="px-4 py-3" colSpan={editing ? 1 + (withCode ? 1 : 0) + extra.length : 1}>
      {editing
        ? <form onSubmit={rename} className="flex flex-wrap items-center gap-2">
            {withCode && <>
              <label htmlFor={`code-${item.id}`} className="sr-only">Code</label>
              <input id={`code-${item.id}`} required value={code} onChange={(e) => setCode(e.target.value)} className={cn(controlClass, 'mt-0 h-8 w-28')} />
            </>}
            {/* Les champs en plus (date, maximum, décompté du solde) se modifient avec le nom. */}
            {extra.map((field) => <ExtraInput key={field.name} id={`${field.name}-${item.id}`} field={field} compact
              value={extras[field.name]} onChange={(value) => setExtras((old) => ({ ...old, [field.name]: value }))} />)}
            <label htmlFor={`name-${item.id}`} className="sr-only">Name</label>
            <input id={`name-${item.id}`} required autoFocus value={name} onChange={(e) => { setName(e.target.value); setError('') }}
              aria-invalid={error ? true : undefined} className={cn(controlClass, 'mt-0 h-8 min-w-48 flex-1')} />
            <button type="submit" disabled={busy} className="flex items-center gap-1.5 rounded-md bg-[#23355d] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#192646] disabled:opacity-60">
              {busy && <Loader2 className="size-3 animate-spin" />} Save
            </button>
            <button type="button" onClick={cancel} className={actionClass}>Cancel</button>
          </form>
        : <span className={cn('text-sm', item.is_active ? 'text-[#0F172A]' : 'text-slate-400')}>{item.name}</span>}
      {error && <p role="alert" className="mt-1 text-[11px] font-medium text-red-600">{error}</p>}
    </td>

    {withCode && !editing && <td className="px-4 py-3 font-mono text-xs text-slate-600">{item.code}</td>}
    {!editing && extra.map((field) => <td key={field.name} className="px-4 py-3 text-xs text-slate-600">{extraText(item, field)}</td>)}

    {/* Le responsable : le N+1 de toute l'équipe. Le changer change le N+1 de chacun, sans toucher aux fiches.
        La recherche ne propose que les gens qui travaillent dans ce service / cette direction. */}
    {headFilter && <td className="px-4 py-3">
      {choosingHead
        ? <div className="flex items-start gap-1">
            <div className="min-w-56 flex-1">
              <ManagerPicker id={`head-${item.id}`} fieldLabel="Head" value="" label="" placeholder="Search a person..."
                filters={{ [headFilter]: String(item.id) }} disabled={busy}
                hint={headFilter === 'department' ? 'People of this service.' : 'People of this direction.'}
                onChange={(id) => send({ head: Number(id) })} />
            </div>
            <button type="button" onClick={() => { setChoosingHead(false); setError('') }} className={cn(actionClass, 'mt-6')}>Cancel</button>
          </div>
        : <div className="flex flex-wrap items-center gap-1">
            <span className={cn('text-xs', item.head_label ? 'text-slate-700' : 'text-slate-400')}>{item.head_label ?? 'No head'}</span>
            <button type="button" disabled={busy} onClick={() => setChoosingHead(true)} className={actionClass}>{item.head ? 'Change' : 'Choose'}</button>
            {item.head && <button type="button" disabled={busy} onClick={() => send({ head: null })} className={actionClass}>Remove</button>}
          </div>}
    </td>}

    <td className="px-4 py-3">
      <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold',
        item.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
        {item.is_active ? 'Active' : 'Inactive'}
      </span>
    </td>

    <td className="px-4 py-2.5 text-right">
      {!editing && !readOnly && <div className="flex justify-end gap-1">
        <button type="button" disabled={busy} onClick={() => setEditing(true)} className={actionClass}>{extra.length ? 'Edit' : 'Rename'}</button>
        {/* Désactiver : la valeur reste sur les anciens dossiers, mais n'est plus proposée dans les formulaires. */}
        <button type="button" disabled={busy} onClick={() => send({ is_active: !item.is_active })} className={actionClass}>
          {item.is_active ? 'Deactivate' : 'Reactivate'}
        </button>
      </div>}
    </td>
  </tr>
}
