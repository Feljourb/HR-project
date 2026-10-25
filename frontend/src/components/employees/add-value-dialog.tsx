'use client'

/*
 * Le petit cadre "+ Ajouter…" : l'Admin RH crée une nouvelle valeur de liste
 * (une direction, une banque...) sans quitter le formulaire.
 *
 * <dialog> + showModal() : élément HTML standard. Le navigateur gère tout seul le fond
 * grisé, la touche Échap, et garde le focus clavier dans le cadre (accessibilité).
 *
 * La valeur est créée par l'API (POST /api/employees/lists/<liste>/). C'est Django qui
 * refuse un doublon ("Cette valeur existe déjà.") ou un utilisateur qui n'est pas Admin RH.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Loader2, X } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import type { ReferenceItem } from '@/lib/employees'
import { cn } from '@/lib/utils'
import { controlClass } from './form-fields'

// Ce que le formulaire demande d'ajouter.
export type AddRequest = {
  list: string                 // la liste dans l'API, ex. "directions"
  title: string                // le nom affiché, ex. "Direction"
  // Cascade : le parent déjà choisi dans le formulaire (ex. l'entité "Challenge").
  parent?: { field: string; value: string; label: string }
  // Ou un parent à choisir dans le cadre (une entité a besoin d'un pôle).
  parentChoice?: { field: string; label: string; options: ReferenceItem[] }
  withCode?: boolean           // centre de coût : un code en plus du nom
  onCreated: (item: ReferenceItem) => void   // la nouvelle valeur, pour la choisir tout de suite
}

export function AddValueDialog({ request, onClose }: { request: AddRequest | null; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  // On ouvre / ferme le vrai <dialog> quand `request` change.
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (request && !dialog.open) dialog.showModal()
    if (!request && dialog.open) dialog.close()
  }, [request])

  return <dialog
    ref={dialogRef}
    onClose={onClose}  // Échap, ou dialog.close() : on prévient le formulaire
    // Clic sur le fond grisé (en dehors du cadre) : on ferme.
    onClick={(e) => { if (e.target === dialogRef.current) onClose() }}
    className="m-auto w-[min(92vw,420px)] rounded-xl border border-slate-200 bg-white p-0 shadow-2xl backdrop:bg-slate-900/40"
  >
    {/* Le contenu n'existe que si le cadre est ouvert : il repart vide à chaque ouverture. */}
    {request && <AddValueForm request={request} onClose={onClose} />}
  </dialog>
}

function AddValueForm({ request, onClose }: { request: AddRequest; onClose: () => void }) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [parentValue, setParentValue] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')

    // Le JSON envoyé, ex. {"name": "Achats", "direction": "12"}.
    const body: Record<string, string> = { name: name.trim() }
    if (request.withCode) body.code = code.trim()
    if (request.parent) body[request.parent.field] = request.parent.value
    if (request.parentChoice) body[request.parentChoice.field] = parentValue

    try {
      const response = await apiFetch(`/api/employees/lists/${request.list}/`, { method: 'POST', body: JSON.stringify(body) })
      const data = await response.json().catch(() => ({}))
      if (response.ok) {
        request.onCreated(data)  // le formulaire l'ajoute à la liste et la choisit
        onClose()
        return
      }
      if (response.status === 400) {
        // Le premier message de Django : doublon ("Cette valeur existe déjà."), nom vide...
        const messages = data.non_field_errors ?? data.name ?? data.code ?? Object.values(data)[0]
        setError(Array.isArray(messages) ? String(messages[0]) : 'Valeur invalide.')
      } else if (response.status === 403) {
        setError("Seul l'Admin RH peut ajouter une valeur.")
      } else {
        setError('Une erreur est survenue. Réessayez.')
      }
    } catch {
      setError('Impossible de joindre le serveur.')
    }
    setSaving(false)
  }

  return <form onSubmit={handleSubmit}>
    <header className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-[#192646]">Ajouter : {request.title}</h2>
        {request.parent && <p className="mt-0.5 truncate text-[11px] text-slate-500">Dans : {request.parent.label}</p>}
      </div>
      <button type="button" aria-label="Fermer" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="size-4" /></button>
    </header>

    <div className="space-y-4 px-5 py-4">
      {request.parentChoice && <div>
        <label htmlFor="add-parent" className="block text-xs font-semibold text-slate-700">{request.parentChoice.label}</label>
        <select id="add-parent" required value={parentValue} onChange={(e) => setParentValue(e.target.value)} className={cn(controlClass, 'px-2.5')}>
          <option value="">Choisir...</option>
          {request.parentChoice.options.map((option) => <option key={option.id} value={String(option.id)}>{option.name}</option>)}
        </select>
      </div>}

      {request.withCode && <div>
        <label htmlFor="add-code" className="block text-xs font-semibold text-slate-700">Code</label>
        <input id="add-code" required value={code} onChange={(e) => setCode(e.target.value)} className={controlClass} />
      </div>}

      <div>
        <label htmlFor="add-name" className="block text-xs font-semibold text-slate-700">Nom</label>
        <input id="add-name" required autoFocus value={name} onChange={(e) => { setName(e.target.value); setError('') }}
          aria-invalid={error ? true : undefined} aria-describedby={error ? 'add-error' : undefined} className={controlClass} />
        {error && <p id="add-error" role="alert" className="mt-1 text-[11px] font-medium text-red-600">{error}</p>}
      </div>
    </div>

    <footer className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
      <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-xs font-semibold text-slate-500 hover:text-[#23355d]">Annuler</button>
      <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-lg bg-[#23355d] px-4 py-2 text-xs font-semibold text-white hover:bg-[#192646] disabled:opacity-60">
        {saving && <Loader2 className="size-3.5 animate-spin" />} Enregistrer
      </button>
    </footer>
  </form>
}
