// What waits for the user's choice, and one grouped push every 30 s for what is
// new among it (server/plugins/pm.ts), instead of one per item. A tap opens Tasks to review.
import { decisionsOf, decisionsPush } from '../../shared/pm/decisions'
import { board } from './pmBoard'
import type { PmStore } from './pmStore'
import { pushSend } from './push'
import { projectNotificationAllowed } from './notificationRules'
import { showIds } from '../../shared/pm/projectKey'
import { REVIEW_LINK } from '../../shared/appLinks'
import { coordinatorKey } from '../../shared/pm/workspace'
import { inHours } from '../../shared/pm/autopilot'

export async function decisions(store: PmStore) {
  if (!(await store.enabled())) return []
  const [b, tasks, wakes, projects] = [await board(store), await store.tasks(), await store.wakes(), await store.projects()]
  const coordinators = await Promise.all(projects.map(async (p) => {
    const c = await store.coordinator(p.key)
    return { project: p.key, name: p.name, ...(p.coordinatorName ? { coordinatorName: p.coordinatorName } : {}), ...(c?.proposal ? { proposal: { at: c.proposal.at, ...(c.proposal.said ? { said: c.proposal.said } : {}) } } : {}) }
  }))
  // Who is woken for a question: a task's coordinator (its workspace's) with its autopilot on, running, in its hours (pmWakes.ts).
  const now = Date.now(), asks: string[] = []
  for (const p of projects) {
    const c = await store.coordinator(coordinatorKey(p.key, projects)), ap = c?.autopilot
    if (ap?.on && c?.terminal && inHours(ap.hours, new Date(now))) asks.push(p.key)
  }
  return decisionsOf({ cards: b.cards, tasks, coordinators, wakes, asks, now })
}

// What was pushed already; null until the first tick, which only notes what
// waits (a restart does not push the same decisions again).
let told: Set<string> | null = null
type Notify = (p: { title: string, titleFr: string, body: string }, badge: number) => Promise<unknown>
const pushNotify: Notify = (p, badge) => pushSend({ ...p, tag: 'pm-decisions', url: `/${REVIEW_LINK}`, badge })

// allow: whether a project may notify (Muted, Do not disturb…): a muted project's decisions are left out of the push.
export async function decisionsTick(store: PmStore, notify: Notify = pushNotify, allow: (project: string) => Promise<boolean> = projectNotificationAllowed) {
  const ds = await decisions(store)
  const ok = new Map<string, boolean>()
  for (const project of new Set(ds.map(d => d.project))) ok.set(project, await allow(project).catch(() => false))
  const shown = ds.filter(d => ok.get(d.project))
  const p = told && decisionsPush(shown, told)
  told = new Set(ds.map(d => d.id))
  if (p) await notify(showIds(await store.projects(), p), shown.length).catch(() => {})
  return p
}
export const resetDecisionsTold = () => { told = null }
