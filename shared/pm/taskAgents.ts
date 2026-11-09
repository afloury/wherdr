// What a task's agent is doing, for its sidebar row (GET /api/pm/agents): the
// task it works on and its role there. Rows stay herdr-core's own (one per
// pane, its own status and group); this only names them.
import type { PlannedStep } from './steps'
import type { Run, Task } from './run'

// dev: the worker on its step; fix: the worker sent back (review, red CI,
// a failed action, the user); catch-up: the worker merging the base.
export type AgentRole = 'dev' | 'review' | 'fix' | 'catch-up'
// reserve: a reviewer kept between rounds, not reviewing now.
export interface TaskAgent { task: string, shown: string, title: string, role: AgentRole, reserve?: true }

// The engine's own sends to the worker during a later step (pmMechanic.ts logs `<move>: <result>`).
const SENT = /^(catch-up|ci-to-agent): (sent to the agent|started the worker again)/

export function agentRole(task: Task, plan: PlannedStep[], run: Pick<Run, 'role'>): Pick<TaskAgent, 'role' | 'reserve'> {
  const s = task.step
  const step = s?.started ? plan[s.at] : undefined
  if (run.role === 'reviewer') return step?.holder === 'reviewer' ? { role: 'review' } : { role: 'review', reserve: true }
  // The engine's latest send to the worker since the step began says what it does now.
  const sent = (task.log ?? []).findLast(e => e.by === 'engine' && e.at >= (s?.since ?? 0) && SENT.test(e.text))
  if (sent) return { role: sent.text.startsWith('catch-up') ? 'catch-up' : 'fix' }
  return { role: step?.holder === 'worker' && (s?.backFrom || s?.fix) ? 'fix' : 'dev' }
}

// Every running agent of a task, by its herdr-core address.
export function taskAgents(tasks: Task[], runs: Run[], planOf: (t: Task) => PlannedStep[], shownOf: (id: string) => string): Record<string, TaskAgent> {
  const out: Record<string, TaskAgent> = {}
  const byId = new Map(tasks.map(t => [t.id, t]))
  for (const run of runs) {
    const task = byId.get(run.task)
    if (!task || !run.terminal || run.state === 'ended') continue
    out[run.terminal] = { task: task.id, shown: shownOf(task.id), title: task.title, ...agentRole(task, planOf(task), run) }
  }
  return out
}
