'use client'

/* Le bouton "Download" d'un document prêt (partagé par "My documents" et la page des RH). */
import { useState } from 'react'
import { FileDown } from 'lucide-react'
import { fileUrl, type DocumentRequest } from '@/lib/documents'
import { getFile } from '@/lib/expenses'
import { actionClass } from '@/components/expenses/claim-actions'

export function DownloadButton({ document, label = 'Download' }: { document: DocumentRequest; label?: string }) {
  const [error, setError] = useState('')
  if (!document.has_file) return null
  return <>
    <button type="button" className={actionClass}
      onClick={async () => setError(await getFile(fileUrl(document), document.file_name || 'document.pdf', true))}>
      <FileDown className="size-3.5" /> {label}
    </button>
    {error && <span role="alert" className="text-[11px] text-red-600">{error}</span>}
  </>
}
