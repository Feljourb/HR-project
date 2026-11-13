'use client'

/* Le bouton "Download" d'un document prêt (partagé par "My documents" et la page des RH),
 * et "Print draft" (les RH) : le brouillon SANS signature, à imprimer, signer et tamponner à la main. */
import { useState } from 'react'
import { FileDown, Printer } from 'lucide-react'
import { fileUrl, type DocumentRequest } from '@/lib/documents'
import { getFile } from '@/lib/expenses'
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

/** "Print draft" : le brouillon sans signature (les RH seulement), à imprimer pour le signer et le tamponner. */
export function PrintButton({ document }: { document: DocumentRequest }) {
  const [error, setError] = useState('')
  if (!document.can_print) return null
  return <>
    <button type="button" className={actionClass} title="The document without signature: print it, sign it and stamp it"
      onClick={async () => setError(await getFile(`${fileUrl(document)}?draft=1`, `brouillon-${document.reference ?? document.request}.pdf`, false))}>
      <Printer className="size-3.5" /> Print draft
    </button>
    {error && <span role="alert" className="text-[11px] text-red-600">{error}</span>}
  </>
}
