'use client'

/*
 * "Document models" (2026-11-17, simplifié à la demande de l'utilisatrice) : pour chaque document, son MODÈLE = le texte
 * avec des codes {{ nom }}... que l'application remplit avec les données du collaborateur (le "form"). Avec un modèle,
 * le PDF se fait automatiquement ou par les RH (section "How the PDF is made") ; sans modèle (ex. un bulletin de paie,
 * qui vient de la paie), les RH déposent leur propre document. Rien d'autre ici.
 * API : PATCH /api/documents/types/<id>/setup/ ; POST preview-model/.
 */
import { useEffect, useState } from 'react'
import { CheckCircle2, Eye, FileText, Loader2, PenLine } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import type { DocumentType } from '@/lib/documents'
import { cn } from '@/lib/utils'
import { sendChange } from '@/lib/workflows'
import { actionClass } from '@/components/expenses/claim-actions'
import { SidePanel } from '@/components/ui/side-panel'

export function DocumentTypesSetup({ codes }: { codes: Record<string, string> }) {
  const [types, setTypes] = useState<DocumentType[] | null>(null)
  const [open, setOpen] = useState<DocumentType | null>(null)

  useEffect(() => {
    apiFetch('/api/documents/types/')
      .then(async (response) => { if (response.ok) setTypes(await response.json()) })
      .catch(() => setTypes([]))
  }, [])

  return <>
    {types === null
      ? <p className="text-[11px] text-slate-400">Loading...</p>
      : <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {types.map((type) => <li key={type.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
            {type.automatic ? <CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-hidden /> : <FileText className="size-4 shrink-0 text-slate-400" aria-hidden />}
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-[#192646]">{type.name}</span>
              <span className={cn('block text-[11px]', type.automatic ? 'text-emerald-700' : 'text-slate-500')}>
                {type.automatic ? 'Model ready: filled with the employee\'s data' : 'No model: HR upload their own document'}
              </span>
            </span>
            <button type="button" onClick={() => setOpen(type)} className={actionClass}><PenLine className="size-3.5" /> {type.automatic ? 'Edit model' : 'Add a model'}</button>
          </li>)}
        </ul>}
    <SidePanel open={open !== null} onClose={() => setOpen(null)} width={720} title={open ? `Model · ${open.name}` : ''}
      description="The text of the document. The codes are replaced by the employee's data.">
      {open && <ModelForm key={open.id} type={open} codes={codes}
        onSaved={(updated) => { setTypes((old) => old && old.map((item) => (item.id === updated.id ? updated : item))); setOpen(null) }} />}
    </SidePanel>
  </>
}

function ModelForm({ type, codes, onSaved }: { type: DocumentType; codes: Record<string, string>; onSaved: (updated: DocumentType) => void }) {
  const work = type.template === 'WORK'  // l'attestation de travail : un texte prévu par l'application (vide = lui)
  const [text, setText] = useState(type.body_template)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save(keep: boolean) {
    setBusy(true)
    setError('')
    // keep = false : "Remove the model" -> les RH déposent leur propre document.
    const result = await sendChange<DocumentType>(() => apiFetch(`/api/documents/types/${type.id}/setup/`, {
      method: 'PATCH', body: JSON.stringify({ generated: keep, body_template: keep ? text : '', hr_review: type.hr_review }),
    }), 'Only Admin RH can change the models.')
    setBusy(false)
    if ('error' in result) return setError(result.error)
    onSaved(result.data)
  }

  // L'aperçu : l'onglet s'ouvre PENDANT le clic (sinon le navigateur le bloque), puis reçoit le PDF d'exemple.
  async function preview() {
    const tab = window.open('', '_blank')
    const response = await apiFetch(`/api/documents/types/${type.id}/preview-model/`, { method: 'POST', body: JSON.stringify({ text }) }).catch(() => null)
    if (!response?.ok) { tab?.close(); return setError('Could not build the preview.') }
    if (tab) tab.location.href = URL.createObjectURL(await response.blob())
  }

  return <div className="flex flex-col gap-3">
    <textarea value={text} onChange={(event) => { setText(event.target.value); setError('') }} rows={12} maxLength={5000}
      aria-label={`Model of ${type.name}`}
      placeholder={work ? 'Empty: the text provided by the app (it agrees with Madame / Monsieur and former employees).'
        : 'e.g. Nous soussignés, **{{ societe }}**, attestons que {{ civilite }} **{{ nom }} {{ prenom }}**, titulaire de la CIN n° {{ cin }}, ...'}
      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed outline-none focus:border-[#23355d] focus:ring-3 focus:ring-[#23355d]/15" />
    <p className="text-[11px] text-slate-500">Blank line = new paragraph · **word** = bold. The header, the reference and the signature are added by the app.</p>
    <details className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
      <summary className="cursor-pointer font-semibold text-[#23355d]">Codes you can use ({Object.keys(codes).length})</summary>
      <ul className="mt-1.5 grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
        {Object.entries(codes).map(([code, meaning]) => <li key={code}>
          <code className="rounded bg-white px-1 font-semibold text-[#192646]">{`{{ ${code} }}`}</code> {meaning}
        </li>)}
      </ul>
    </details>
    <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
      {type.automatic && !work && <button type="button" disabled={busy} onClick={() => save(false)}
        className="text-[11px] font-semibold text-red-600 hover:underline">Remove the model</button>}
      {error && <p role="alert" className="text-xs font-medium text-red-600">{error}</p>}
      <span className="ml-auto" />
      <button type="button" onClick={preview} className={actionClass}><Eye className="size-3.5" /> Preview</button>
      <button type="button" disabled={busy || (!text.trim() && !work)} onClick={() => save(true)}
        className="flex items-center gap-1.5 rounded-lg bg-[#23355d] px-4 py-2 text-xs font-semibold text-white hover:bg-[#192646] disabled:opacity-50">
        {busy && <Loader2 className="size-3.5 animate-spin" />} Save the model
      </button>
    </div>
  </div>
}
