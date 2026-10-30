'use client'

/*
 * La page "Security settings" de l'IT : la même ligne que "Réglages de sécurité" dans /admin.
 * - MFA (double authentification) : activée ou non, et pour quels rôles elle est obligatoire.
 * - Changement du mot de passe temporaire (le CIN) à la première connexion : pour quels rôles.
 * Les changements restent dans la page jusqu'à "Save" (comme les circuits). Lu dans /api/auth/security-settings/.
 */
import { useEffect, useState } from 'react'
import { KeyRound, Loader2, ShieldCheck, TriangleAlert, type LucideIcon } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import { sendChange } from '@/lib/workflows'

type Settings = Record<string, boolean>

// Les rôles, dans l'ordre affiché. Le champ Django = préfixe + suffixe (ex. "mfa_required_" + "hr").
const ROLES = [
  { suffix: 'hr_admin', label: 'Admin RH' },
  { suffix: 'hr', label: 'RH' },
  { suffix: 'manager', label: 'Manager' },
  { suffix: 'collaborator', label: 'Collaborateur' },
  { suffix: 'superuser', label: 'IT' },
]

export function SecuritySettingsPage() {
  const [saved, setSaved] = useState<Settings | null>(null)   // ce qui est enregistré dans Django
  const [draft, setDraft] = useState<Settings | null>(null)   // ce que l'IT est en train de changer
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    apiFetch('/api/auth/security-settings/')
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status))
        const data: Settings = await response.json()
        setSaved(data)
        setDraft(data)
      })
      .catch(() => setFailed(true))
  }, [])

  if (!saved || !draft) {
    return <p className="rounded-xl border border-slate-200 bg-white px-4 py-12 text-center text-sm text-slate-500">
      {failed ? 'Could not load the security settings.' : 'Loading...'}
    </p>
  }

  const changed = JSON.stringify(draft) !== JSON.stringify(saved)

  function toggle(field: string) {
    setDraft((value) => value && { ...value, [field]: !value[field] })
    setMessage(null)
  }

  async function save() {
    setBusy(true)
    const result = await sendChange<Settings>(
      () => apiFetch('/api/auth/security-settings/', { method: 'PATCH', body: JSON.stringify(draft) }),
      'Only IT can change the security settings.')
    if ('data' in result) {
      setSaved(result.data)
      setDraft(result.data)
      setMessage({ ok: true, text: 'Security settings saved.' })
    } else {
      setMessage({ ok: false, text: result.error })
    }
    setBusy(false)
  }

  return <div className="flex flex-col gap-4">
    <div>
      <h1 className="text-lg font-semibold text-[#192646]">Security settings</h1>
      <p className="text-xs text-slate-500">Applies to every account, at their next sign-in or request. Reserved for IT.</p>
    </div>

    <div className="grid items-start gap-4 lg:grid-cols-2">
      <Card icon={ShieldCheck} title="Two-factor authentication (MFA)" description="A 6-digit code from an authenticator app, after the password."
        switchLabel="MFA enabled" enabled={draft.mfa_enabled} onSwitch={() => toggle('mfa_enabled')}
        prefix="mfa_required_" draft={draft} onToggle={toggle}
        note={draft.mfa_enabled && draft.mfa_required_superuser && !saved.mfa_required_superuser
          ? 'You will set up MFA at your next request.' : undefined} />

      <Card icon={KeyRound} title="Password change at first sign-in" description="A new account signs in with their CIN, then must choose a new password."
        switchLabel="Password change enabled" enabled={draft.password_change_enabled} onSwitch={() => toggle('password_change_enabled')}
        prefix="password_change_" draft={draft} onToggle={toggle}
        // Le même avertissement que dans /admin : sans changement obligatoire, le CIN peut rester le mot de passe.
        note={ROLES.some(({ suffix }) => !draft.password_change_enabled || !draft[`password_change_${suffix}`])
          ? 'Accounts of an unticked role can keep their CIN as password.' : undefined} />
    </div>

    <div className="flex flex-wrap items-center justify-end gap-2">
      {message && <p role={message.ok ? 'status' : 'alert'} className={cn('mr-auto text-xs font-medium', message.ok ? 'text-emerald-700' : 'text-red-600')}>{message.text}</p>}
      {changed && <button type="button" disabled={busy} onClick={() => { setDraft(saved); setMessage(null) }}
        className="rounded-lg px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-white">Cancel</button>}
      <button type="button" disabled={!changed || busy} onClick={save}
        className="flex items-center gap-1.5 rounded-lg bg-[#23355d] px-4 py-2 text-xs font-semibold text-white hover:bg-[#192646] disabled:opacity-50">
        {busy && <Loader2 className="size-3 animate-spin" />} Save
      </button>
    </div>
  </div>
}

type CardProps = {
  icon: LucideIcon
  title: string
  description: string
  switchLabel: string
  enabled: boolean
  onSwitch: () => void
  prefix: string             // "mfa_required_" ou "password_change_"
  draft: Settings
  onToggle: (field: string) => void
  note?: string              // un avertissement sous les cases
}

// Une carte : l'interrupteur général, puis une case par rôle (grisées quand c'est désactivé).
function Card({ icon: Icon, title, description, switchLabel, enabled, onSwitch, prefix, draft, onToggle, note }: CardProps) {
  const id = prefix.replace(/_$/, '')
  return <section className="rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <header className="flex items-start gap-3 border-b border-slate-100 px-4 py-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-[#8C6D52]" />
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-[#192646]">{title}</h2>
        <p className="text-[11px] text-slate-500">{description}</p>
      </div>
      {/* L'interrupteur : un vrai bouton "switch" pour les lecteurs d'écran. */}
      <button type="button" role="switch" aria-checked={enabled} aria-label={switchLabel} onClick={onSwitch}
        className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors', enabled ? 'bg-emerald-600' : 'bg-slate-300')}>
        <span className={cn('absolute top-0.5 size-4 rounded-full bg-white shadow transition-all', enabled ? 'left-[18px]' : 'left-0.5')} />
      </button>
    </header>

    <fieldset disabled={!enabled} className="px-4 py-3 disabled:opacity-50">
      <legend className="mb-2 text-xs font-semibold text-slate-700">Required for</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {ROLES.map(({ suffix, label }) => {
          const field = `${prefix}${suffix}`
          return <label key={field} htmlFor={`${id}-${suffix}`} className="flex items-center gap-2 text-sm text-slate-700">
            <input id={`${id}-${suffix}`} type="checkbox" checked={draft[field]} onChange={() => onToggle(field)}
              className="size-4 rounded border-slate-300 accent-[#23355d]" />
            {label}
          </label>
        })}
      </div>
      {note && <p className="mt-3 flex items-start gap-1.5 text-[11px] text-amber-700"><TriangleAlert className="mt-px size-3.5 shrink-0" /> {note}</p>}
    </fieldset>
  </section>
}
