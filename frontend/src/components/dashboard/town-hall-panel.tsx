'use client'

import { useState, type FormEvent } from 'react'
import { Building2, ChevronUp, Mic, MonitorPlay, Send } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Panel, PanelHeader, PanelLink } from './panel'
import { townHall } from './data'
import { daysBetween, officeClock, relativeDay, shortDate, weekdayShort } from './time'

export const TOWN_HALL_INPUT_ID = 'town-hall-question'

/** Brings the question box into view and focuses it (used by the video's "Ask a question"). */
export function focusTownHall() {
  const input = document.getElementById(TOWN_HALL_INPUT_ID)
  if (!input) return
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  input.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' })
  window.setTimeout(() => input.focus({ preventScroll: true }), reduced ? 0 : 450)
  const panel = input.closest('section')
  if (panel) {
    panel.classList.remove('sbd-flash')
    void panel.offsetWidth
    panel.classList.add('sbd-flash')
  }
}

type Question = (typeof townHall.questions)[number] & { mine?: boolean }
type Attendance = 'onsite' | 'online'

const MAX_LENGTH = 280

export function TownHallPanel({ now, className, index }: { now: Date | null; className?: string; index: number }) {
  const today = now ? officeClock(now).key : null
  const daysTo = today ? daysBetween(today, townHall.date) : null
  const [attendance, setAttendance] = useState<Attendance | null>(null)
  const [questions, setQuestions] = useState<Question[]>(townHall.questions)
  const [voted, setVoted] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  const [status, setStatus] = useState('')
  const canSend = draft.trim().length >= 10

  const countdown = daysTo === null ? shortDate(townHall.date)
    : daysTo > 1 ? `In ${daysTo} days` : daysTo === 1 ? 'Tomorrow' : daysTo === 0 ? 'Today' : 'Replay available'

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (!canSend) return
    const question: Question = { id: `mine-${Date.now()}`, text: draft.trim(), author: anonymous ? 'Anonymous' : 'Fatima E. · Engineering', askedAt: today ?? townHall.date, votes: 0, mine: true }
    setQuestions((list) => [question, ...list])
    setDraft('')
    setStatus('Question sent. Internal Communications reviews questions before the Town Hall.')
  }

  return <Panel className={className} index={index}>
    <PanelHeader icon={Mic} title="Q4 Town Hall" meta={`${weekdayShort(townHall.date)} ${shortDate(townHall.date)} · ${townHall.time} · ${townHall.place}`}>
      <span className="rounded-full bg-[#F7F1EC] px-2 py-0.5 text-[10px] font-semibold text-[#8C6D52] ring-1 ring-inset ring-[#D7C4B7]/70">{countdown}</span>
    </PanelHeader>

    <div className="flex flex-col gap-2.5 px-4 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-medium text-slate-600">{attendance ? <>You’re registered · <b className="font-semibold text-emerald-700">{attendance === 'onsite' ? 'In person' : 'Online'}</b></> : 'Will you attend?'}</p>
        <div className="flex rounded-lg bg-slate-100 p-0.5" role="group" aria-label="Attendance">
          {([['onsite', 'In person', Building2], ['online', 'Online', MonitorPlay]] as const).map(([value, label, Icon]) => (
            <button key={value} type="button" aria-pressed={attendance === value} onClick={() => setAttendance(attendance === value ? null : value)}
              className={cn('inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium transition-colors', attendance === value ? 'bg-[#23355d] text-white shadow-sm' : 'text-slate-500 hover:text-slate-800')}>
              <Icon className="size-3.5" />{label}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={submit} className="rounded-lg border border-slate-200 bg-white transition-shadow focus-within:border-[#23355d]/40 focus-within:ring-3 focus-within:ring-[#23355d]/10">
        <label htmlFor={TOWN_HALL_INPUT_ID} className="sr-only">Your question for General Management</label>
        <textarea id={TOWN_HALL_INPUT_ID} rows={2} maxLength={MAX_LENGTH} value={draft}
          onChange={(e) => { setDraft(e.target.value); setStatus('') }}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit() } }}
          placeholder="Ask General Management a question…"
          className="block w-full resize-none bg-transparent px-3 py-2 text-xs leading-relaxed text-slate-800 outline-none placeholder:text-slate-400" />
        <div className="flex items-center gap-2 border-t border-slate-100 px-2 py-1.5">
          <button type="button" role="switch" aria-checked={anonymous} onClick={() => setAnonymous(!anonymous)}
            className="inline-flex items-center gap-2 rounded-md px-1.5 py-1 text-[11px] text-slate-600 transition-colors hover:bg-slate-50">
            <span className={cn('relative h-3.5 w-6 rounded-full transition-colors', anonymous ? 'bg-[#23355d]' : 'bg-slate-300')}>
              <span className={cn('absolute top-0.5 size-2.5 rounded-full bg-white shadow-sm transition-[left]', anonymous ? 'left-3' : 'left-0.5')} />
            </span>
            Ask anonymously
          </button>
          <span className="ml-auto text-[10px] tabular-nums text-slate-400">{draft.length}/{MAX_LENGTH}</span>
          <button type="submit" disabled={!canSend} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-[#23355d] px-2.5 text-[11px] font-semibold text-white transition-colors hover:bg-[#192646] disabled:cursor-not-allowed disabled:opacity-40">
            <Send className="size-3" /> Send
          </button>
        </div>
      </form>
      <p aria-live="polite" className={cn('text-[11px] text-emerald-700', !status && 'sr-only')}>{status}</p>
    </div>

    <div className="flex items-baseline justify-between px-4 pb-1 pt-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Most asked</p>
      <p className="text-[10px] text-slate-400">{questions.length} questions</p>
    </div>
    <ol className="flex flex-col px-2 pb-2">
      {questions.map((q) => {
        const hasVoted = voted.includes(q.id)
        const votes = q.votes + (hasVoted ? 1 : 0)
        return <li key={q.id} className={cn('flex items-start gap-3 rounded-lg px-2 py-2', q.mine && 'sbd-rise bg-[#FBF8F5]')}>
          <button type="button" disabled={q.mine} aria-pressed={hasVoted} aria-label={`Upvote, ${votes} votes`}
            onClick={() => setVoted((list) => hasVoted ? list.filter((id) => id !== q.id) : [...list, q.id])}
            className={cn('flex w-10 shrink-0 flex-col items-center rounded-md border py-1 text-[11px] font-semibold tabular-nums transition-colors disabled:cursor-default',
              hasVoted ? 'border-[#23355d] bg-[#23355d] text-white' : 'border-slate-200 text-slate-600 hover:border-[#23355d]/40 hover:text-[#23355d] disabled:hover:border-slate-200 disabled:hover:text-slate-600')}>
            <ChevronUp key={hasVoted ? 'on' : 'off'} className={cn('size-3.5', hasVoted && 'sbd-pop')} />{votes}
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-xs leading-snug text-slate-800">{q.text}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[10.5px] text-slate-400">
              {q.author} · {relativeDay(q.askedAt, today)}
              {q.mine && <span className="rounded-full bg-amber-50 px-1.5 py-px text-[9.5px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">In review</span>}
            </p>
          </div>
        </li>
      })}
    </ol>

    <PanelLink>All questions & past Town Halls</PanelLink>
  </Panel>
}
