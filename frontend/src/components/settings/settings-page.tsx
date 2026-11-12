'use client'

/*
 * La page Settings (2026-11-12, 2e version : le standard de GitHub / Google / Jira, demandée par l'utilisateur) :
 * - à gauche, les SECTIONS (une ligne chacune) : on en ajoutera d'autres plus tard (une ligne dans SECTIONS) ;
 * - à droite, la section choisie.
 * Aujourd'hui : "Notifications" (ici) et "Password" (la page qui existe déjà : /change-password).
 */
import { useState } from 'react'
import Link from 'next/link'
import { Bell, KeyRound, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { NotificationSettings } from './notification-settings'

type Section = { id: string; label: string; icon: LucideIcon; href?: string }

const SECTIONS: Section[] = [
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'password', label: 'Password', icon: KeyRound, href: '/change-password' },  // une page à part (déjà là)
]

export function SettingsPage() {
  const [current, setCurrent] = useState('notifications')

  return <div className="mx-auto flex max-w-5xl flex-col gap-5">
    <div>
      <h1 className="text-lg font-semibold text-[#192646]">Settings</h1>
      <p className="text-xs text-slate-500">Your personal settings. They only change what you receive and see.</p>
    </div>

    <div className="grid items-start gap-5 md:grid-cols-[200px_minmax(0,1fr)]">
      {/* Les sections : en colonne sur ordinateur, en ligne sur téléphone. */}
      <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto md:flex-col">
        {SECTIONS.map(({ id, label, icon: Icon, href }) => {
          const className = cn('flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
            current === id && !href ? 'bg-white text-[#192646] shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:bg-white/70 hover:text-[#192646]')
          return href
            ? <Link key={id} href={href} className={className}><Icon className="size-4" aria-hidden /> {label}</Link>
            : <button key={id} type="button" onClick={() => setCurrent(id)} aria-current={current === id ? 'page' : undefined} className={className}>
                <Icon className="size-4" aria-hidden /> {label}
              </button>
        })}
      </nav>

      {current === 'notifications' && <NotificationSettings />}
    </div>
  </div>
}
