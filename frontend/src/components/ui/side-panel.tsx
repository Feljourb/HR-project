'use client'

/*
 * Un panneau qui glisse à droite (comme les grands logiciels RH) : on regarde / on remplit sans quitter la page.
 * Un vrai <dialog> : Échap ferme, le focus reste dedans, un clic sur le fond grisé ferme.
 * Le contenu n'existe que quand le panneau est ouvert : il repart propre à chaque ouverture.
 */
import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

export function SidePanel({ open, onClose, title, description, width = 640, children }: {
  open: boolean; onClose: () => void; title: string; description?: ReactNode; width?: number; children: ReactNode
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return <dialog ref={dialogRef} onClose={onClose} aria-label={title} style={{ width: `min(100vw, ${width}px)` }}
    onClick={(e) => { if (e.target === dialogRef.current) onClose() }}
    className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-dvh max-w-none overflow-y-auto border-l border-slate-200 bg-[#F8FAFC] p-0 shadow-2xl backdrop:bg-slate-900/40">
    {open && <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-slate-200 bg-white px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-[#192646]">{title}</h2>
          {description && <p className="text-xs text-slate-500">{description}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="size-4" /></button>
      </header>
      <div className="flex-1 p-5">{children}</div>
    </div>}
  </dialog>
}
