// The made-up wherdr session the /preview hero plays in a loop (~14 s), on the
// phone (PhoneDemo) and in the Safari window (DesktopDemo) on one shared
// clock, like one wherdr session opened on both devices.
import type { AgentState, DemoScript } from './demoScript'

export const AGENT = 'acme-api'
export const MESSAGE = 'Cache getUser, and clear the entry when a user changes.'
export const ACTIONS = [
  { tool: 'read', arg: 'src/users.js' },
  { tool: 'grep', arg: '"getUser" src/' },
  { tool: 'edit', arg: 'src/users.js  +18 −3' },
  { tool: 'bash', arg: 'npm test  ✓ 14 passed' },
] as const
export const PREVIOUS = 'The tests pass on main. Tell me what to change next.'
export const ANSWER = 'getUser now keeps users in a cache with an expiry, and updateUser clears the entry, so reads never return stale data.'
export const QUESTION = 'Which cache lifetime should getUser use?'
export const OPTIONS = [
  { n: 1, title: '1 minute', sub: 'Fresh data, more database reads' },
  { n: 2, title: '5 minutes', sub: 'Balanced' },
  { n: 3, title: '15 minutes', sub: 'Fewest reads' },
] as const
export const PICKED = 2

// Steps: 1 typing · 2 queued · 3 sent · 4–7 actions · 8 answer · 9 your turn · 10 picked · 11 fade.
export const HERO: DemoScript = {
  id: 'hero',
  timeline: [
    [700, 1], [2500, 2], [3300, 3], [3800, 4], [4450, 5], [5100, 6], [5750, 7],
    [6500, 8], [8700, 9], [10600, 10], [13300, 11],
  ],
  loop: 14000,
  final: 10,
  typing: { step: 1, text: MESSAGE, ms: 1500 },
}

/** The demo agent's state at a step: ready, then working once the message is read, then your turn. */
export function agentState(step: number): AgentState {
  return step >= 9 ? 'turn' : step >= 3 ? 'work' : 'ready'
}

/** The console actions shown at a step (one per step from 4 to 7). */
export function actionsAt(step: number) {
  return ACTIONS.slice(0, Math.max(0, Math.min(ACTIONS.length, step - 3)))
}
