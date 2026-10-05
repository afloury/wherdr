// The made-up wherdr session the /preview hero plays in a loop (~14 s), on the
// phone (PhoneDemo) and in the Safari window (DesktopDemo) on one shared
// clock, like one wherdr session opened on both devices.
import type { AgentState, DemoScript } from './demoScript'

export const AGENT = 'acme-api'
export const MESSAGE = 'Cache getUser, and clear the entry when a user changes.'
/** An omp tool call as its console writes it (app/utils/ompTool.ts): command line, intent, counts, wall time. */
export type OmpAction = { cmd: string, intent: string, meta?: string, ms: number }
export const ACTIONS: readonly OmpAction[] = [
  { cmd: 'read src/users.js', intent: 'Reading the user lookup', ms: 30 },
  { cmd: 'grep "getUser" src/', intent: 'Finding the callers', meta: '3 matches in 2 files', ms: 110 },
  { cmd: 'edit src/users.js', intent: 'Caching getUser', meta: '+18/-3', ms: 50 },
  { cmd: 'npm test', intent: 'Running the tests', ms: 2140 },
]
export const PREVIOUS = 'The tests pass on main. Tell me what to change next.'
/** Markdown: `code` in backticks. */
export const ANSWER = '`getUser` now keeps users in a cache with an expiry, and `updateUser` clears the entry, so reads never return stale data.'
export const QUESTION = 'Which cache lifetime should getUser use?'
export const OPTIONS = [
  { n: 1, title: '1 minute', sub: 'Fresh data, more database reads' },
  { n: 2, title: '5 minutes', sub: 'Balanced' },
  { n: 3, title: '15 minutes', sub: 'Fewest reads' },
] as const
export const PICKED = 2

// Steps: 1 typing · 2 queued · 3 sent · 4–7 actions · 8 answer · 9 your turn · 10 picked · 11 fade.
// The answer (step 8) types for ~2.1 s at the app's default speed before the question.
export const HERO: DemoScript = {
  id: 'hero',
  timeline: [
    [700, 1], [2500, 2], [3300, 3], [3800, 4], [4450, 5], [5100, 6], [5750, 7],
    [6500, 8], [9000, 9], [10900, 10], [13300, 11],
  ],
  loop: 14000,
  final: 9,
  typing: { step: 1, text: MESSAGE, ms: 1500 },
}

/** The demo agent's state at a step: ready, working once the message is read, your turn at the question, working again once answered. */
export function agentState(step: number): AgentState {
  if (step >= 10) return 'working'
  if (step >= 9) return 'blocked'
  return step >= 3 ? 'working' : 'idle'
}

/** The console actions shown at a step (one per step from 4 to 7). */
export function actionsAt(step: number) {
  return ACTIONS.slice(0, Math.max(0, Math.min(ACTIONS.length, step - 3)))
}

/** omp's running step under the conversation while it works on the message, none otherwise. */
export function ompStepAt(step: number): string | null {
  if (step < 3 || step >= 8) return null
  return actionsAt(step).at(-1)?.intent ?? 'Thinking'
}
