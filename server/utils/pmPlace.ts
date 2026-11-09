// Where a task of a project starts (shared/pm/placement.ts): each allowed
// machine read now (capacity, settings, agents at work, readiness, pace),
// then placeTask picks one or holds the start with each machine's reason.
import { HerdrError } from './herdr'
import { allowedMachines, taskMachine, type Project } from '../../shared/pm/project'
import { placeTask, type Candidate, type Placement } from '../../shared/pm/placement'
import { DEFAULT_MEMORY } from '../../shared/pm/memory'
import { weightOf } from '../../shared/pm/weight'
import { paceWait } from '../../shared/pm/pace'
import type { PaceVerdict } from '../../shared/pm/pacing'
import type { Task } from '../../shared/pm/run'
import type { PmStore } from './pmStore'
import { atWork, machineCapacity, readMemorySettings } from './pmMemory'
import { readiness } from './pmReady'
import { projectPace } from './pmPace'
import type { PmLaunchDeps } from './pmLaunch'

// The pace of automatic work for a task, per allowed machine (each may use
// another account): the verdict the project's limits see (home's when it goes,
// else the first machine's that goes) and the machines whose account waits,
// which placement skips.
export async function paceOf(store: PmStore, p: Project, task: Pick<Task, 'type' | 'prefs'>, now = Date.now()) {
  const all = await Promise.all(allowedMachines(p).map(async m => [m, (await projectPace(store, p.key, task, now, false, m))?.verdict] as const))
  const waits: Record<string, string> = {}
  for (const [m, v] of all) if (v && !v.go) waits[m] = `paced: ${paceWait(v)}`
  const verdict: PaceVerdict | undefined = all.find(([m]) => !waits[m])?.[1] ?? all[0]?.[1]
  return { verdict, waits }
}

// asked: the machine the user or the coordinator named (refused when the
// project does not allow it, or the task started elsewhere). waits: machines
// that take nothing now (paceOf). A started task only ever goes back to its own.
export async function placeFor(deps: PmLaunchDeps, task: Task, { asked, waits = {} }: { asked?: string, waits?: Record<string, string> } = {}): Promise<Placement> {
  const p = (await deps.store.projects()).find(x => x.key === task.project)
  if (!p) throw new HerdrError('not_found', 'Unknown project')
  const fixed = taskMachine(task, p, asked)
  if ('refused' in fixed) throw new HerdrError('refused', fixed.refused)
  const fresh = task.machine === undefined && !task.run
  const pinned = fresh ? asked : fixed.machine
  const t = await deps.store.workflow(p.key)
  const settings = await readMemorySettings()
  // A failed read never holds a start: it goes where it would have gone without placement.
  const candidates = await Promise.all((pinned === undefined ? allowedMachines(p) : [pinned]).map(async (key): Promise<Candidate> => {
    const m = deps.machines().find(x => x.key === key)
    const online = !!m && (m.local || m.status === 'online')
    // Another machine than home, before the task's first start there: ready for the project?
    const notReady = online && fresh && key !== p.machine ? await readiness(deps, p, t, task, key).catch((e: Error) => e.message) : ''
    const wait = waits[key] ?? (notReady ? `not ready (${notReady})` : undefined)
    return {
      key, label: m?.label ?? key, online, ...(wait ? { wait } : {}), settings: settings[key] ?? DEFAULT_MEMORY,
      capacity: online ? await machineCapacity(deps, key) : null, running: online ? await atWork(deps.store, key) : [],
    }
  })).catch(() => null)
  if (!candidates) return { machine: fixed.machine }
  return placeTask({ weight: weightOf(t, task).weight, home: p.machine, pinned, candidates, strategy: p.placement })
}

// The machine a start that must go (the user's) takes, and the hold it goes past.
export const goesTo = (placed: Placement) =>
  'machine' in placed ? { on: placed.machine } : { on: placed.best, short: placed.hold }
