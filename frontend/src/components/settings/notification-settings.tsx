'use client'

/*
 * Settings -> Notifications (2e version, 2026-11-12 : le standard de GitHub / Jira / Slack, un TABLEAU) :
 * une ligne par famille de notifications, une colonne par canal ("In app" = la cloche, "Email").
 * - In app : toujours coché (cadenas) : un compte de la société, la cloche est la trace du travail ;
 * - Email "Requests to approve" : toujours coché (cadenas) : sinon les demandes de l'équipe resteraient bloquées ;
 * - Email "Results of my requests" et "Information & reminders" : au choix (cochés par défaut).
 * Chaque case s'enregistre tout de suite (PATCH /api/employees/notifications/settings/).
 */
import { useEffect, useState } from 'react'
import { Check, CheckCircle2, Lock } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'

type Choices = { email_results: boolean; email_info: boolean; email_address: string }
type Field = 'email_results' | 'email_info'

// Les familles : le titre, ce qu'elles contiennent, et le choix de l'email (null = toujours envoyé).
const ROWS: { title: string; text: string; email: Field | null }[] = [
  { title: 'Requests to approve', text: 'A request waits for your answer (as a manager, HR, or a stand-in).', email: null },
  { title: 'Results of my requests', text: 'Your leave or expense claim is approved, refused, cancelled or recounted.', email: 'email_results' },
  { title: 'Information & reminders', text: 'For information, leave balance changes, days lost on 31/12, reminders.', email: 'email_info' },
]

export function NotificationSettings() {
  const [choices, setChoices] = useState<Choices | null>(null)
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState<Field | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    apiFetch('/api/employees/notifications/settings/')
      .then(async (response) => {
        if (!response.ok) throw new Error()
        setChoices(await response.json())
      })
      .catch(() => setFailed(true))
  }, [])

  async function toggle(field: Field) {
    if (!choices) return
    const before = choices
    const next = !choices[field]
    setChoices({ ...choices, [field]: next })  // tout de suite à l'écran ; on revient en arrière si Django refuse
    setSaving(field)
    setMessage(null)
    try {
      const response = await apiFetch('/api/employees/notifications/settings/', { method: 'PATCH', body: JSON.stringify({ [field]: next }) })
      if (!response.ok) throw new Error()
      setChoices(await response.json())
      setMessage({ ok: true, text: 'Saved' })
    } catch {
      setChoices(before)
      setMessage({ ok: false, text: 'Could not save. Please try again.' })
    }
    setSaving(null)
  }

  return <section className="rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <header className="flex flex-wrap items-start gap-3 border-b border-slate-100 px-5 py-4">
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-[#192646]">Notifications</h2>
        <p className="text-xs text-slate-500">Choose where you are told about your requests and approvals.</p>
      </div>
      {message && <p role="status" className={cn('flex items-center gap-1 text-xs font-medium', message.ok ? 'text-emerald-700' : 'text-red-600')}>
        {message.ok && <CheckCircle2 className="size-3.5" />}{message.text}
      </p>}
    </header>

    {!choices
      ? <p className="px-5 py-10 text-center text-sm text-slate-500">{failed ? 'Could not load your settings. Please try again later.' : 'Loading...'}</p>
      : <>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-5 py-2.5">Notification</th>
                <th className="w-20 px-2 py-2.5 text-center">In app</th>
                <th className="w-20 px-5 py-2.5 text-center">Email</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => <tr key={row.title} className="border-t border-slate-100">
                <td className="px-5 py-3.5">
                  <p className="font-semibold text-slate-800">{row.title}</p>
                  <p className="text-xs text-slate-500">{row.text}</p>
                </td>
                <td className="px-2 py-3.5 text-center"><Box checked locked label={`${row.title}, in app`} /></td>
                <td className="px-5 py-3.5 text-center">
                  {row.email === null
                    ? <Box checked locked label={`${row.title}, email`} />
                    : <Box checked={choices[row.email]} busy={saving === row.email} label={`${row.title}, email`} onToggle={() => toggle(row.email as Field)} />}
                </td>
              </tr>)}
            </tbody>
          </table>
          <p className="flex items-start gap-1.5 border-t border-slate-100 bg-slate-50/60 px-5 py-3 text-xs text-slate-500">
            <Lock className="mt-0.5 size-3 shrink-0" aria-hidden />
            <span>
              Locked boxes are always on: the bell keeps every notification of your work account, and requests to approve
              are always emailed so that nothing gets stuck. Emails go to <b className="font-semibold text-slate-700">{choices.email_address || 'your professional email'}</b>.
            </span>
          </p>
        </>}
  </section>
}

/** Une case à cocher (accessible : role="checkbox"). Verrouillée : cochée, grisée, avec un cadenas. */
function Box({ checked, locked = false, busy = false, label, onToggle }: {
  checked: boolean; locked?: boolean; busy?: boolean; label: string; onToggle?: () => void
}) {
  return <button type="button" role="checkbox" aria-checked={checked} aria-label={label} aria-disabled={locked || undefined}
    disabled={locked || busy} onClick={onToggle} title={locked ? 'Always on' : undefined}
    className={cn('relative inline-flex size-5 items-center justify-center rounded-md border transition-colors',
      locked ? 'cursor-not-allowed border-slate-300 bg-slate-200 text-slate-500'
        : checked ? 'border-[#192646] bg-[#192646] text-white hover:bg-[#23355d]' : 'border-slate-300 bg-white hover:border-[#192646]',
      busy && 'opacity-60')}>
    {checked && <Check className="size-3.5" strokeWidth={3} aria-hidden />}
    {locked && <Lock className="absolute -right-1.5 -top-1.5 size-2.5 rounded-full bg-white text-slate-400" aria-hidden />}
  </button>
}
