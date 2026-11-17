'use client'

/*
 * Une ligne "To prepare", claire pour les RH (2026-11-17, l'utilisatrice : "mawadhash, kadewkh") : les étapes en mots,
 * et UN seul bouton, "Prepare", qui ouvre le panneau où tout se fait dans l'ordre (prepare-panel.tsx) :
 *   ① Check (aperçu + Customize facultatif) → ② Print (Download PDF), sign & stamp → ③ Deliver (Upload / Original ready).
 * Utilisé dans Document requests et dans la carte "Next step" de Team approvals.
 */
import { ArrowRight } from 'lucide-react'
import type { DocumentRequest } from '@/lib/documents'
import { PrepareButton } from './prepare-panel'

export function PrepareSteps({ document, onChanged }: { document: DocumentRequest; onChanged: (message: string) => void }) {
  if (document.state !== 'TO_PREPARE') return null
  const upload = document.can_upload && !document.has_file
  const original = document.original_state === 'TO_SIGN'
  const sendsAtOnce = document.hr_download === 'draft' && document.signed_by_app && document.format === 'PDF'
  const steps = sendsAtOnce ? ['Check', 'Send']
    : [document.hr_download ? 'Check' : 'Prepare it', 'Print, sign & stamp',
       [upload && 'Upload the signed PDF', original && 'Original ready'].filter(Boolean).join(' + ') || 'Deliver']

  return <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-slate-50 px-3 py-2">
    <ol aria-label="Steps to prepare this document" className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-[11px] text-slate-600">
      {steps.map((step, index) => <li key={step} className="flex items-center gap-1">
        {index > 0 && <ArrowRight className="size-3 text-slate-300" aria-hidden />}
        <span className="flex size-4 items-center justify-center rounded-full bg-slate-200 text-[9px] font-bold text-slate-600">{index + 1}</span>
        <span className="font-medium">{step}</span>
      </li>)}
      {document.needs_review && <li className="ml-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">Text to read first</li>}
    </ol>
    <PrepareButton document={document} onChanged={onChanged} />
  </div>
}
