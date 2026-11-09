// Where a task of a project starts (shared/pm/placement.ts): each allowed
// machine read now (capacity, settings, agents at work, readiness, pace),
// then placeTask picks one or holds the start with each machine's reason.
import { HerdrError } from './herdr'
import { allowedMachines, taskMachine, type Project } from '../../shared/pm/project'
import { machineLine, placeTask, type Candidate, type Placement } from '../../shared/pm/placement'
import { DEFAULT_MEMORY } from '../../shared/pm/memory'
import { weightOf, type Weight } from '../../shared/pm/weight'
import { paceWait } from '../../shared/pm/pace'
import type { PaceVerdict } from '../../shared/pm/pacing'
import { taskPlan, type Task } from '../../shared/pm/run'
import { holdsSlot, type SlotOf } from '../../shared/pm/autopilot'
import type { PmStore } from './pmStore'
import { atWork, machineCapacity, readMemorySettings } from './pmMemory'
import { lastReadiness, readiness } from './pmReady'
import { projectPace } from './pmPace'
import { projectEstimates } from './pmPeaks'
import type { PmLaunchDeps } from './pmLaunch'
import type { CoreMachine } from '../../shared/coreState'

// The pace of automatic work for a task, per allowed machine (each may use
// another account): the verdict the project's limits see (home's when it goes,
// else the first machine's that goes) and the machines whose account waits,
// which placement skips.
export async function paceOf(store: PmStore, p: Project, task?: Pick<Task, 'type' | 'prefs'>, now = Date.now()) {
  const all = await Promise.all(allowedMachines(p).map(async m => [m, (await projectPace(store, p.key, task, now, false, m))?.verdict] as const))
  const waits: Record<string, string> = {}
  for (const [m, v] of all) if (v && !v.go) waits[m] = `paced: ${paceWait(v)}`
  const verdict: PaceVerdict | undefined = all.find(([m]) => !waits[m])?.[1] ?? all[0]?.[1]
  return { verdict, waits }
}

const anywayLogged = new Set<string>()
// asked: the machine the user or the coordinator named (refused when the
// project does not allow it, or the task started elsewhere); offline, a new task goes elsewhere. waits: machines
// that take nothing now (paceOf). weight: what this start does, when it is not
// the task's (a worker started again: reviveWeight). A started task only ever
// goes back to its own. A task too big for every machine goes anyway, said
// once in its log.
export async function placeFor(deps: PmLaunchDeps, task: Task, { asked, waits = {}, weight }: { asked?: string, waits?: Record<string, string>, weight?: Weight } = {}): Promise<Placement> {
  const p = (await deps.store.projects()).find(x => x.key === task.project)
  if (!p) throw new HerdrError('not_found', 'Unknown project')
  const fixed = taskMachine(task, p, asked)
  if ('refused' in fixed) throw new HerdrError('refused', fixed.refused)
  const fresh = task.machine === undefined && !task.run
  const pinned = fresh ? undefined : fixed.machine
  const t = await deps.store.workflow(p.key)
  const settings = await readMemorySettings()
  // Each machine's state now, not the last reading (a few seconds old): one that just went offline takes nothing.
  const listed = await Promise.resolve().then(() => deps.call<{ machines?: CoreMachine[] }>('machine.list', {}, 3000)).then(r => r?.machines ?? null, () => null)
  // A failed read never holds a start: it goes where it would have gone without placement.
  const candidates = await Promise.all((pinned === undefined ? allowedMachines(p) : [pinned]).map(async (key): Promise<Candidate> => {
    const m = deps.machines().find(x => x.key === key)
    const online = !!m && (m.local || (listed ? listed.some(x => x.name === m.label && x.state === 'connected') : m.status === 'online'))
    // Another machine than home, before the task's first start there: ready for the project?
    const notReady = online && fresh && key !== p.machine ? await readiness(deps, p, t, task, key).catch((e: Error) => e.message) : ''
    const wait = waits[key] ?? (notReady ? `not ready (${notReady})` : undefined)
    return {
      key, label: m?.label ?? key, online, ...(wait ? { wait } : {}), settings: settings[key] ?? DEFAULT_MEMORY,
      capacity: online ? await machineCapacity(deps, key) : null, running: online ? await atWork(deps.store, key) : [],
    }
  })).catch(() => null)
  if (!candidates) return { machine: fixed.machine }
  const w = weight ?? weightOf(t, task).weight
  const estimate = (await projectEstimates(deps.store, p.key))[w]
  const placed = placeTask({ weight: w, estimate, home: p.machine, pinned, ...(fresh && asked !== undefined ? { prefer: asked } : {}), candidates, strategy: p.placement })
  if ('anyway' in placed && placed.anyway && !anywayLogged.has(task.id)) {
    anywayLogged.add(task.id)
    await deps.store.logTask((await deps.store.task(task.id)) ?? task, 'engine', placed.anyway)
  }
  return placed
}

// The machine a start that must go (the user's) takes, and the hold it goes past.
export const goesTo = (placed: Placement) =>
  'machine' in placed ? { on: placed.machine } : { on: placed.best, short: placed.hold }

// The project's allowed machines for `autopilot show`, one line each
// (machineLine). Readiness is the last check's, never run from here; pace is
// each machine's account, for a task of the workflow's first type (paceOf).
export async function machineLines(deps: PmLaunchDeps, p: Project, now = Date.now()): Promise<string[]> {
  const [settings, { waits }] = await Promise.all([readMemorySettings(), paceOf(deps.store, p, undefined, now).catch(() => ({ waits: {} as Record<string, string> }))])
  return Promise.all(allowedMachines(p).map(async (key) => {
    const m = deps.machines().find(x => x.key === key)
    const online = !!m && (m.local || m.status === 'online')
    const home = key === p.machine, ready = home ? '' : lastReadiness(p.key, key)
    return machineLine({
      key, label: m?.label ?? key, online, home, ...(waits[key] ? { wait: waits[key] } : ready ? { wait: `not ready (${ready})` } : {}), ...(ready === undefined ? { unchecked: true } : {}),
      settings: settings[key] ?? DEFAULT_MEMORY, capacity: online ? await machineCapacity(deps, key) : null, running: online ? await atWork(deps.store, key) : [],
    })
  }))
}

// Which tasks of these projects take a tasks-at-once slot (holdsSlot), by their plan.
export async function slotsOf(store: PmStore, projects: Project[]): Promise<SlotOf> {
  const tpl = new Map(await Promise.all(projects.map(async p => [p.key, { p, t: await store.workflow(p.key).catch(() => null) }] as const)))
  return (task) => {
    const x = tpl.get(task.project)
    return holdsSlot(task, x?.t ? taskPlan(x.t, task, x.p) : undefined)
  }
}
