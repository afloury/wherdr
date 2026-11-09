// Crash recovery (shared/pm/recovery.ts): a task whose agent an incident took
// waits for the engine; every minute, once its cause is gone and its machine
// has room (placement, the account's pace), the engine resumes it through
// startTask (one agent per task), the tasks before it first, one per machine
// and tick. Claude takes its conversation up again (--resume); else a new
// agent reads its instructions with a handover note.
import { randomUUID } from 'node:crypto'
import { MAIN } from '../../shared/pm/coordinator'
import { enqueue, wakesFor } from '../../shared/pm/wakes'
import type { Incident } from '../../shared/pm/incident'
import { causeGone, interrupted, interruptedWhy, resumeOrder, resumeText } from '../../shared/pm/recovery'
import { handoverText } from '../../shared/pm/stop'
import type { Task } from '../../shared/pm/run'
import { machineOn } from './coreCreate'
import { HerdrError } from './herdr'
import { limitOf, readAccounts, type IncidentDeps } from './pmIncidents'
import { startTask, type PmLaunchDeps } from './pmLaunch'
import { paceOf, placeFor } from './pmPlace'
import { forgetMemory } from './pmMemory'
import { load } from './pmStop'

// The task's agent gone with this incident: it waits for the engine's resume,
// or, the same cause again right after one, the coordinators are woken once.
export async function interruptTask(deps: PmLaunchDeps, task: Task, i: Incident, now = Date.now()): Promise<Task> {
  const r = interrupted(task, i, now)
  if (!r.escalate) return deps.store.saveTask(r.task)
  const { store } = deps
  const coords = new Map([[task.project, await store.coordinator(task.project)], [MAIN, await store.coordinator(MAIN)]])
  const keys = wakesFor([task.project, MAIN], k => coords.get(k) ?? undefined, now)
  for (const key of keys) await store.saveWakes([enqueue(await store.wakes(), key, [r.escalate], now, randomUUID().replace(/-/g, '').slice(0, 8), false, { kind: 'engine' })])
  return store.logTask(r.task, 'engine', `not resumed again: the same cause right after a resume${keys.length ? `; woke ${keys.map(k => (k === MAIN ? 'the main coordinator' : 'the project\'s coordinator')).join(' and ')}` : ''}`)
}

export async function resumeInterrupted(deps: IncidentDeps, now = Date.now()) {
  const { store } = deps
  const runs = await store.runs(), projects = await store.projects(), machines = new Set<string>(), resumed: string[] = []
  let accounts: Awaited<ReturnType<typeof readAccounts>> | undefined
  for (const t of resumeOrder(await store.tasks())) {
    const r = t.recovery!
    const worker = runs.filter(x => x.task === t.id && x.role === 'worker').sort((a, b) => b.startedAt - a.startedAt)[0]
    const p = projects.find(x => x.key === t.project)
    if (!worker || !p || machines.has(worker.machine)) continue
    let online = true
    try { machineOn(deps, worker.machine) } catch { online = false }
    const limited = online && r.cause === 'limit' && !!limitOf(accounts ??= await readAccounts(deps))(worker.program, worker.machine, now)
    if (!causeGone(r, { online, limited })) continue
    const placed = await placeFor(deps, t, { waits: (await paceOf(store, p, t, now)).waits })
    if ('hold' in placed) { if (t.held !== placed.hold) await store.logTask({ ...t, held: placed.hold }, 'engine', `resumes once there is room: ${placed.hold}`); continue }
    machines.add(placed.machine)
    forgetMemory(placed.machine)
    // Not waiting any more: a failed start is the user's, never tried again in a loop.
    const fresh = await store.saveTask({ ...t, held: undefined, recovery: { ...r, waits: undefined, resumedAt: now } })
    const { plan } = await load(deps, t.id)
    const handover = handoverText({ ...fresh, stopped: { by: 'the engine', why: interruptedWhy(r), at: now } }, plan, worker.branch)
    const session = worker.program === 'claude' && worker.session ? { session: worker.session, text: resumeText(r, worker.instructions) } : undefined
    const res = await startTask(deps, t.id, { handover, ...(session ? { resume: session } : {}) }).catch(async (e: Error) => {
      // Started another way meanwhile (the user, the coordinator): nothing to do.
      if (e instanceof HerdrError && e.code === 'busy') return null
      return store.saveTask({ ...(await store.task(t.id))!, state: 'waiting', waiting: e.message })
    })
    if (!res) continue
    await store.logTask((await store.task(t.id))!, 'engine', res.state === 'working'
      ? `resumed after incident ${r.incident} (${r.cause})${session ? ', the worker\'s conversation taken up again' : ''}`
      : `could not resume after incident ${r.incident}: ${res.waiting ?? ''}`)
    resumed.push(t.id)
  }
  return resumed
}
