// Agents of a task that waits for the user are ended once idle for 10 minutes
// (every minute, from the mechanic's pass), and its worker starts again in the
// same worktree when the task needs it: a send-back, a conflict, red CI. The
// rules are in shared/pm/release.ts.
import { LABEL, type LabelledTerminal, type Task } from '../../shared/pm/run'
import { RELEASED_WHY, idleSince, releaseDue } from '../../shared/pm/release'
import { handoverText } from '../../shared/pm/stop'
import { startTask, type PmLaunchDeps } from './pmLaunch'
import { endAgents, load } from './pmStop'
import { forgetMemory } from './pmMemory'
import { placeFor } from './pmPlace'

type StatusTerminal = LabelledTerminal & { status?: string | { state?: string } | null }
const busyNow = (t?: StatusTerminal) => {
  const s = typeof t?.status === 'string' ? t.status : t?.status?.state
  return !t || (t.state !== 'finished' && (s === 'working' || s === 'blocked'))
}

// Task id → since when its agents are idle while it waits for the user. In
// memory: a restart starts the 10 minutes again.
const idle = new Map<string, number>()

export async function releaseIdle(deps: PmLaunchDeps, now = Date.now()) {
  const { store } = deps
  const { terminals } = await deps.call<{ terminals: StatusTerminal[] }>('terminal.list', { all: true, labels: { [LABEL.install]: await store.install() } }, 8000)
  const runs = (await store.runs()).filter(r => r.state !== 'ended')
  const released: string[] = []
  for (const task of await store.tasks()) {
    const mine = runs.filter(r => r.task === task.id)
    // A run still starting has no terminal yet: busy.
    const busy = mine.some(r => !r.terminal || busyNow(terminals.find(x => x.address === r.terminal)))
    const since = mine.length ? idleSince(idle.get(task.id), task, busy, now) : undefined
    if (since === undefined) { idle.delete(task.id); continue }
    idle.set(task.id, since)
    if (!releaseDue(since, now)) continue
    idle.delete(task.id)
    const t = await store.logTask(task, 'engine', 'released its agents: idle for 10 minutes while the task waits for you; they start again when it needs them')
    await endAgents(deps, t, 'released', ' to free memory')
    released.push(task.id)
  }
  return released
}

const heldLogged = new Set<string>()
// The released worker again, in its worktree, with a handover note; `now`:
// what it is to do first (red CI, a conflict), when the step itself does not
// say it. No room on its machine: not now, tried again on a later pass (undefined).
export async function reviveWorker(deps: PmLaunchDeps, id: string, why: string, now?: string): Promise<Task | undefined> {
  const { store } = deps
  const { task, plan } = await load(deps, id)
  const worker = (await store.runs()).filter(r => r.task === id && r.role === 'worker').sort((a, b) => b.startedAt - a.startedAt)[0]
  if (!worker) return
  const placed = await placeFor(deps, task)
  if ('hold' in placed) {
    if (!heldLogged.has(id)) await store.logTask(task, 'engine', `the worker starts again once there is room (${why}): ${placed.hold}`)
    return void heldLogged.add(id)
  }
  heldLogged.delete(id)
  forgetMemory(worker.machine)
  const handover = handoverText({ ...task, stopped: { by: 'the engine', why: RELEASED_WHY, at: Date.now() } }, plan, worker.branch)
    + (now ? `\nWhat to do now:\n\n${now}\n` : '')
  const started = await startTask(deps, id, { handover, revive: true })
  if (started.state !== 'working') return store.logTask(started, 'engine', `could not start the worker again (${why}): ${started.waiting ?? ''}`)
  // The handover gives the step's text: not sent again.
  const step = started.step && { ...started.step, told: started.step.since }
  return store.logTask({ ...started, step }, 'engine', `started the worker again in its worktree: ${why}`)
}
