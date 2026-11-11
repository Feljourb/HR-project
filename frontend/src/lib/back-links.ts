/*
 * Le lien "retour" des pages ouvertes depuis plusieurs endroits (l'historique d'une demande, une note de frais) :
 * la page qui ouvre ajoute ?from=... à l'adresse, et le retour y ramène avec son nom ("← Leave requests").
 * Dans l'ADRESSE (pas "page précédente" du navigateur) : un lien ouvert dans un nouvel onglet, ou partagé, a
 * toujours le bon retour. Un from inconnu ou absent (ex. un lien de la cloche) : le retour par défaut de la page.
 */
export type BackLink = { href: string; label: string }

const PAGES: Record<string, BackLink> = {
  requests: { href: '/requests', label: 'My requests' },
  leaves: { href: '/leaves', label: 'Leave requests' },
  approvals: { href: '/approvals', label: 'Team approvals' },
  absences: { href: '/absences', label: 'Absences' },
  'leave-balances': { href: '/leave-balances', label: 'Leave balances' },
  expenses: { href: '/expenses', label: 'Expense claims' },
  reimbursements: { href: '/reimbursements', label: 'Reimbursements' },
  dashboard: { href: '/', label: 'Dashboard' },
}

/** ?from=requests -> {href: "/requests", label: "My requests"} ; ?from=claim-36 -> la note de frais n° 36. */
export function backLink(from: string | null | undefined, fallback: BackLink): BackLink {
  if (!from) return fallback
  const claim = /^claim-(\d+)$/.exec(from)
  if (claim) return { href: `/expenses/${claim[1]}`, label: 'Expense claim' }
  return PAGES[from] ?? fallback
}
