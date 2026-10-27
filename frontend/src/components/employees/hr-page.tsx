'use client'

/*
 * Le cadre des pages RH (/employees, /employees/new, /employees/7) :
 * vérifie la connexion (useMe), affiche AppShell, et bloque les non-RH.
 */
import type { ReactNode } from 'react'
import { ShieldCheck } from 'lucide-react'
import { AppShell } from '@/components/app-shell'
import { Panel } from '@/components/dashboard/panel'
import { isHr, type Me } from '@/lib/api'
import { useMe } from '@/lib/use-me'

type HrPageProps = {
  page: string                      // le fil d'Ariane, ex. "New employee"
  active?: string                   // le lien surligné dans la sidebar (par défaut "Employees")
  children: (me: Me) => ReactNode   // le contenu, qui reçoit l'utilisateur connecté
}

export function HrPage({ page, active = 'Employees', children }: HrPageProps) {
  const { me, logout } = useMe()

  if (me === null) {
    return <p className="m-auto text-sm text-slate-500">Loading...</p>
  }

  return <AppShell me={me} onLogout={logout} active={active} breadcrumb={['Management & HR', page]}>
    {isHr(me) ? children(me) : (
      // Quelqu'un qui tape l'adresse à la main sans être RH. (L'API refuserait de toute façon : 403.)
      <Panel className="items-center gap-2 px-4 py-12 text-center">
        <ShieldCheck className="size-6 text-[#8C6D52]" />
        <p className="text-sm font-semibold text-[#192646]">Access restricted</p>
        <p className="text-xs text-slate-500">This page is reserved for the HR team.</p>
      </Panel>
    )}
  </AppShell>
}
