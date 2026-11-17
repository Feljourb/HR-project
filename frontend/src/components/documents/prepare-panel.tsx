'use client'

/*
 * "Prepare" (2026-11-17, l'utilisatrice : "Document requests mawadhash, kadewkh") : UN bouton par document à préparer,
 * qui ouvre ce panneau. Tout le travail des RH y est, dans l'ordre, sans chercher :
 *   ① Check     : l'aperçu du document rempli avec la fiche (PDF) ; "Customize" (facultatif) change le texte, l'aperçu suit ;
 *   ② Print     : "Download PDF" (le texte du moment est enregistré d'abord) -> imprimer, signer, tamponner ;
 *                 signature posée par l'application et PDF seul : pas d'impression, "Send to the employee" ;
 *   ③ Deliver   : déposer le PDF signé et scanné, et / ou "Original ready".
 * Un type préparé à partir d'un modèle Word : ① "Download the Word" (rempli avec la fiche) ; sans modèle : on le dit.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Eye, FileDown, Loader2, PenLine, Send, Wand2 } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import type { DocumentRequest } from '@/lib/documents'
import { getFile } from '@/lib/expenses'
import { formatDate } from '@/lib/leaves'
import { cn } from '@/lib/utils'
import { sendChange } from '@/lib/workflows'
import { SidePanel } from '@/components/ui/side-panel'
import { OriginalButtons } from './original-buttons'
import { UploadButton } from './upload-button'

const primary = 'flex items-center gap-1.5 rounded-lg bg-[#23355d] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#192646] disabled:opacity-50'
const secondary = 'flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-[#23355d] hover:bg-slate-50 disabled:opacity-50'

/** Le bouton "Prepare" d'une ligne (Document requests, Team approvals) et son panneau. */
export function PrepareButton({ document, onChanged }: { document: DocumentRequest; onChanged: (message: string) => void }) {
  const [open, setOpen] = useState(false)
  if (document.state !== 'TO_PREPARE') return null
  return <>
    <button type="button" onClick={() => setOpen(true)} className={primary}><Wand2 className="size-3.5" /> Prepare</button>
    <SidePanel open={open} onClose={() => setOpen(false)} width={820}
      title={`${document.doc_type} · ${document.employee}`}
      description={[document.due_date && `due ${formatDate(document.due_date)}`, document.needed_by && `needed by ${formatDate(document.needed_by)}`,
        document.format === 'PDF' ? 'PDF' : document.format === 'ORIGINAL' ? 'signed original' : 'PDF + signed original'].filter(Boolean).join(' · ')}>
      {open && <PreparePanel document={document} onDone={(message) => { setOpen(false); onChanged(message) }} />}
    </SidePanel>
  </>
}

function PreparePanel({ document: start, onDone }: { document: DocumentRequest; onDone: (message: string) => void }) {
  const [document, setDocument] = useState(start)  // à jour après "Customize" / "Download" (le texte enregistré)
  const who = `${document.doc_type} for ${document.employee}`
  const generated = document.hr_download === 'draft'
  // Signature posée par l'application et PDF seul : rien à imprimer, l'envoi termine tout.
  const sendsAtOnce = generated && document.signed_by_app && document.format === 'PDF'

  return <div className="flex flex-col gap-4">
    {generated
      ? <GeneratedStep document={document} sendsAtOnce={sendsAtOnce} onSaved={(updated) => updated.state === 'READY' && updated.format === 'PDF'
          ? onDone(`Sent to the employee: ${who}. They get a notification and an email.`) : setDocument(updated)} />
      : <Step number={1} title={document.hr_download === 'model' ? 'Download the Word, check it, print it' : 'Prepare the document'}>
          {document.hr_download === 'model'
            ? <>
                <p className="text-xs text-slate-600">The company model, already filled with {document.employee}&apos;s data. Open it, check it, print it, sign and stamp it.</p>
                <button type="button" className={cn(primary, 'mt-2 w-fit')}
                  onClick={() => getFile(`/api/documents/hr/${document.id}/download/`, document.model_name || document.doc_type, true)}>
                  <FileDown className="size-3.5" /> Download the Word
                </button>
              </>
            : <p className="text-xs text-slate-600">No model for this document: prepare it in your usual tool, then sign and stamp it.
                Admin RH can add a text model or a Word model in Reference lists → Réglages des documents.</p>}
        </Step>}

    {!sendsAtOnce && <Step number={generated ? 3 : 2} title="Deliver">
      <p className="text-xs text-slate-600">
        {[document.can_upload && !document.has_file && 'Scan the signed document and upload the PDF: the employee gets it at once.',
          document.original_state === 'TO_SIGN' && 'Put the signed original at the HR office and click "Original ready": the employee is told to pick it up.']
          .filter(Boolean).join(' ')}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {document.can_upload && !document.has_file && <UploadButton document={document}
          onUploaded={() => onDone(`Sent to the employee: ${who}. They get a notification and an email.`)} />}
        <OriginalButtons document={document} onDone={() => onDone(`Original ready at the HR office: ${who}. The employee is notified.`)} />
      </div>
    </Step>}
  </div>
}

/** ① + ② d'un document GÉNÉRÉ : l'aperçu (le texte de la fiche, ou celui déjà relu), "Customize" (facultatif), puis
 *  "Download PDF" (imprimer) ou "Send to the employee" (signé par l'application). */
function GeneratedStep({ document, sendsAtOnce, onSaved }: {
  document: DocumentRequest; sendsAtOnce: boolean; onSaved: (updated: DocumentRequest) => void
}) {
  const url = `/api/documents/hr/${document.id}`
  const [text, setText] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)  // le texte tel qu'enregistré (pour savoir s'il a changé)
  const [editing, setEditing] = useState(false)
  const [preview, setPreview] = useState('')               // l'adresse du PDF d'aperçu (dans la page)
  const [busy, setBusy] = useState<'preview' | 'save' | null>(null)
  const [error, setError] = useState('')

  const showPreview = useCallback(async (body: string) => {
    setBusy('preview')
    const response = await apiFetch(`${url}/preview-text/`, { method: 'POST', body: JSON.stringify({ text: body }) }).catch(() => null)
    setBusy(null)
    if (!response?.ok) return setError('Could not build the preview.')
    const address = URL.createObjectURL(await response.blob())
    setPreview((old) => { if (old) URL.revokeObjectURL(old); return address })
  }, [url])

  useEffect(() => {
    apiFetch(`${url}/text/`)
      .then(async (response) => {
        if (!response.ok) throw new Error()
        const loaded: string = (await response.json()).text
        setText(loaded)
        setSaved(loaded)
        showPreview(loaded)
      })
      .catch(() => setError('Could not load the document.'))
  }, [url, showPreview])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  // Enregistrer le texte (s'il a changé, ou si la relecture est demandée) ; rend le document à jour, ou null (erreur).
  async function saveText(force = false): Promise<DocumentRequest | null> {
    if (text === null) return null
    if (!force && text === saved && !document.needs_review) return document
    setBusy('save')
    const result = await sendChange<DocumentRequest>(() => apiFetch(`${url}/text/`, { method: 'POST', body: JSON.stringify({ text }) }),
      'Only HR of this employee\'s pôle can prepare this document.')
    setBusy(null)
    if ('error' in result) { setError(result.error); return null }
    setSaved(text)
    return result.data
  }

  async function download() {
    const updated = await saveText()
    if (!updated) return
    const failed = await getFile(`${url}/download/`, `${document.doc_type} - ${document.employee}.pdf`, true)
    if (failed) return setError(failed)
    onSaved(updated)
  }

  async function send() {
    const updated = await saveText(true)  // l'envoi : toujours enregistré (c'est lui qui livre le PDF signé)
    if (updated) onSaved(updated)
  }

  if (text === null) return <p className="py-10 text-center text-sm text-slate-500">{error || 'Loading...'}</p>
  return <>
    <Step number={1} title="Check the document" aside={<button type="button" onClick={() => setEditing((old) => !old)} className={secondary}>
      <PenLine className="size-3.5" /> {editing ? 'Hide the text' : 'Customize'}
    </button>}>
      <p className="text-xs text-slate-600">Filled in from {document.employee}&apos;s HR file.
        {document.needs_review ? ' Your company asks HR to read it (and complete it if needed) before it is sent.' : ' Customize it only if something must be added or changed.'}</p>
      {editing && <div className="mt-2 flex flex-col gap-2">
        <textarea value={text} onChange={(event) => { setText(event.target.value); setError('') }} rows={9} maxLength={5000}
          aria-label="Text of the document"
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed outline-none focus:border-[#23355d] focus:ring-3 focus:ring-[#23355d]/15" />
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-[11px] text-slate-500">Only this text changes (not the header, reference or signature). Blank line = new paragraph, **word** = bold.</p>
          <button type="button" disabled={busy !== null} onClick={() => showPreview(text)} className={secondary}>
            {busy === 'preview' ? <Loader2 className="size-3.5 animate-spin" /> : <Eye className="size-3.5" />} Update the preview
          </button>
        </div>
      </div>}
      <div className="mt-2 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
        {preview
          ? <iframe src={preview} title={`Preview of ${document.doc_type}`} className="h-[480px] w-full bg-white" />
          : <p className="py-16 text-center text-xs text-slate-500">{busy === 'preview' ? 'Building the preview...' : error || 'No preview.'}</p>}
      </div>
    </Step>

    <Step number={2} title={sendsAtOnce ? 'Send' : 'Print, sign and stamp'}>
      <p className="text-xs text-slate-600">{sendsAtOnce
        ? 'The signature and the stamp are added by the app: the employee receives the PDF at once.'
        : 'Download the PDF (your text is saved first), print it, sign it and stamp it.'}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {sendsAtOnce
          ? <button type="button" disabled={busy !== null} onClick={send} className={primary}>
              {busy === 'save' ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Send to the employee
            </button>
          : <button type="button" disabled={busy !== null} onClick={download} className={primary}>
              {busy === 'save' ? <Loader2 className="size-3.5 animate-spin" /> : <FileDown className="size-3.5" />} Download PDF
            </button>}
        {error && <span role="alert" className="text-[11px] font-medium text-red-600">{error}</span>}
      </div>
    </Step>
  </>
}

function Step({ number, title, aside, children }: { number: number; title: string; aside?: ReactNode; children: ReactNode }) {
  return <section className="rounded-xl border border-slate-200/80 bg-white p-4">
    <div className="mb-1.5 flex items-center gap-2">
      <span className="flex size-6 items-center justify-center rounded-full bg-[#23355d] text-[11px] font-bold text-white">{number}</span>
      <h3 className="flex-1 text-sm font-semibold text-[#192646]">{title}</h3>
      {aside}
    </div>
    {children}
  </section>
}
