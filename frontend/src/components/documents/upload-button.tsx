'use client'

/* "Upload PDF" / "Replace" : un RH choisit le PDF signé -> envoyé tout de suite ; le collaborateur est prévenu.
 * Dans Document requests, l'historique de la demande, le panneau d'un document et Team approvals (là où est le RH). */
import { useRef, useState } from 'react'
import { Loader2, Upload } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import type { DocumentRequest } from '@/lib/documents'
import { cn } from '@/lib/utils'
import { sendChange } from '@/lib/workflows'
import { actionClass } from '@/components/expenses/claim-actions'

export function UploadButton({ document, onUploaded }: { document: DocumentRequest; onUploaded: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function send(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setError('')
    const form = new FormData()
    form.append('file', file)
    const result = await sendChange(() => apiFetch(`/api/documents/hr/${document.request}/upload/`, { method: 'POST', body: form }),
      'Only HR of this employee\'s pôle can upload this document.')
    setBusy(false)
    if (input.current) input.current.value = ''  // le même fichier peut être choisi à nouveau
    if ('error' in result) setError(result.error)
    else onUploaded()
  }

  return <>
    {error && <span role="alert" className="text-[11px] text-red-600">{error}</span>}
    <input ref={input} type="file" accept="application/pdf,.pdf" className="sr-only" aria-label={`PDF for ${document.doc_type}`}
      onChange={(event) => send(event.target.files?.[0])} />
    <button type="button" disabled={busy} onClick={() => input.current?.click()}
      className={cn(actionClass, !document.has_file && 'bg-[#23355d] text-white hover:bg-[#192646]')}>
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />} {document.has_file ? 'Replace' : 'Upload PDF'}
    </button>
  </>
}
