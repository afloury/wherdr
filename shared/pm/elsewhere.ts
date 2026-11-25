import type { Task } from './run'
// What the user did elsewhere than through a coordinator: answered a task's agent in its own
// session ('reply') or pressed a step's button ('step'). Kept per
// coordinator (and Alfred) so the next wake says so, and so an open question, choices or
// card about that task reads as answered, for a step only (answeredElsewhere).
export type ElsewhereWhat = 'reply' | 'step'
export interface Elsewhere { task: string, shown: string, at: number, what: ElsewhereWhat, role?: 'worker' | 'reviewer', said?: string, woken?: true }
export const ELSEWHERE_KEPT = 50
export const ELSEWHERE_MAX_AGE = 7 * 24 * 3_600_000

// The list with `e` added, the oldest ones past the cap and those past the age dropped.
export function recordElsewhere(list: Elsewhere[], e: Elsewhere, now: number): Elsewhere[] {
  return [...list, e].filter(x => now - x.at <= ELSEWHERE_MAX_AGE).slice(-ELSEWHERE_KEPT)
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const mentions = (text: string, id: string) => !!id && new RegExp(`(?<![\\w-])${esc(id)}(?![\\w-])`).test(text)

// The step button entry about a task the card's message names (its shown or stored id, a
// whole word, case kept) that came after the message; the newest one. A reply to the task's agent never
// answers a card: only the user's own pick or message in the card's chat does.
export function answeredElsewhere(list: readonly Elsewhere[], card: { text: string, at: number }): Elsewhere | undefined {
  return list.findLast(e => e.what !== 'reply' && e.at > card.at && (mentions(card.text, e.shown) || mentions(card.text, e.task)))
}

// What a coordinator's next wake says of an entry (hhmm: its time, as the user's clock shows it).
export function noticeText(e: Elsewhere, hhmm: string): string {
  if (e.what === 'reply') return `User replied directly to ${e.shown}'s ${e.role ?? 'agent'} at ${hhmm}${e.said ? `: ${e.said}` : ''}`
  return `User acted on ${e.shown}'s step themselves at ${hhmm}`
}

// What the agent had said when the user answered it: a newer report, verdict or question ends the reply's line.
export interface RepliedSeen { reports: number, rounds: number, reviewed?: string, question?: string }
// told: the agent's answer has been woken to the coordinator (once).
export interface RepliedMark { at: number, role: 'worker' | 'reviewer', said: string, seen?: RepliedSeen, told?: true }
type Said = Pick<Task, 'workReports' | 'question' | 'work'> & { step?: Pick<NonNullable<Task['step']>, 'reviews'> }

export const repliedSeen = (t: Said): RepliedSeen => ({
  reports: t.workReports?.length ?? 0,
  rounds: Object.values(t.step?.reviews ?? {}).reduce((n, r) => n + r.length, 0),
  ...(t.work?.reviewed ? { reviewed: t.work.reviewed } : {}),
  ...(t.question ? { question: `${t.question.length}:${t.question.slice(0, 100)}` } : {}),
})

// The reply still to show on the task's review entry: until its agent reports, gives a verdict or asks a
// new question after it.
export function repliedOpen(t: Said & { replied?: RepliedMark }): { at: number, role: 'worker' | 'reviewer', said: string } | undefined {
  const r = t.replied
  if (!r) return
  const was = r.seen, now = repliedSeen(t)
  if (was && (now.reports > was.reports || now.rounds > was.rounds || now.reviewed !== was.reviewed || (now.question && now.question !== was.question))) return
  return { at: r.at, role: r.role, said: r.said }
}
