// A worker's `blocked:on <task|repo>: <need>` report carried out, and the
// parked tasks whose wait is over taken up again in the same conversation.
// The rules are in shared/pm/park.ts.
import { BLOCKED_ON_CMD, parkOf, parseBlockedOn, resumeText } from '../../shared/pm/park'
import type { Run } from '../../shared/pm/run'
import { showIds } from '../../shared/pm/projectKey'
import type { PmLaunchDeps } from './pmLaunch'
import { endAgents } from './pmStop'
import { reviveWorker } from './pmRelease'
import { wakeCoordinators } from './pmWakes'

const PARKED_WHY = 'the task waited for another task, so its agents were ended to free their machine'

export async function blockedOn(deps: PmLaunchDeps, run: Run, label: string, now: number) {
  const { store } = deps, projects = await store.projects()
  const task = await store.task(run.task)
  if (!task || task.parked || task.step?.done) return
  const tell = (text: string) => deps.call('terminal.send', { terminal: run.terminal, text: showIds(projects, text) }, 30000)
  const asked = parseBlockedOn(label)
  if (!asked) return void await tell(`Not understood. Say it as: ${BLOCKED_ON_CMD}`)
  const r = parkOf(task, asked.on, asked.need, await store.tasks(), projects, now)
  // Each wake once: its key noted on the task first.
  const wake = async (key: string, text: string) => {
    const t = (await store.task(task.id))!
    if (t.mech?.[key]) return
    await store.saveTask({ ...t, mech: { ...t.mech, [key]: now } })
    await wakeCoordinators(deps, t, text, now)
  }
  if ('refused' in r) {
    await store.logTask(task, 'engine', `blocked on ${asked.on}: refused. ${r.refused}`)
    if (r.key && r.wake) await wake(r.key, r.wake)
    return void await tell(r.refused)
  }
  const saved = await store.logTask(r.park, 'engine', `parked: waits for ${r.park.parked!.on}: ${asked.need}`)
  // Ended only when its conversation can be taken up again (a Claude worker's pinned session);
  // another stays, idle, out of its machine's cap (agentsAtWork), and is told when it goes on.
  const live = (await store.runs()).filter(x => x.task === task.id && x.state !== 'ended')
  if (live.every(x => x.role !== 'worker' || (x.program === 'claude' && !!x.session))) await endAgents(deps, saved, 'released', ' while the task is parked')
  await wake(r.key, r.wake)
}

// A parked task whose wait is over: its worker told what changed, in its
// conversation (resumed when it was ended; a fresh one with a handover when it has none).
export async function resumeParked(deps: PmLaunchDeps) {
  const { store } = deps, projects = await store.projects(), tasks = await store.tasks()
  // A task stopped meanwhile waits for the user's Continue: never started here.
  for (const task of tasks.filter(t => t.parked && !t.step?.done && !t.stopped && t.state === 'working')) {
    const text = resumeText(task, tasks, projects)
    if (!text) continue
    const worker = (await store.runs()).filter(r => r.task === task.id && r.role === 'worker').sort((a, b) => b.startedAt - a.startedAt)[0]
    const why = `${task.parked!.on} is done, the parked task goes on`
    if (worker?.terminal && worker.state !== 'ended') {
      await deps.call('terminal.send', { terminal: worker.terminal, text: showIds(projects, text) }, 30000)
      await store.logTask({ ...task, parked: undefined }, 'engine', why)
      continue
    }
    const t = await reviveWorker(deps, task.id, why, worker?.session ? undefined : text, undefined, PARKED_WHY, text)
    if (t?.state === 'working') await store.saveTask({ ...(await store.task(task.id))!, parked: undefined })
  }
}
