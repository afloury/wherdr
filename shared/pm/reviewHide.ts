// Snooze and dismiss on an item of Tasks to review: the
// user's own notes on the entry, never on the task, its step or its agent. Kept
// on the server in the `reviewHidden` setting (settings.ts), so every device and
// every count follows. Snoozed: hidden until a time, then back if it still
// waits for the user, or sooner when something new happens on the task.
// Dismissed: hidden until something new happens on the task (reviewKey differs:
// a new step, a new block or question, a new timeout).
import type { Card } from './board'

export interface Hide { at: number, until?: number, seen?: string }
export type Hidden = Record<string, Hide>
export type CardHide = { kind: 'snoozed', until: number } | { kind: 'dismissed' }

// What a snooze may last: it must end in the future, within a month.
export const SNOOZE_MAX_MS = 31 * 24 * 3_600_000
const KEEP = 150

// What the entry is about right now: the step and when it began, its deadline
// only while the entry is that timeout (a pause moves the deadline, which is
// nothing new for the user), the badge, the agent's question and a stall.
// Anything new changes it.
export const reviewKey = (c: Pick<Card, 'step' | 'state' | 'yourTurn' | 'asks' | 'stall'>) => JSON.stringify([
  c.step ?? '', c.state?.at ?? 0, c.state?.since ?? 0, (c.state?.yourTurn?.reason === 'timeout' && c.state.deadline) || 0, c.yourTurn ?? '',
  c.asks ? [c.asks.kind, c.asks.text] : 0, c.stall ? [c.stall.cause, c.stall.since] : 0,
])

export function readHidden(raw: string | null | undefined): Hidden {
  let v: unknown
  try { v = raw ? JSON.parse(raw) : null } catch { return {} }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out: Hidden = {}
  for (const [id, h] of Object.entries(v)) {
    const x = h as Partial<Hide> | null
    if (!x || typeof x !== 'object' || typeof x.at !== 'number') continue
    if (typeof x.until === 'number') out[id] = { at: x.at, until: x.until, ...(typeof x.seen === 'string' ? { seen: x.seen } : {}) }
    else if (typeof x.seen === 'string') out[id] = { at: x.at, seen: x.seen }
  }
  return out
}

// The newest ones, without the snoozes that ended and the tasks that are gone.
export function writeHidden(h: Hidden, now: number, known?: (id: string) => boolean): string | null {
  const live = Object.entries(h).filter(([id, x]) => (x.until === undefined || x.until > now) && (!known || known(id)))
  live.sort((a, b) => b[1].at - a[1].at)
  return live.length ? JSON.stringify(Object.fromEntries(live.slice(0, KEEP))) : null
}

export function hideOf(h: Hidden, c: Pick<Card, 'id' | 'step' | 'state' | 'yourTurn' | 'asks' | 'stall'>, now: number): CardHide | undefined {
  const x = h[c.id]
  if (!x) return
  if (x.until !== undefined) return x.until > now && (x.seen === undefined || x.seen === reviewKey(c)) ? { kind: 'snoozed', until: x.until } : undefined
  return x.seen === reviewKey(c) ? { kind: 'dismissed' } : undefined
}

export const snooze = (h: Hidden, c: Pick<Card, 'id' | 'step' | 'state' | 'yourTurn' | 'asks' | 'stall'>, until: number, now: number): Hidden => ({ ...h, [c.id]: { at: now, until, seen: reviewKey(c) } })
export const dismiss = (h: Hidden, c: Pick<Card, 'id' | 'step' | 'state' | 'yourTurn' | 'asks' | 'stall'>, now: number): Hidden => ({ ...h, [c.id]: { at: now, seen: reviewKey(c) } })
export const show = (h: Hidden, id: string): Hidden => Object.fromEntries(Object.entries(h).filter(([k]) => k !== id))

// A valid snooze end from a client: a number in the future, within SNOOZE_MAX_MS.
export const snoozeEnd = (v: unknown, now: number) => (typeof v === 'number' && Number.isFinite(v) && v > now && v <= now + SNOOZE_MAX_MS ? Math.round(v) : undefined)
