'use client'

/*
 * Step 3 (2026-11-16, standard Workday "Review document") : un RH relit et complète le TEXTE d'un document généré
 * (l'attestation de travail) avant qu'il parte. Seulement le corps : l'en-tête, la référence et la signature ne
 * changent pas. Un panneau : le texte (rempli avec la fiche), "Preview" (le PDF tel qu'il sera, rien n'est enregistré),
 * puis "Save" : signé par l'application -> livré au collaborateur ; à signer à la main -> le brouillon à imprimer.
 * Le bouton : "Review & send" quand la relecture est demandée (rien n'est parti), sinon "Edit text".
 */
import { useEffect, useState } from 'react'
import { Eye, Loader2, PenLine, Save } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import type { DocumentRequest } from '@/lib/documents'
import { cn } from '@/lib/utils'
import { sendChange } from '@/lib/workflows'
import { actionClass } from '@/components/expenses/claim-actions'
import { SidePanel } from '@/components/ui/side-panel'

export function TextEditorButton({ document, onSaved }: { document: DocumentRequest; onSaved: (updated: DocumentRequest) => void }) {
  const [open, setOpen] = useState(false)
  if (!document.can_edit_text) return null
  return <>
    <button type="button" onClick={() => setOpen(true)}
      className={cn(actionClass, document.needs_review && 'bg-[#23355d] text-white hover:bg-[#192646]')}>
      <PenLine className="size-3.5" /> {document.needs_review ? 'Review & send' : 'Edit text'}
    </button>
    <SidePanel open={open} onClose={() => setOpen(false)} width={720}
      title={`${document.doc_type} · ${document.employee}`} description="Read the text, complete it if needed, preview, then save.">
      {open && <Editor document={document} onSaved={(updated) => { setOpen(false); onSaved(updated) }} />}
    </SidePanel>
  </>
}

function Editor({ document, onSaved }: { document: DocumentRequest; onSaved: (updated: DocumentRequest) => void }) {
  const [text, setText] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const url = `/api/documents/hr/${document.request}`

  useEffect(() => {
    apiFetch(`${url}/text/`)
      .then(async (response) => { if (!response.ok) throw new Error(); setText((await response.json()).text) })
      .catch(() => setError('Could not load the text.'))
  }, [url])

  // L'aperçu : l'onglet s'ouvre PENDANT le clic (sinon le navigateur le bloque), puis reçoit le PDF.
  async function preview() {
    const tab = window.open('', '_blank')
    const response = await apiFetch(`${url}/preview-text/`, { method: 'POST', body: JSON.stringify({ text }) }).catch(() => null)
    if (!response?.ok) { tab?.close(); return setError('Could not build the preview.') }
    const address = URL.createObjectURL(await response.blob())
    if (tab) tab.location.href = address
  }

  async function save() {
    setBusy(true)
    setError('')
    const result = await sendChange<DocumentRequest>(() => apiFetch(`${url}/text/`, { method: 'POST', body: JSON.stringify({ text }) }),
      'Only HR of this employee\'s pôle can review this document.')
    setBusy(false)
    if ('error' in result) setError(result.error)
    else onSaved(result.data)
  }

  if (text === null) return <p className="py-10 text-center text-sm text-slate-500">{error || 'Loading...'}</p>
  return <div className="flex flex-col gap-3">
    <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-500">
      The header, the reference and the signature do not change. Only this text: a blank line starts a new paragraph,
      <span className="font-semibold text-slate-700"> **two stars** </span>put a word in bold.
    </p>
    <label htmlFor="document-text" className="text-xs font-semibold text-slate-700">Text of the document</label>
    <textarea id="document-text" value={text} onChange={(e) => { setText(e.target.value); setError('') }} rows={14} maxLength={5000}
      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed outline-none focus:border-[#23355d] focus:ring-3 focus:ring-[#23355d]/15" />
    {error && <p role="alert" className="text-[11px] font-medium text-red-600">{error}</p>}
    <div className="flex flex-wrap items-center justify-end gap-2">
      <button type="button" onClick={preview} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-[#23355d] hover:bg-slate-50">
        <Eye className="size-3.5" /> Preview
      </button>
      <button type="button" disabled={busy || !text.trim()} onClick={save}
        className="flex items-center gap-1.5 rounded-lg bg-[#23355d] px-4 py-2 text-xs font-semibold text-white hover:bg-[#192646] disabled:opacity-50">
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} {document.needs_review ? 'Approve the text' : 'Save the text'}
      </button>
    </div>
    <p className="text-right text-[11px] text-slate-500">Signed by the app: it is sent to the employee. Signed by hand: the draft to print is updated.</p>
  </div>
}
