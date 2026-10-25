'use client'

/*
 * Bouton "Réinitialiser le mot de passe" de la fiche (collaborateur qui a oublié son mot de passe).
 *
 * 1. Clic -> cadre de confirmation (l'action ferme toutes ses sessions : on demande d'abord).
 * 2. Confirmer -> POST /api/employees/<id>/reset-password/ -> Django renvoie un mot de passe
 *    temporaire aléatoire.
 * 3. On l'affiche UNE seule fois. En fermant le cadre, il est oublié (la base n'a que son hash).
 *
 * Le bouton n'est affiché que si Django dit can_reset_password (même règle que l'API).
 */
import { useEffect, useRef, useState } from 'react'
import { Check, Copy, KeyRound, Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api'

type Result = { username: string; temporary_password: string }

export function ResetPasswordButton({ employeeId, name }: { employeeId: number; name: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [copied, setCopied] = useState(false)

  // Ouvre / ferme le vrai <dialog> (fond grisé, Échap, focus gardé dans le cadre).
  useEffect(() => {
    const dialog = dialogRef.current
    if (open && dialog && !dialog.open) dialog.showModal()
    if (!open && dialog?.open) dialog.close()
  }, [open])

  // Fermer = oublier le mot de passe affiché.
  function close() {
    setOpen(false)
    setResult(null)
    setError('')
    setCopied(false)
  }

  // Page quittée (Next.js la garde cachée) : on oublie aussi le mot de passe.
  useEffect(() => () => close(), [])

  async function confirm() {
    setSaving(true)
    setError('')
    try {
      const response = await apiFetch(`/api/employees/${employeeId}/reset-password/`, { method: 'POST' })
      const data = await response.json().catch(() => ({}))
      if (response.ok) setResult(data)
      else setError(data.detail ?? 'Une erreur est survenue. Réessayez.')
    } catch {
      setError('Impossible de joindre le serveur.')
    }
    setSaving(false)
  }

  async function copy() {
    if (!result) return
    await navigator.clipboard.writeText(result.temporary_password)
    setCopied(true)
  }

  return <>
    <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-[#23355d]/30 hover:text-[#23355d]">
      <KeyRound className="size-3.5" /> Réinitialiser le mot de passe
    </button>

    <dialog ref={dialogRef} onClose={close} onClick={(e) => { if (e.target === dialogRef.current) close() }}
      className="m-auto w-[min(92vw,420px)] rounded-xl border border-slate-200 bg-white p-0 shadow-2xl backdrop:bg-slate-900/40">
      {result ? (
        // Étape 2 : le mot de passe temporaire, montré une seule fois.
        <div className="p-5">
          <h2 className="text-sm font-semibold text-[#192646]">Mot de passe réinitialisé</h2>
          <p className="mt-1 text-xs text-slate-500">Transmettez-le à {name}. Il devra le changer à sa prochaine connexion.</p>
          <dl className="mt-4 space-y-2 rounded-lg bg-slate-50 p-3 text-sm ring-1 ring-slate-200">
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Username</dt><dd className="font-mono font-semibold">{result.username}</dd></div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-slate-500">Mot de passe temporaire</dt>
              <dd className="flex items-center gap-2 font-mono font-semibold tracking-wide">
                {result.temporary_password}
                <button type="button" aria-label="Copier le mot de passe" onClick={copy} className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700">
                  {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
                </button>
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-[11px] font-medium text-amber-700">Ce mot de passe ne sera plus affiché après la fermeture.</p>
          <div className="mt-4 flex justify-end">
            <button type="button" onClick={close} className="rounded-lg bg-[#23355d] px-4 py-2 text-xs font-semibold text-white hover:bg-[#192646]">Fermer</button>
          </div>
        </div>
      ) : (
        // Étape 1 : confirmation.
        <div className="p-5">
          <h2 className="text-sm font-semibold text-[#192646]">Réinitialiser le mot de passe de {name} ?</h2>
          <p className="mt-2 text-xs text-slate-600">Un mot de passe temporaire sera créé. {name} sera déconnecté(e) de tous ses appareils et devra choisir un nouveau mot de passe à la prochaine connexion.</p>
          {error && <p role="alert" className="mt-3 text-[11px] font-medium text-red-600">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={close} className="rounded-lg px-4 py-2 text-xs font-semibold text-slate-500 hover:text-[#23355d]">Annuler</button>
            <button type="button" onClick={confirm} disabled={saving} className="flex items-center gap-2 rounded-lg bg-[#23355d] px-4 py-2 text-xs font-semibold text-white hover:bg-[#192646] disabled:opacity-60">
              {saving && <Loader2 className="size-3.5 animate-spin" />} Réinitialiser
            </button>
          </div>
        </div>
      )}
    </dialog>
  </>
}
