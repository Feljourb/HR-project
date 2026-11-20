'use client'

/*
 * B11 (2026-11-20, remarque de l'utilisatrice : le petit "Changes saved" vert ne se voyait pas). Standard "dirty state"
 * (GitHub, Google, Notion) pour TOUS les formulaires, un seul composant :
 * - rien n'a changé : le bouton est gris et désactivé ("No changes to save") ;
 * - quelque chose a changé : un point orange "Unsaved changes" et le bouton bleu, actif ;
 * - juste enregistré : le bouton devient vert "✓ Saved" pendant 3 secondes ;
 * - quitter / recharger la page avec des changements non enregistrés : le navigateur demande d'abord.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/** "Juste enregistré" pendant 3 secondes : [saved, flash] ; appeler flash() après un enregistrement réussi. */
export function useSavedFlash(): [boolean, () => void] {
  const [saved, setSaved] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flash = useCallback(() => {
    setSaved(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setSaved(false), 3000)
  }, [])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return [saved, flash]
}

/** Des changements pas encore enregistrés : quitter ou recharger la page demande d'abord (message du navigateur). */
export function useUnsavedWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
}

export function SaveButton({ dirty, busy, saved, label = 'Save changes', size = 'md', className }: {
  dirty: boolean; busy: boolean; saved: boolean; label?: string; size?: 'sm' | 'md'; className?: string
}) {
  const showSaved = saved && !dirty && !busy
  return <div className={cn('flex items-center gap-3', className)}>
    {dirty && !busy && <span role="status" className="flex items-center gap-1.5 text-xs font-medium text-amber-700">
      <span className="size-2 rounded-full bg-amber-500" aria-hidden /> Unsaved changes
    </span>}
    <button type="submit" disabled={!dirty || busy} title={!dirty && !showSaved ? 'No changes to save' : undefined}
      className={cn('flex items-center gap-2 rounded-lg font-semibold shadow-sm transition-colors disabled:cursor-not-allowed',
        size === 'md' ? 'px-5 py-2 text-xs' : 'px-4 py-2 text-xs',
        showSaved ? 'bg-emerald-600 text-white'
          : dirty || busy ? 'bg-[#23355d] text-white hover:bg-[#192646]'
            : 'bg-slate-200 text-slate-500 shadow-none')}>
      {busy ? <><Loader2 className="size-3.5 animate-spin" /> Saving…</>
        : showSaved ? <><Check className="size-3.5" strokeWidth={3} /> Saved</>
          : label}
    </button>
  </div>
}
