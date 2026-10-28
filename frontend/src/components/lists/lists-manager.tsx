'use client'

/*
 * La gestion des listes de référence (Admin RH et IT) : la page /lists.
 *
 * - À gauche : les 14 listes. À droite : les valeurs de la liste choisie, actives ET désactivées (?all=1).
 * - Pour chaque valeur : Renommer, Désactiver / Réactiver (voir ValueRow).
 * - Jamais Supprimer (décision de l'encadrant) : une valeur désactivée reste sur les anciens
 *   dossiers, mais n'est plus proposée dans les formulaires.
 * - Organisation (Directions, Services, Postes) : on choisit d'abord les niveaux au-dessus
 *   (Entité -> Direction...), car un même nom ("Ventes") existe dans plusieurs entités.
 */
import { useEffect, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import { AddValueDialog, type AddRequest } from '@/components/employees/add-value-dialog'
import { SelectField } from '@/components/employees/form-fields'
import { useList } from '@/components/employees/use-list'
import { ORGANISATION, OTHER_LISTS, filtersOf, type ListConfig, type ListValue } from './lists-config'
import { ValueRow } from './value-row'

// Le choix fait dans un filtre : l'id (pour l'API) et le nom (pour "Dans : Challenge").
type Choice = { id: string; label: string }

const byName = (a: ListValue, b: ListValue) => a.name.localeCompare(b.name, 'fr')

export function ListsManager() {
  const [current, setCurrent] = useState<ListConfig>(ORGANISATION[0])
  // Les filtres choisis, par liste : { entities: {id: "3", label: "Challenge"}, directions: {...} }.
  // Gardés quand on change de liste : l'entité choisie pour les directions sert aussi pour les services.
  const [filters, setFilters] = useState<Record<string, Choice>>({})
  const [search, setSearch] = useState('')
  const [addRequest, setAddRequest] = useState<AddRequest | null>(null)

  const chain = filtersOf(current)
  // Le parent direct de la liste (ex. la direction choisie pour les services), s'il y en a un.
  const parent = chain.length > 0 ? filters[chain[chain.length - 1].name] : undefined
  const ready = !current.parentField || Boolean(parent?.id)

  // --- Les valeurs de la liste (actives et désactivées) ---
  // La "clé" de la requête, ex. "departments/?all=1&direction=4" ; null tant que le parent manque.
  const key = ready ? `${current.name}/?all=1${current.parentField ? `&${current.parentField}=${parent?.id}` : ''}` : null
  const [loaded, setLoaded] = useState<{ key: string; items: ListValue[] } | null>(null)
  const [failedKey, setFailedKey] = useState<string | null>(null)

  useEffect(() => {
    if (key === null) return
    // Si on change de liste avant la réponse, on annule l'ancienne requête.
    const controller = new AbortController()
    apiFetch(`/api/employees/lists/${key}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status))
        setLoaded({ key, items: await response.json() })
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailedKey(key)
      })
    return () => controller.abort()
  }, [key])

  // Seulement la réponse de la liste affichée (jamais celle de la liste d'avant).
  const items = key !== null && loaded?.key === key ? loaded.items : null
  const shown = (items ?? []).filter((item) => item.name.toLowerCase().includes(search.trim().toLowerCase()))
  const inactiveCount = (items ?? []).filter((item) => !item.is_active).length

  // Met à jour la liste affichée sans la recharger (après Renommer, Désactiver, Supprimer, Ajouter).
  function update(change: (items: ListValue[]) => ListValue[]) {
    setLoaded((value) => value && { ...value, items: change(value.items) })
  }

  function chooseList(list: ListConfig) {
    setCurrent(list)
    setSearch('')
  }

  // Changer un filtre vide les filtres en dessous (comme la cascade du formulaire).
  function chooseFilter(index: number, choice: Choice) {
    setFilters((value) => {
      const next = { ...value, [chain[index].name]: choice }
      for (const level of chain.slice(index + 1)) delete next[level.name]
      return next
    })
  }

  function openAdd() {
    setAddRequest({
      list: current.name,
      title: current.singular,
      parent: current.parentField && parent ? { field: current.parentField, value: parent.id, label: parent.label } : undefined,
      withCode: current.withCode,
      onCreated: (item) => update((list) => [...list, item].sort(byName)),
    })
  }

  return <div className="flex flex-col gap-4">
    <AddValueDialog request={addRequest} onClose={() => setAddRequest(null)} />

    <div>
      <h1 className="text-lg font-semibold text-[#192646]">Reference lists</h1>
      <p className="text-xs text-slate-500">The values of the dropdown lists. Values are never deleted: deactivate a value to stop offering it.</p>
    </div>

    <div className="grid items-start gap-4 lg:grid-cols-[230px_1fr]">
      {/* Les 14 listes. */}
      <nav aria-label="Lists" className="rounded-xl border border-slate-200/80 bg-white p-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        {[{ label: 'Organisation', lists: ORGANISATION }, { label: 'Other lists', lists: OTHER_LISTS }].map((group) => (
          <div key={group.label} className="mb-2 last:mb-0">
            <p className="px-2.5 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">{group.label}</p>
            {group.lists.map((list) => (
              <button key={list.name} type="button" onClick={() => chooseList(list)} aria-current={list.name === current.name ? 'page' : undefined}
                className={cn('block w-full rounded-md px-2.5 py-1.5 text-left text-[13px] font-medium',
                  list.name === current.name ? 'bg-[#23355d] text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-[#23355d]')}>
                {list.title}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <section className="min-w-0 rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <header className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-[#192646]">{current.title}</h2>
            <p className="text-[11px] text-slate-500">
              {items ? `${items.length} values${inactiveCount ? ` · ${inactiveCount} inactive` : ''}` : ' '}
            </p>
          </div>
          <button type="button" onClick={openAdd} disabled={!ready}
            className="flex items-center gap-1.5 rounded-lg bg-[#23355d] px-3 py-2 text-xs font-semibold text-white hover:bg-[#192646] disabled:cursor-not-allowed disabled:opacity-50">
            <Plus className="size-3.5" /> Add a value
          </button>
        </header>

        {/* Organisation : les niveaux au-dessus, à choisir d'abord. */}
        {chain.length > 0 && <div className="grid gap-3 border-b border-slate-100 px-4 py-3 sm:grid-cols-3">
          {chain.map((level, index) => {
            // Le premier filtre n'a pas de parent ; les suivants dépendent du filtre d'avant.
            const above = index > 0 ? filters[chain[index - 1].name] : undefined
            return <FilterSelect key={level.name} level={level} parentField={index > 0 ? level.parentField : undefined}
              parentValue={above?.id} value={filters[level.name]?.id ?? ''} onChange={(choice) => chooseFilter(index, choice)} />
          })}
        </div>}

        {ready && <div className="relative border-b border-slate-100 px-4 py-2.5">
          <Search className="absolute left-7 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
          <label htmlFor="list-search" className="sr-only">Search in this list</label>
          <input id="list-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..."
            className="h-8 w-full max-w-xs rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 text-xs outline-none focus:border-[#23355d] focus:bg-white" />
        </div>}

        {!ready
          ? <p className="px-4 py-10 text-center text-sm text-slate-500">Choose the {chain[chain.length - 1].singular.toLowerCase()} above.</p>
          : failedKey === key && items === null
            ? <p className="px-4 py-10 text-center text-sm text-slate-500">Could not load this list. Please try again later.</p>
            : items === null
              ? <p className="px-4 py-10 text-center text-sm text-slate-500">Loading...</p>
              : shown.length === 0
                ? <p className="px-4 py-10 text-center text-sm text-slate-500">{search ? 'No value matches this search.' : 'No value yet.'}</p>
                : <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px]">
                      <thead>
                        <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          <th className="px-4 py-2">Name</th>
                          {current.withCode && <th className="px-4 py-2">Code</th>}
                          <th className="px-4 py-2">Status</th>
                          <th className="px-4 py-2 text-right"><span className="sr-only">Actions</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* key avec le nom de la liste : une ligne en cours de modification ne passe jamais à une autre liste. */}
                        {shown.map((item) => <ValueRow key={`${current.name}-${item.id}`} list={current.name} item={item} withCode={current.withCode}
                          onChanged={(changed) => update((list) => list.map((value) => (value.id === changed.id ? changed : value)).sort(byName))} />)}
                      </tbody>
                    </table>
                  </div>}
      </section>
    </div>
  </div>
}

type FilterSelectProps = {
  level: ListConfig
  parentField?: string
  parentValue?: string
  value: string
  onChange: (choice: Choice) => void
}

// Un filtre de la cascade (ex. "Entité"). Un composant à part : chaque filtre charge sa propre liste (useList).
function FilterSelect({ level, parentField, parentValue, value, onChange }: FilterSelectProps) {
  const { items } = useList(level.name, parentField ? { parent: { field: parentField, value: parentValue } } : {})
  return <SelectField id={`filter-${level.name}`} label={level.singular} value={value} options={items}
    placeholder={parentField && !parentValue ? 'Choose the level above first' : `Choose...`} disabled={Boolean(parentField && !parentValue)}
    onChange={(id) => onChange({ id, label: items.find((item) => String(item.id) === id)?.name ?? '' })} />
}
