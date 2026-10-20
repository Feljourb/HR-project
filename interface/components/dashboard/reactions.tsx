'use client'

import { useState } from 'react'
import { Heart, Lightbulb, PartyPopper, ThumbsUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ReactionKey } from './data'
import { setReaction, useLiveState } from './live-store'

const REACTIONS: { key: ReactionKey; label: string; icon: typeof ThumbsUp }[] = [
  { key: 'like', label: 'Like', icon: ThumbsUp },
  { key: 'celebrate', label: 'Celebrate', icon: PartyPopper },
  { key: 'insightful', label: 'Insightful', icon: Lightbulb },
  { key: 'support', label: 'Support', icon: Heart },
]

const tones = {
  dark: { idle: 'bg-white/[0.07] text-[#D5DBE8] hover:bg-white/[0.13] hover:text-white', active: 'bg-[#E9D5C0] text-[#101B35]' },
  light: { idle: 'bg-slate-100 text-slate-600 hover:bg-slate-200/80 hover:text-slate-800', active: 'bg-[#23355d] text-white' },
}

export const reactionTotal = (counts: Record<ReactionKey, number>) => Object.values(counts).reduce((sum, n) => sum + n, 0)

/** One reaction per person, like most workplace feeds. `compact` shows icons only, with the total beside them. */
export function ReactionBar({ id, counts, tone = 'light', compact = false }: { id: string; counts: Record<ReactionKey, number>; tone?: 'light' | 'dark'; compact?: boolean }) {
  const mine = useLiveState().reactions[id] ?? null
  const [burst, setBurst] = useState(0)
  const total = reactionTotal(counts) + (mine ? 1 : 0)

  return <div role="group" aria-label="Reactions" className="flex items-center gap-1">
    {REACTIONS.map(({ key, label, icon: Icon }) => {
      const active = mine === key
      const count = counts[key] + (active ? 1 : 0)
      return <button key={key} type="button" aria-pressed={active} aria-label={`${label}, ${count}`} title={label}
        onClick={() => { setReaction(id, active ? null : key); setBurst((n) => n + 1) }}
        className={cn('inline-flex h-7 items-center justify-center gap-1.5 rounded-full text-[11px] font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2',
          tone === 'dark' ? 'focus-visible:ring-[#E9D5C0]/60' : 'focus-visible:ring-[#23355d]/30',
          compact ? 'w-7' : 'px-2.5',
          active ? tones[tone].active : tones[tone].idle)}>
        <Icon key={active ? `on-${burst}` : 'off'} className={cn('size-3.5', active && 'sbd-pop')} />
        {!compact && count}
      </button>
    })}
    {compact && <span className={cn('ml-1 text-[11px] tabular-nums', tone === 'dark' ? 'text-[#A9B4CC]' : 'text-slate-500')}>{total.toLocaleString('en-US')}</span>}
  </div>
}
