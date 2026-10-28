'use client'

/*
 * Le garde des pages RH (/employees, /employees/new, /employees/7, /audit) : bloque les non-RH.
 * La connexion et le cadre (sidebar + header) sont déjà gérés par app/(app)/layout.tsx.
 */
import type { ReactNode } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Panel } from '@/components/dashboard/panel'
import { isHr, type Me } from '@/lib/api'
import { SignedIn } from '@/lib/current-user'

// children : le contenu, qui reçoit l'utilisateur connecté.
export function HrPage({ children }: { children: (me: Me) => ReactNode }) {
  return <SignedIn>
    {(me) => isHr(me) ? children(me) : (
      // Quelqu'un qui tape l'adresse à la main sans être RH. (L'API refuserait de toute façon : 403.)
      <Panel className="items-center gap-2 px-4 py-12 text-center">
        <ShieldCheck className="size-6 text-[#8C6D52]" />
        <p className="text-sm font-semibold text-[#192646]">Access restricted</p>
        <p className="text-xs text-slate-500">This page is reserved for the HR team.</p>
      </Panel>
    )}
  </SignedIn>
}
