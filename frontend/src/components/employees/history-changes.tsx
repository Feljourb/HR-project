/*
 * Les champs changés d'une ligne d'historique : "Téléphone : 0600... → 0611...".
 * Utilisé par l'onglet History de la fiche et par la page Audit log.
 * Un secret (RIB, CNSS, CIMR) arrive sans numéros : on affiche seulement "modifié".
 */
import type { HistoryEntry } from '@/lib/employees'

/** "2026-10-27T14:05:12+01:00" -> "27/10/2026 14:05" */
export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
}

export function HistoryChanges({ changes }: { changes: HistoryEntry['changes'] }) {
  if (changes.length === 0) return null
  return <ul className="mt-1.5 space-y-0.5 text-xs text-slate-600">
    {changes.map((change, index) => <li key={index}>
      <span className="font-semibold text-slate-700">{change.field}</span>
      {change.hidden
        ? <span className="text-slate-500"> : modifié (numéro masqué)</span>
        : <> : <span className="text-slate-500 line-through decoration-slate-300">{change.old || '—'}</span> → {change.new || '—'}</>}
    </li>)}
  </ul>
}
