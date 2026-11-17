'use client'

/* Le bouton "Download" d'un document prêt (partagé par "My documents" et la page des RH),
 * et le "Download" des RH pour PRÉPARER un document (2026-11-17) : le brouillon sans signature (document généré),
 * ou le modèle Word / PDF de son type (mis par Admin RH), à compléter, imprimer, signer et tamponner. */
import { useState } from 'react'
import { FileDown } from 'lucide-react'
import { fileUrl, type DocumentRequest } from '@/lib/documents'
import { getFile } from '@/lib/expenses'
import { cn } from '@/lib/utils'
import { actionClass } from '@/components/expenses/claim-actions'

export function DownloadButton({ document, label = 'Download' }: { document: DocumentRequest; label?: string }) {
  const [error, setError] = useState('')
  if (!document.can_download) return null  // pas encore livré, ou "original" seul (le collaborateur attend le papier)
  return <>
    <button type="button" className={actionClass}
      onClick={async () => setError(await getFile(fileUrl(document), document.file_name || 'document.pdf', true))}>
      <FileDown className="size-3.5" /> {label}
    </button>
    {error && <span role="alert" className="text-[11px] text-red-600">{error}</span>}
  </>
}

/** ① "Download" des RH, tant que le document est à préparer : le brouillon (généré) ou le modèle Word du type.
 *  (Ancien nom PrintButton : le même bouton dans l'historique, le panneau et Team approvals.) */
export function PrintButton({ document, strong = false }: { document: DocumentRequest; strong?: boolean }) {
  const [error, setError] = useState('')
  if (!document.hr_download || document.state !== 'TO_PREPARE') return null
  const draft = document.hr_download === 'draft'
  return <>
    <button type="button" className={cn(actionClass, strong && 'bg-[#23355d] text-white hover:bg-[#192646]')}
      title={draft ? 'The document filled in from the HR file, without signature: print, sign and stamp it'
        : 'The company model (Word / PDF): complete it, print, sign and stamp it'}
      onClick={async () => setError(await getFile(`/api/documents/hr/${document.id}/download/`,
        draft ? `brouillon-${document.reference ?? document.id}.pdf` : document.model_name || document.doc_type, true))}>
      <FileDown className="size-3.5" /> {draft ? 'Download' : 'Download model'}
    </button>
    {error && <span role="alert" className="text-[11px] text-red-600">{error}</span>}
  </>
}
