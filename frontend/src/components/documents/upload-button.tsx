'use client'

/* "Upload PDF" (les RH) : le PDF signé et scanné, livré au collaborateur (🔔 + email "Document prêt").
 * Dans Document requests, l'historique de la demande, le panneau d'un document et Team approvals (là où est le RH).
 * Deux temps (2026-11-13, retour de l'utilisatrice : le fichier partait dès qu'on le choisissait, sans vérifier) :
 * 1. choisir le fichier -> on voit son nom, sa taille, "Preview" pour l'ouvrir ; un fichier qui n'est pas un PDF de
 *    5 Mo au plus est refusé tout de suite ;
 * 2. "Send" l'envoie ; "Cancel" n'envoie rien.
 * Livré, il ne se remplace plus (pas de "Replace" : la trace ; une erreur = une nouvelle demande). */
import { useEffect, useRef, useState } from 'react'
import { Eye, FileText, Loader2, Send, Upload, X } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import type { DocumentRequest } from '@/lib/documents'
import { cn } from '@/lib/utils'
import { sendChange } from '@/lib/workflows'
import { actionClass } from '@/components/expenses/claim-actions'

const MAX_SIZE = 5 * 1024 * 1024  // la même limite que Django

export function UploadButton({ document, onUploaded }: { document: DocumentRequest; onUploaded: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [chosen, setChosen] = useState<{ file: File; url: string } | null>(null)  // choisi, pas encore envoyé
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // L'adresse d'aperçu du fichier choisi est libérée quand on en choisit un autre ou qu'on quitte.
  useEffect(() => () => { if (chosen) URL.revokeObjectURL(chosen.url) }, [chosen])

  function pick(file: File | undefined) {
    if (input.current) input.current.value = ''  // le même fichier peut être choisi à nouveau
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.pdf')) return setError('Only a PDF (the signed, scanned document).')
    if (file.size > MAX_SIZE) return setError('The file is larger than 5 MB.')
    setError('')
    setChosen({ file, url: URL.createObjectURL(file) })
  }

  async function send() {
    if (!chosen) return
    setBusy(true)
    setError('')
    const form = new FormData()
    form.append('file', chosen.file)
    const result = await sendChange(() => apiFetch(`/api/documents/hr/${document.request}/upload/`, { method: 'POST', body: form }),
      'Only HR of this employee\'s pôle can upload this document.')
    setBusy(false)
    if ('error' in result) return setError(result.error)
    setChosen(null)
    onUploaded()
  }

  return <>
    <input ref={input} type="file" accept="application/pdf,.pdf" className="sr-only" aria-label={`PDF for ${document.doc_type}`}
      onChange={(event) => pick(event.target.files?.[0])} />
    {chosen
      // 2. Vérifier avant d'envoyer.
      ? <span className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1">
          <FileText className="size-3.5 shrink-0 text-slate-500" aria-hidden />
          <span className="max-w-40 truncate text-[11px] font-medium text-[#192646]" title={chosen.file.name}>{chosen.file.name}</span>
          <span className="text-[10px] text-slate-400">{Math.max(1, Math.round(chosen.file.size / 1024))} KB</span>
          <a href={chosen.url} target="_blank" rel="noreferrer" className={actionClass}><Eye className="size-3.5" /> Preview</a>
          <button type="button" disabled={busy} onClick={() => setChosen(null)} className={cn(actionClass, 'text-slate-600')}>
            <X className="size-3.5" /> Cancel
          </button>
          <button type="button" disabled={busy} onClick={send} className={cn(actionClass, 'bg-[#23355d] text-white hover:bg-[#192646]')}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Send to the employee
          </button>
          <span className="w-full text-[10px] text-slate-500">Once sent, the document cannot be replaced: check it with Preview.</span>
        </span>
      // 1. Choisir le fichier.
      : <button type="button" onClick={() => input.current?.click()} className={cn(actionClass, 'bg-[#23355d] text-white hover:bg-[#192646]')}>
          <Upload className="size-3.5" /> Upload PDF
        </button>}
    {error && <span role="alert" className="text-[11px] text-red-600">{error}</span>}
  </>
}
