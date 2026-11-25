/*
 * Les compteurs de la sidebar (Team approvals, My tasks, Document requests) sont relus à chaque changement de page.
 * (2026-11-25, trouvé par l'utilisatrice) après "Approve" sur la MÊME page, le "1" restait. Une action qui change un
 * compteur appelle refreshCounters() : la sidebar (app-shell, useCounters) écoute ce signal et relit les nombres.
 */
export const COUNTERS_EVENT = 'sidebar-counters:refresh'

export function refreshCounters() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(COUNTERS_EVENT))
}
