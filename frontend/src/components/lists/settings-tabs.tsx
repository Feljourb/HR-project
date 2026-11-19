'use client'

/*
 * Des onglets pour une page de réglages (2026-11-19, demande de l'utilisatrice : "tout au même endroit, mais la page
 * est trop longue"). Standard Workday / BambooHR : UNE page, une section visible à la fois.
 * - Chaque onglet : une icône, un nom court, et une phrase qui dit ce qu'on y trouve.
 * - Le dernier onglet ouvert est gardé (localStorage, seulement un confort : sans lui, le 1er onglet).
 * Un composant partagé : prêt pour Réglages des notes de frais et des documents (règle "one shared thing = one component").
 */
import { useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export type SettingsTab = { id: string; label: string; icon: LucideIcon; hint: string; content: ReactNode }

function remembered(storageKey: string, tabs: SettingsTab[]) {
  try {
    const saved = window.localStorage.getItem(storageKey)
    if (saved && tabs.some((tab) => tab.id === saved)) return saved
  } catch { /* stockage bloqué (navigation privée) : le 1er onglet */ }
  return tabs[0].id
}

export function SettingsTabs({ title, text, tabs, storageKey }: { title: string; text: string; tabs: SettingsTab[]; storageKey: string }) {
  const [current, setCurrent] = useState(() => (typeof window === 'undefined' ? tabs[0].id : remembered(storageKey, tabs)))
  const shown = tabs.find((tab) => tab.id === current) ?? tabs[0]

  function choose(id: string) {
    setCurrent(id)
    try { window.localStorage.setItem(storageKey, id) } catch { /* rien : seulement un confort */ }
  }

  return <div className="flex min-w-0 flex-col gap-3">
    <div className="rounded-xl border border-slate-200/80 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <h2 className="text-sm font-semibold text-[#192646]">{title}</h2>
      <p className="text-[11px] text-slate-500">{text}</p>
      <div role="tablist" aria-label={title} className="mt-3 flex flex-wrap gap-2">
        {tabs.map(({ id, label, icon: Icon }) => {
          const selected = id === shown.id
          return <button key={id} type="button" role="tab" aria-selected={selected} aria-controls={`settings-${id}`} onClick={() => choose(id)}
            className={cn('flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors',
              selected ? 'border-[#23355d] bg-[#23355d] text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-[#23355d]/40 hover:text-[#23355d]')}>
            <Icon className="size-3.5" aria-hidden /> {label}
          </button>
        })}
      </div>
      <p className="mt-2 text-[11px] text-slate-500">{shown.hint}</p>
    </div>
    <div id={`settings-${shown.id}`} role="tabpanel">{shown.content}</div>
  </div>
}
