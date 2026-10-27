'use client'

/*
 * L'onglet "History" de la fiche : qui a changé quoi dans CE dossier, et quand (le plus récent d'abord).
 * Lu dans /api/employees/<id>/history/ (RH du pôle, Admin RH, IT), par pages de 25.
 * L'onglet est rechargé à chaque ouverture : il montre toujours le dernier enregistrement.
 */
import { useState } from 'react'
import type { HistoryEntry } from '@/lib/employees'
import { usePaged } from '@/lib/use-paged'
import { HistoryChanges, formatDateTime } from './history-changes'

export function EmployeeHistory({ employeeId }: { employeeId: number }) {
  const [page, setPage] = useState(1)
  const { data, loading, failed, retry } = usePaged<HistoryEntry>(
    `/api/employees/${employeeId}/history/`, new URLSearchParams({ page: String(page) }))

  return <section className="rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <header className="border-b border-slate-100 px-4 py-3">
      <h2 className="text-sm font-semibold text-[#192646]">History</h2>
      <p className="text-[11px] text-slate-500">Who changed what in this file, and when.</p>
    </header>

    {failed
      ? <p className="px-4 py-8 text-center text-sm text-slate-500">
          Could not load the history. <button type="button" onClick={retry} className="font-semibold text-[#23355d] hover:underline">Try again</button>
        </p>
      : !data
        ? <p className="px-4 py-8 text-center text-sm text-slate-500">Loading...</p>
        : data.results.length === 0
          ? <p className="px-4 py-8 text-center text-sm text-slate-500">No change recorded yet.</p>
          : <ol className={loading ? 'opacity-60' : undefined}>
              {data.results.map((entry) => <li key={entry.id} className="border-t border-slate-100 px-4 py-3 first:border-t-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="text-sm text-[#0F172A]">
                    <span className="font-semibold">{entry.action_label}</span>
                    <span className="text-slate-500"> by </span>
                    <span className="font-mono text-xs">{entry.actor_name}</span>
                  </p>
                  <time dateTime={entry.created_at} className="text-xs tabular-nums text-slate-500">{formatDateTime(entry.created_at)}</time>
                </div>
                <HistoryChanges changes={entry.changes} />
              </li>)}
            </ol>}

    {/* Pages : 25 lignes par page. */}
    {data && (data.next || data.previous) && <footer className="flex justify-between border-t border-slate-100 px-4 py-2.5">
      <button type="button" disabled={!data.previous || loading} onClick={() => setPage((p) => p - 1)}
        className="text-xs font-semibold text-[#23355d] hover:underline disabled:invisible">Newer</button>
      <button type="button" disabled={!data.next || loading} onClick={() => setPage((p) => p + 1)}
        className="text-xs font-semibold text-[#23355d] hover:underline disabled:invisible">Older</button>
    </footer>}
  </section>
}
