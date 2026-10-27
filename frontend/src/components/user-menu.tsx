'use client'

/*
 * Le menu du compte : on clique sur l'avatar (en haut à droite) ou sur la carte en bas
 * de la sidebar -> Mon profil, Changer le mot de passe, Se déconnecter.
 *
 * Le Menu de Base UI (déjà utilisé pour les onglets) fait le travail "standard" pour nous :
 * flèches du clavier, Entrée, Échap, clic dehors pour fermer, et lecteurs d'écran.
 */
import type { ReactNode } from 'react'
import Link from 'next/link'
import { Menu } from '@base-ui/react/menu'
import { KeyRound, LogOut, UserRound } from 'lucide-react'
import { roleLabel, type Me } from '@/lib/api'
import { cn } from '@/lib/utils'

// data-highlighted : l'option survolée à la souris ou choisie avec les flèches.
const itemClass = 'flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium text-slate-700 outline-none data-highlighted:bg-slate-100 data-highlighted:text-[#23355d]'

type UserMenuProps = {
  me: Me
  displayName: string
  onLogout: () => void
  children: ReactNode            // ce qu'on clique : l'avatar du header, ou la carte de la sidebar
  triggerClassName?: string
  side?: 'bottom' | 'top'        // où s'ouvre le menu (en haut pour la carte en bas de la sidebar)
  align?: 'start' | 'end'
}

export function UserMenu({ me, displayName, onLogout, children, triggerClassName, side = 'bottom', align = 'end' }: UserMenuProps) {
  return <Menu.Root>
    {/* Le bouton qui ouvre le menu (Base UI ajoute aria-expanded, aria-haspopup...). */}
    <Menu.Trigger aria-label="Account menu" className={triggerClassName}>{children}</Menu.Trigger>

    {/* Portal : le menu est dessiné au-dessus de toute la page (pas coupé par la sidebar). */}
    <Menu.Portal>
      <Menu.Positioner side={side} align={align} sideOffset={8} className="z-50">
        <Menu.Popup className="w-60 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg shadow-slate-900/10 outline-none">
          <div className="px-2.5 py-2">
            <p className="truncate text-sm font-semibold text-[#192646]">{displayName}</p>
            <p className="truncate text-xs text-slate-500">{roleLabel(me.role)}</p>
          </div>
          <Menu.Separator className="my-1 h-px bg-slate-100" />

          {/* LinkItem + render={<Link />} : un vrai lien Next.js (sans recharger la page). */}
          <Menu.LinkItem closeOnClick render={<Link href="/profile" />} className={itemClass}>
            <UserRound className="size-4" /> My Profile
          </Menu.LinkItem>
          <Menu.LinkItem closeOnClick render={<Link href="/change-password" />} className={itemClass}>
            <KeyRound className="size-4" /> Change password
          </Menu.LinkItem>
          <Menu.Separator className="my-1 h-px bg-slate-100" />

          <Menu.Item onClick={onLogout} className={cn(itemClass, 'text-red-600 data-highlighted:bg-red-50 data-highlighted:text-red-700')}>
            <LogOut className="size-4" /> Log out
          </Menu.Item>
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  </Menu.Root>
}
