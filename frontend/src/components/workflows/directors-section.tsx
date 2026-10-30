'use client'

/*
 * Le DG de chaque pôle. Le DG est un collaborateur comme les autres (décision de l'encadrant) :
 * un dossier RH et un compte "Manager", tout en haut de l'organigramme. On le cherche par son nom
 * (la même recherche que le manager N+1), et le choix est enregistré tout de suite.
 * Les règles (pas de DG "Sorti") sont vérifiées par Django : on affiche sa réponse.
 */
import { useState } from 'react'
import { apiFetch } from '@/lib/api'
import { ManagerPicker } from '@/components/employees/manager-picker'
import { sendChange, type PoleDirector } from '@/lib/workflows'

export function DirectorsSection({ poles, onPole }: { poles: PoleDirector[]; onPole: (pole: PoleDirector) => void }) {
  return <section className="rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <header className="border-b border-slate-100 px-4 py-3">
      <h3 className="text-sm font-semibold text-[#192646]">DG of each pôle</h3>
      <p className="text-[11px] text-slate-500">
        The DG is an employee (HR file + Manager account) and answers the &quot;DG du pôle&quot; steps. Saved as soon as you choose.
      </p>
    </header>
    <div className="grid gap-4 p-4 sm:grid-cols-2">
      {poles.map((pole) => <PoleRow key={pole.id} pole={pole} onChanged={onPole} />)}
    </div>
  </section>
}

// Un pôle : la recherche du DG. Choisir ou enlever (croix) l'enregistre aussitôt.
function PoleRow({ pole, onChanged }: { pole: PoleDirector; onChanged: (pole: PoleDirector) => void }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function choose(id: string) {
    setBusy(true)
    setError('')
    const result = await sendChange<PoleDirector>(() =>
      apiFetch(`/api/workflows/poles/${pole.id}/`, { method: 'PATCH', body: JSON.stringify({ director: id ? Number(id) : null }) }))
    if ('data' in result) onChanged(result.data)
    else setError(result.error)  // ex. "Un collaborateur sorti ne peut pas être DG."
    setBusy(false)
  }

  return <ManagerPicker id={`pole-dg-${pole.id}`} fieldLabel={pole.name} placeholder="Search the DG..." disabled={busy}
    value={pole.director ? String(pole.director) : ''} label={pole.director_label ?? ''} error={error}
    onChange={(id) => choose(id)} />
}
