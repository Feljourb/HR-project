'use client'

import { useSyncExternalStore } from 'react'
import type { ReactionKey } from './data'

/* Small in-memory store shared by panels that react to each other: acknowledging a must-read
   story completes its task in the KPI band, a reaction given in the video card shows in the
   theater, and closing the theater records where to resume. Resets on reload (no backend). */

interface LiveState {
  acknowledged: Record<string, string>
  reactions: Record<string, ReactionKey | null>
  videoProgress: Record<string, number>
}

const initial: LiveState = { acknowledged: {}, reactions: {}, videoProgress: {} }
let state = initial
const listeners = new Set<() => void>()

function update(next: Partial<LiveState>) {
  state = { ...state, ...next }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useLiveState() {
  return useSyncExternalStore(subscribe, () => state, () => initial)
}

export const acknowledge = (id: string) => update({ acknowledged: { ...state.acknowledged, [id]: new Date().toISOString() } })
export const setReaction = (id: string, key: ReactionKey | null) => update({ reactions: { ...state.reactions, [id]: key } })
export const saveVideoProgress = (id: string, seconds: number) => update({ videoProgress: { ...state.videoProgress, [id]: seconds } })
