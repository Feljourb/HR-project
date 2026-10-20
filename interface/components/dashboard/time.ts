'use client'

import { useEffect, useState } from 'react'

/* All "live" values are computed in office time so the clock, agenda and calendar agree
   regardless of the viewer's own timezone. */
export const OFFICE_TZ = 'Africa/Casablanca'

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** Current time, refreshed on an interval. `null` on the server and the first client render so markup hydrates cleanly. */
export function useNow(intervalMs = 15_000) {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const id = window.setInterval(() => setNow(new Date()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

export interface OfficeClock {
  key: string
  year: number
  month: number
  day: number
  minutes: number
  weekday: number
}

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: OFFICE_TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
})

/** Date parts in office time. `weekday` is 0 = Monday … 6 = Sunday. */
export function officeClock(now: Date): OfficeClock {
  const p: Record<string, number> = {}
  for (const part of partsFormatter.formatToParts(now)) if (part.type !== 'literal') p[part.type] = Number(part.value)
  const key = toKey(p.year, p.month, p.day)
  return { key, year: p.year, month: p.month, day: p.day, minutes: (p.hour % 24) * 60 + p.minute, weekday: dayParts(key).weekday }
}

/* Day keys are 'YYYY-MM-DD' strings: they sort lexically and avoid timezone drift. */
export const toKey = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

export function keyToDate(key: string) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

export function addDays(key: string, n: number) {
  const date = keyToDate(key)
  date.setUTCDate(date.getUTCDate() + n)
  return date.toISOString().slice(0, 10)
}

export const daysBetween = (from: string, to: string) => Math.round((keyToDate(to).getTime() - keyToDate(from).getTime()) / 86_400_000)

export const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()

export function dayParts(key: string) {
  const date = keyToDate(key)
  return { day: date.getUTCDate(), month: date.getUTCMonth(), year: date.getUTCFullYear(), weekday: (date.getUTCDay() + 6) % 7 }
}

/* Formatting is done by hand rather than with toLocaleDateString: ICU versions differ between
   Node and browsers (e.g. "Sep" vs "Sept"), which would break hydration. */
export const shortDate = (key: string) => { const p = dayParts(key); return `${p.day} ${MONTHS[p.month]}` }
export const fullDate = (key: string) => { const p = dayParts(key); return `${p.day} ${MONTHS[p.month]} ${p.year}` }
export const longDate = (key: string) => { const p = dayParts(key); return `${WEEKDAYS[p.weekday]} ${p.day} ${MONTHS_LONG[p.month]} ${p.year}` }
export const weekdayShort = (key: string) => WEEKDAYS[dayParts(key).weekday].slice(0, 3)

export function isoWeek(key: string) {
  const date = keyToDate(key)
  date.setUTCDate(date.getUTCDate() - dayParts(key).weekday + 3)
  const jan4 = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  return 1 + Math.round(((date.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7)
}

export function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export const formatClock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

export function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`
}

export const formatMad = (amount: number) => amount.toLocaleString('en-US')

/** Video timecode, e.g. 134 → "2:14". */
export const formatTimecode = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

/** "Today", "Yesterday", "3 days ago" relative to an office-time day key. */
export function relativeDay(key: string, today: string | null) {
  if (!today) return shortDate(key)
  const days = daysBetween(key, today)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return shortDate(key)
}
