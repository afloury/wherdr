// Tasks and the agent runs that work on them. A run's terminal carries
// wherdr.* labels on herdr-core, so the engine finds it again after a restart.
import type { Project } from './project'
import type { Prefs, Step, Template } from './workflow'

export interface Task {
  id: string // <project key>-<n>
  project: string
  title: string
  description: string
  type: string // a task type of the project's template
  state: 'todo' | 'working' | 'waiting'
  waiting?: string // why it waits for the user
  run?: string // the current run
  prefs?: Prefs
  createdAt: number
}

export interface Run {
  id: string
  task: string
  role: 'worker'
  program: string // claude or codex
  model: string // pinned at launch
  machine: string // herdr-core machine key, '' = the wherdr host
  worktree: string
  branch: string
  instructions: string // file the agent reads first
  terminal?: string // herdr-core address, once started
  attempt: number // 1, or 2 after an agent that exited at once
  state: 'starting' | 'running' | 'ended'
  endedBy?: 'exit' | 'lost'
  startedAt: number
}

export const LABEL = { install: 'wherdr.install', task: 'wherdr.task', run: 'wherdr.run', role: 'wherdr.role' } as const
// Agents the engine knows how to start with a pinned model and a first message.
export const PROGRAMS = ['claude', 'codex'] as const
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:[\]/-]{0,63}$/

export const runLabels = (install: string, run: Run) =>
  ({ [LABEL.install]: install, [LABEL.task]: run.task, [LABEL.run]: run.id, [LABEL.role]: run.role })

// Where a task works on its machine, under that machine's home.
export const taskPaths = (home: string, id: string) => ({
  worktree: `${home}/.wherdr/pm/worktrees/${id}`,
  instructions: `${home}/.wherdr/pm/tasks/${id}/instructions.md`,
  branch: `task/${id}`,
})

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
// The shell line that starts the agent: model pinned, first message points at the file.
export function agentLine(program: string, model: string, instructions: string) {
  return ['exec', program, '--model', model, `Read ${instructions} and follow it.`].map((s, i) => (i < 2 ? s : quote(s))).join(' ')
}

const typeSteps = (t: Template, type: string): Step[] =>
  (t.taskTypes[type]?.steps ?? []).map(s => (typeof s === 'string' ? t.steps?.[s] : s)).filter((s): s is Step => !!s)

// Program and model of the worker: the nearest level wins (task, task type,
// template). Returns the reason when the task cannot start.
export function workerPlan(t: Template, task: Task): { program: string, model: string } | { reason: string } {
  const tt = t.taskTypes[task.type]
  if (!tt) return { reason: `The template has no task type "${task.type}"` }
  if (!typeSteps(t, task.type).some(s => s.holder === 'worker')) return { reason: `Task type "${task.type}" has no worker step` }
  const pick = (k: 'agent' | 'model') => task.prefs?.[k] || tt.prefs?.[k] || t.prefs?.[k] || ''
  const program = pick('agent'), model = pick('model')
  if (!(PROGRAMS as readonly string[]).includes(program)) return { reason: program ? `The engine cannot start "${program}": claude or codex` : 'No agent set: add prefs.agent to the template' }
  if (!MODEL_RE.test(model)) return { reason: model ? `Invalid model "${model}"` : 'No model set: add prefs.model to the template (the model is always pinned)' }
  return { program, model }
}

// The instructions file: the task, then every level's instructions, broadest first.
export function instructionsText(p: Project, t: Template, task: Task, run: Pick<Run, 'worktree' | 'branch'>) {
  const step = typeSteps(t, task.type).find(s => s.holder === 'worker')
  const parts = [t.instructions, t.taskTypes[task.type]?.instructions, step?.instructions].map(s => s?.trim()).filter(Boolean)
  return [
    `# ${task.id}: ${task.title}`, '', task.description.trim() || '(no description)', '',
    '## Instructions', '', ...(parts.length ? parts : ['(none)']), '',
    `You work in ${run.worktree} on branch ${run.branch} of project ${p.name}.`, '',
  ].join('\n')
}

export interface LabelledTerminal { address: string, labels?: Record<string, string>, state?: string }
export type Found = { run: Run, terminal: string, state: 'running' } | { run: Run, state: 'exit' | 'lost' }

// After a restart: each unfinished run finds its terminal by its labels. A run
// still 'starting' may have started before the restart: its labels tell.
export function reconcile(runs: Run[], terminals: LabelledTerminal[], install: string): Found[] {
  return runs.filter(r => r.state !== 'ended').map((run): Found => {
    const t = terminals.find(x => x.labels?.[LABEL.install] === install && x.labels?.[LABEL.run] === run.id)
    if (!t) return { run, state: 'lost' }
    return t.state === 'finished' ? { run, state: 'exit' } : { run, terminal: t.address, state: 'running' }
  })
}
