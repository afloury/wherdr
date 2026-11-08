// Is a machine other than the project's own ready to take its task? Run before
// a task's first start there (shared/pm/ready.ts): the start is refused with
// each failed check. A machine found ready is trusted for 10 minutes; any
// result is kept for the board's "Start on…" menu.
import { HerdrError } from './herdr'
import { PATH_SETUP, machineOn } from './coreCreate'
import { exec, wherdrBase, type PmLaunchDeps } from './pmLaunch'
import { READY_SCRIPT, readyOf, readyRefusal, type Readiness } from '../../shared/pm/ready'
import { reviewerPlan, shotStep, taskBase, taskPlan, workerPlan, type Task } from '../../shared/pm/run'
import type { Project } from '../../shared/pm/project'
import type { Template } from '../../shared/pm/workflow'

const FRESH_MS = 10 * 60_000
const last = new Map<string, Readiness & { refused?: string }>() // project|machine|visual → its last check

// The last check's failure, for the board ('' ready, undefined never checked).
export const lastReadiness = (project: string, machine: string) => {
  const r = last.get(`${project}|${machine}|0`) ?? last.get(`${project}|${machine}|1`)
  return r && (r.refused ?? '')
}

// Throws 'refused' when the machine cannot take the task: what fails there.
export async function ensureReady(deps: PmLaunchDeps, p: Project, t: Template, task: Task, machine: string, clone: string) {
  const visual = !!shotStep(t, task.type)
  const id = `${p.key}|${machine}|${visual ? 1 : 0}`, seen = last.get(id)
  if (seen && !seen.refused && Date.now() - seen.at < FRESH_MS) return
  const { m, on } = machineOn(deps, machine)
  const origin = await exec(deps, machineOn(deps, p.machine).on, 'git -C "$1" remote get-url origin', [p.path]).catch(() => ({ out: '' }))
  const programs = [...new Set([workerPlan(t, task), reviewerPlan(t, task)].flatMap(x => ('program' in x ? [x.program] : [])))]
  const gh = taskPlan(t, task, p).some(s => s.action?.kind.startsWith('github.'))
  const args = [clone, taskBase(task, p) ?? '', visual ? wherdrBase(machine, deps.origin) : '', gh ? '1' : '0', visual ? '1' : '0', ...programs]
  const r = await exec(deps, on, `${PATH_SETUP}\n${READY_SCRIPT}`, args, undefined, 90).catch(() => ({ out: '' }))
  const ready = readyOf(r.out, origin.out.trim())
  const refused = readyRefusal(ready)
  last.set(id, { ...ready, ...(refused ? { refused } : {}) })
  if (refused) throw new HerdrError('refused', `${m.label} is not ready for this project: ${refused}`)
}
