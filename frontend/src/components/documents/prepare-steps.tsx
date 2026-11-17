'use client'

/*
 * "To prepare", clair pour les RH (2026-11-17, l'utilisatrice : "makatbansh wadha") : les 3 étapes écrites, et leurs
 * boutons TOUJOURS à la même place :
 *   ① Download (le brouillon d'un document généré, ou le modèle Word du type) + Customize (facultatif : le texte)
 *   ② Sign & stamp (à la main, rien à cliquer)
 *   ③ ce qui reste selon le format : Upload the signed PDF, et / ou Original ready.
 * Utilisé dans Document requests et dans la carte "Next step" de Team approvals.
 */
import { ArrowRight } from 'lucide-react'
import type { DocumentRequest } from '@/lib/documents'
import { cn } from '@/lib/utils'
import { PrintButton } from './download-button'
import { OriginalButtons } from './original-buttons'
import { TextEditorButton } from './text-editor'
import { UploadButton } from './upload-button'

export function PrepareSteps({ document, onChanged }: { document: DocumentRequest; onChanged: (message: string) => void }) {
  if (document.state !== 'TO_PREPARE') return null
  const who = `${document.doc_type} for ${document.employee}`
  const upload = document.can_upload && !document.has_file
  const original = document.original_state === 'TO_SIGN'
  // ① : télécharger (si quelque chose existe) ; sinon le préparer dans son outil (Word, paie...).
  const first = document.needs_review ? 'Customize the text' : document.hr_download === 'draft' ? 'Download'
    : document.hr_download === 'model' ? 'Download the model' : 'Prepare it'
  const last = [upload && 'Upload the signed PDF', original && 'Original ready'].filter(Boolean).join(' + ') || 'Send'
  const steps = [first, 'Sign & stamp', last]
  // L'étape à faire maintenant : la 1re tant que le texte doit être relu, sinon la dernière (le bouton qui termine).
  const current = document.needs_review ? 0 : 2

  return <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-slate-50 px-3 py-2">
    <ol aria-label="Steps to prepare this document" className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-[11px]">
      {steps.map((step, index) => <li key={step} className="flex items-center gap-1">
        {index > 0 && <ArrowRight className="size-3 text-slate-300" aria-hidden />}
        <span className={cn('flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold',
          index === current ? 'bg-[#23355d] text-white' : 'text-slate-500')}>
          <span className={cn('flex size-4 items-center justify-center rounded-full text-[9px]',
            index === current ? 'bg-white/20' : 'bg-slate-200 text-slate-600')}>{index + 1}</span>
          {step}
        </span>
      </li>)}
    </ol>
    <div className="flex flex-wrap items-center gap-1">
      <PrintButton document={document} />
      <TextEditorButton document={document} onSaved={(updated) => onChanged(updated.state === 'READY'
        ? `Sent to the employee: ${who}.` : `Text saved: ${who}. Download it again to print the new text.`)} />
      {upload && <UploadButton document={document} onUploaded={() => onChanged(`Sent to the employee: ${who}. They get a notification and an email.`)} />}
      <OriginalButtons document={document} onDone={() => onChanged(`Original ready at the HR office: ${who}. The employee is notified.`)} />
    </div>
  </div>
}
