// The pace of a project's automatic work, now: the account its worker uses
// (the project's machine × the worker's program), that account's latest
// reading and verdict. Read only when an automatic start or a scheduled wake
// asks for it.
import { accountFor } from '../../shared/quotaAccount'
import { DEFAULT_PACE, paceVerdict, type PacePolicy } from '../../shared/pm/pacing'
import { accountQuota, type PaceState } from '../../shared/pm/pace'
import { workerPlan, type Task } from '../../shared/pm/run'
import type { Quotas } from '../../shared/types'
import type { PmStore } from './pmStore'
import { readQuotas } from './quotas'
import { accountUsedToday } from './pacingLog'

// Each account's rule is stored by the Settings › Pace row (lot 3); until then
// every account keeps the default, 'free with reserve'.
const policyOf = (_key: string): PacePolicy => DEFAULT_PACE

// `task`: the one to start (its type and prefs pick the program); none: the
// template's first task type. `withToday`: also the weekly % used today
// (`autopilot show`). null: no template, or no worker program.
export async function projectPace(store: PmStore, project: string, task?: Pick<Task, 'type' | 'prefs'>, now = Date.now(), withToday = false): Promise<PaceState | null> {
  const p = (await store.projects()).find(x => x.key === project)
  const t = p?.template ? await store.template(p.template) : null
  if (!p || !t) return null
  const type = task?.type ?? Object.keys(t.taskTypes)[0] ?? ''
  const plan = workerPlan(t, { type, ...(task?.prefs ? { prefs: task.prefs } : {}) } as Task)
  if ('reason' in plan) return null
  const program = plan.program as 'claude' | 'codex'
  // A failed read: quota unknown, only the task-count limits hold.
  const q: Quotas | null = await readQuotas().catch(() => null)
  const account = accountFor(q?.accounts, p.machine, program)
  const quota = q && account ? accountQuota(q, account) : null
  const policy = account ? policyOf(account.key) : DEFAULT_PACE
  const today = account && withToday ? await accountUsedToday(account.key, now).catch(() => null) : null
  return { program, account, quota, policy, verdict: paceVerdict(policy, quota, now), today }
}
