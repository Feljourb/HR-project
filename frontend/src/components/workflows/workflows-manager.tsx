'use client'

/*
 * La page "Workflows" d'Admin RH : les circuits de validation, et le DG de chaque pôle.
 * Les deux listes sont chargées une fois ; après chaque modification, Django renvoie la
 * nouvelle version et on la remplace dans la page (sans tout recharger).
 */
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import type { PoleDirector, Workflow } from '@/lib/workflows'
import { CircuitCard } from './circuit-card'
import { DirectorsSection } from './directors-section'

type Data = { workflows: Workflow[]; poles: PoleDirector[] }

// Remplace un élément de la liste par sa nouvelle version (ou l'ajoute à la fin s'il est nouveau).
function put<T extends { id: number }>(list: T[], item: T) {
  return list.some((old) => old.id === item.id) ? list.map((old) => (old.id === item.id ? item : old)) : [...list, item]
}

export function WorkflowsManager() {
  const [data, setData] = useState<Data | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    // Les deux en même temps (Promise.all) : la page attend la plus lente, pas la somme des deux.
    Promise.all(['/api/workflows/', '/api/workflows/poles/'].map(async (path) => {
      const response = await apiFetch(path)
      if (!response.ok) throw new Error(String(response.status))
      return response.json()
    }))
      .then(([workflows, poles]) => setData({ workflows, poles }))
      .catch(() => setFailed(true))
  }, [])

  return <div className="flex flex-col gap-6">
    <div>
      <h1 className="text-lg font-semibold text-[#192646]">Workflows</h1>
      <p className="text-xs text-slate-500">
        Who validates each type of request, and in which order. A request already sent keeps the circuit it had.
      </p>
    </div>

    {!data
      ? <p className="rounded-xl border border-slate-200 bg-white px-4 py-12 text-center text-sm text-slate-500">
          {failed ? 'Could not load the workflows. Please try again later.' : 'Loading...'}
        </p>
      : <>
          <section className="flex flex-col gap-3">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">Circuits</h2>
            <div className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              {data.workflows.map((workflow) => <CircuitCard key={workflow.id} workflow={workflow}
                onSaved={(saved) => setData((value) => value && { ...value, workflows: put(value.workflows, saved) })} />)}
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">DG</h2>
            <DirectorsSection poles={data.poles}
              onPole={(pole) => setData((value) => value && { ...value, poles: put(value.poles, pole) })} />
          </section>
        </>}
  </div>
}
