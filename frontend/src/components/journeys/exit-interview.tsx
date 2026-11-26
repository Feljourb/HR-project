'use client'

/*
 * L'ENTRETIEN DE SORTIE d'un départ (2026-11-25, standard : savoir pourquoi les gens partent pour s'améliorer).
 * UN composant, à deux endroits : "My departure" (le collaborateur répond) et le panneau d'Arrivals & departures (les
 * RH lisent, ou remplissent avec lui pendant l'entretien). CONFIDENTIEL : jamais le manager (le serveur répond 404).
 * Les questions : Admin RH (Réglages des arrivées et départs -> Exit interview) ; le questionnaire = le composant
 * partagé `Questionnaire`.
 */
import { useEffect, useState } from 'react'
import { Loader2, Lock, MessageSquareHeart } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { errorOf, frDate, type Question } from '@/lib/journeys'
import { Questionnaire } from '@/components/ui/questionnaire'

// can_fill (2026-11-26) : les RH ne changent jamais les réponses données par le collaborateur lui-même.
type Data = { questions: Question[]; answers: Record<string, string>; filled_by_name: string | null; filled_at: string | null; open: boolean; can_fill: boolean }

export function ExitInterview({ departureId, forHr = false }: { departureId: number; forHr?: boolean }) {
  const [data, setData] = useState<Data | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    apiFetch(`/api/journeys/departures/${departureId}/exit-interview/`)
      .then((response) => (response.ok ? response.json() : null))  // pas autorisé : rien à montrer
      .then((value: Data | null) => { setData(value); if (value) setAnswers(value.answers) })
      .catch(() => { /* rien à montrer */ })
  }, [departureId])

  if (!data || data.questions.length === 0) return null
  const done = Boolean(data.filled_at)
  const showForm = data.can_fill && (!done || editing)

  async function save() {
    setBusy(true)
    setError('')
    setSaved(false)
    const response = await apiFetch(`/api/journeys/departures/${departureId}/exit-interview/`, {
      method: 'POST', body: JSON.stringify({ answers }),
    }).catch(() => null)
    setBusy(false)
    if (response?.ok) { const value: Data = await response.json(); setData(value); setAnswers(value.answers); setEditing(false); setSaved(true) }
    else setError(response ? await errorOf(response) : 'The server does not answer. Try again.')
  }

  return <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <div className="flex flex-wrap items-start gap-2">
      <MessageSquareHeart className="mt-0.5 size-4 text-[#23355d]" aria-hidden />
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-[#192646]">Exit interview</h2>
        <p className="flex items-center gap-1 text-[11px] text-slate-500"><Lock className="size-3" aria-hidden />
          {forHr ? 'Confidential: only HR and the employee see the answers (never the manager).'
            : 'Confidential: only HR read your answers (never your manager). It helps the company improve.'}</p>
      </div>
      {done && !editing && data.can_fill && <button type="button" onClick={() => setEditing(true)} className="text-xs font-semibold text-[#23355d] hover:underline">Change the answers</button>}
    </div>

    {done && !editing && <p className="mt-2 text-[11px] text-emerald-700">✓ Answered{data.filled_by_name ? ` by ${data.filled_by_name}` : ''}{data.filled_at ? ` on ${frDate(data.filled_at.slice(0, 10))}` : ''}.</p>}
    {!done && !data.open && <p className="mt-2 text-xs text-slate-500">It opens once the departure is approved.</p>}
    {!done && data.open && forHr && <p className="mt-2 text-xs text-slate-500">Not answered yet. The employee was invited (bell + email); you can also fill it in with them during the interview.</p>}

    {(showForm || done) && <div className="mt-3">
      <Questionnaire questions={data.questions} answers={answers} onChange={setAnswers} readOnly={!showForm} />
    </div>}

    {showForm && <div className="mt-3 flex flex-wrap items-center gap-2">
      {error && <p role="alert" className="w-full text-xs font-medium text-red-600">{error}</p>}
      <button type="button" onClick={() => void save()} disabled={busy}
        className="flex items-center gap-1.5 rounded-lg bg-[#23355d] px-3 py-2 text-xs font-semibold text-white hover:bg-[#192646] disabled:opacity-50">
        {busy && <Loader2 className="size-3.5 animate-spin" />} {forHr ? 'Save the answers' : 'Send my answers'}
      </button>
      {editing && <button type="button" onClick={() => { setEditing(false); setAnswers(data.answers) }} className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>}
    </div>}
    {saved && <p role="status" className="mt-2 text-xs font-medium text-emerald-700">✓ Thank you, your answers are saved.</p>}
  </section>
}
