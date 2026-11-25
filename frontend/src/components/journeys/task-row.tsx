'use client'

/*
 * UNE tâche d'arrivée / de départ (règle "one shared thing = one component") : la même ligne dans "My tasks"
 * (la personne qui la fait) et dans le panneau des RH (qui suivent tout le parcours).
 * - À faire : le nom, qui, "Before 28/11/2026" (rouge "Late" si la date est passée), et le bouton "Mark done".
 *   Une tâche avec une information à noter (ex. "Numéro de série du PC", comme NOOR) : un petit formulaire s'ouvre.
 * - Faite : ✓ vert, "Done by Karim on 25/11/2026 · Numéro de série du PC: ABC123", et "Undo" (une erreur).
 */
import { useState } from 'react'
import { Check, Circle, Loader2, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { refreshCounters } from '@/lib/counters'
import { errorOf, frDate, markDone, reopenTask, whoLabel, type Task } from '@/lib/journeys'

export function TaskRow({ task, showWho = true, readOnly = false, onChanged }: {
  task: Task; showWho?: boolean; readOnly?: boolean; onChanged: () => void
}) {
  const [open, setOpen] = useState(false)          // le petit formulaire "Mark done"
  const [detail, setDetail] = useState('')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const done = task.done_at !== null

  async function send(action: () => Promise<Response>) {
    setBusy(true)
    setError('')
    const response = await action().catch(() => null)
    setBusy(false)
    if (response?.ok) {
      setOpen(false)
      refreshCounters()  // le nombre de "My tasks" dans la sidebar
      onChanged()
    } else {
      setError(response ? await errorOf(response) : 'The server does not answer. Try again.')
    }
  }

  // "Mark done" : direct, sauf s'il y a une information à noter (alors le petit formulaire).
  function clickDone() {
    if (task.detail_label) setOpen(true)
    else void send(() => markDone(task.id, '', ''))
  }

  return <li className="flex gap-3 px-4 py-3">
    {done
      ? <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"><Check className="size-3.5" aria-label="Done" /></span>
      : <Circle className={cn('mt-0.5 size-5 shrink-0', task.late ? 'text-red-400' : 'text-slate-300')} aria-label="To do" />}

    <div className="min-w-0 flex-1">
      <p className={cn('text-sm font-medium', done ? 'text-slate-500' : 'text-[#192646]')}>{task.name}</p>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
        {showWho && <span>{whoLabel(task)}</span>}
        {showWho && <span aria-hidden>·</span>}
        {done
          ? <span>Done by {task.done_by_name ?? '?'} on {frDate(task.done_at!.slice(0, 10))}</span>
          : <span>Before {frDate(task.due_date)}</span>}
        {!done && task.late && <span className="rounded-full bg-red-50 px-2 py-0.5 font-semibold text-red-700">Late</span>}
      </p>
      {done && (task.detail || task.comment) && <p className="mt-1 text-[11px] text-slate-600">
        {task.detail && <span>{task.detail_label}: <span className="font-semibold">{task.detail}</span></span>}
        {task.detail && task.comment && ' · '}
        {task.comment && <span>“{task.comment}”</span>}
      </p>}

      {/* Le petit formulaire : l'information à noter (optionnelle) + un commentaire. */}
      {open && <form className="mt-2 flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3"
        onSubmit={(e) => { e.preventDefault(); void send(() => markDone(task.id, detail, comment)) }}>
        <label className="text-[11px] font-semibold text-slate-700">{task.detail_label} <span className="font-normal text-slate-400">(optional)</span>
          <input value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={200} autoFocus
            className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm outline-none focus:border-[#23355d]" />
        </label>
        <label className="text-[11px] font-semibold text-slate-700">Comment <span className="font-normal text-slate-400">(optional)</span>
          <input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500}
            className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm outline-none focus:border-[#23355d]" />
        </label>
        <div className="flex gap-2">
          <button type="submit" disabled={busy} className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Done
          </button>
          <button type="button" onClick={() => setOpen(false)} className="rounded-md px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200">Cancel</button>
        </div>
      </form>}
      {error && <p role="alert" className="mt-1 text-[11px] font-medium text-red-600">{error}</p>}
    </div>

    {!readOnly && !open && (done
      ? <button type="button" onClick={() => void send(() => reopenTask(task.id))} disabled={busy} title="Not done after all: back to “to do”"
          className="flex h-8 shrink-0 items-center gap-1 self-start rounded-md px-2 text-[11px] font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-60">
          <RotateCcw className="size-3" /> Undo
        </button>
      : <button type="button" onClick={clickDone} disabled={busy}
          className="flex h-8 shrink-0 items-center gap-1.5 self-start rounded-md border border-emerald-200 bg-white px-2.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60">
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Mark done
        </button>)}
  </li>
}
