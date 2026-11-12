'use client'

/*
 * La page Settings (2026-11-11) : MES emails de notification. Chacun ne règle que les siens.
 * - "Requests to approve" : toujours envoyé (cadenas) : sinon les demandes de l'équipe resteraient bloquées ;
 * - "Results of my requests" et "Information & reminders" : on / off (activés par défaut) ;
 * - la cloche (dans l'application) : toujours là, pas de réglage (un compte de la société, la trace du travail).
 * Chaque interrupteur s'enregistre tout de suite (PATCH /api/employees/notifications/settings/).
 */
import { useEffect, useState } from 'react'
import { Bell, CheckCircle2, Lock, Mail } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'

type Choices = { email_results: boolean; email_info: boolean; email_address: string }
type Field = 'email_results' | 'email_info'

const card = 'rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]'

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
      setMessage({ ok: true, text: 'Saved.' })
    } catch {
      setChoices(before)
      setMessage({ ok: false, text: 'Could not save. Please try again.' })
    }
    setSaving(null)
  }

  return <div className="mx-auto flex max-w-3xl flex-col gap-4">
    <div>
      <h1 className="text-lg font-semibold text-[#192646]">Settings</h1>
      <p className="text-xs text-slate-500">Your personal settings. They only change what YOU receive.</p>
    </div>

    <section className={card}>
      <header className="flex items-start gap-2.5 border-b border-slate-100 px-4 py-3">
        <Mail className="mt-0.5 size-4 shrink-0 text-[#8C6D52]" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-[#192646]">Email notifications</h2>
          <p className="text-[11px] text-slate-500">
            A copy of your notifications, by email{choices?.email_address ? <> to <b className="font-semibold text-slate-700">{choices.email_address}</b></> : ''}.
          </p>
        </div>
        {message && <p role="status" className={cn('flex items-center gap-1 text-[11px] font-medium', message.ok ? 'text-emerald-700' : 'text-red-600')}>
          {message.ok && <CheckCircle2 className="size-3.5" />}{message.text}
        </p>}
      </header>

      {!choices
        ? <p className="px-4 py-8 text-center text-sm text-slate-500">{failed ? 'Could not load your settings. Please try again later.' : 'Loading...'}</p>
        : <ul className="divide-y divide-slate-100">
            <Row title="Requests to approve" text="When a request waits for your answer (as a manager, HR, or a stand-in). Always sent: the team's requests must not get stuck."
              locked />
            <Row title="Results of my requests" text="When your leave or expense claim is approved, refused, cancelled or recounted."
              on={choices.email_results} busy={saving === 'email_results'} onToggle={() => toggle('email_results')} />
            <Row title="Information & reminders" text="For information, changes to your leave balance, days lost on 31/12, and reminders of requests waiting for you."
              on={choices.email_info} busy={saving === 'email_info'} onToggle={() => toggle('email_info')} />
          </ul>}
    </section>

    <section className={cn(card, 'flex items-start gap-2.5 px-4 py-3')}>
      <Bell className="mt-0.5 size-4 shrink-0 text-[#8C6D52]" aria-hidden />
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-[#192646]">In-app notifications (bell)</h2>
        <p className="text-[11px] text-slate-500">Always on: the bell keeps every notification of your work account, even the emails you switched off.</p>
      </div>
      <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500"><Lock className="size-3" /> Always on</span>
    </section>
  </div>
}

/** Une ligne : le titre, l'explication, et l'interrupteur (ou le cadenas). */
function Row({ title, text, on = true, locked = false, busy = false, onToggle }: {
  title: string; text: string; on?: boolean; locked?: boolean; busy?: boolean; onToggle?: () => void
}) {
  return <li className="flex items-center gap-4 px-4 py-3">
    <div className="min-w-0 flex-1">
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      <p className="text-[11px] text-slate-500">{text}</p>
    </div>
    {locked
      ? <span className="flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500"><Lock className="size-3" /> Always on</span>
      // Un vrai interrupteur accessible : role="switch" + aria-checked (lu "activé / désactivé").
      : <button type="button" role="switch" aria-checked={on} aria-label={title} disabled={busy} onClick={onToggle}
          className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60', on ? 'bg-[#192646]' : 'bg-slate-300')}>
          <span className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform', on ? 'translate-x-5' : 'translate-x-0.5')} />
        </button>}
  </li>
}
