// Tasks and the agent runs that work on them. A run's terminal carries
// wherdr.* labels on herdr-core, so the engine finds it again after a restart.
import type { Project } from './project'
import type { Prefs, Step, Template, Weight } from './workflow'
import { fillBase, planSteps, type StepState } from './steps'
import { needsShots, shotMode } from './shots'
import type { Stopped } from './stop'
import type { Report } from './report'
import type { Mark } from './times'
import { isPublic, publicWorkerSection } from './visibility'

// Who made a task: the user (the board, their turn), the coordinator in a
// wake, an automation, a mission.
export type TaskOrigin = 'user' | 'coordinator' | 'automation' | 'mission'

export interface Task {
  id: string // <project key>-<n>
  project: string
  title: string
  description: string
  type: string // a task type of the project's template
  state: 'todo' | 'working' | 'waiting'
  waiting?: string // why it waits for the user
  waitKind?: 'question' | 'permission' | 'auth' // what it waits for
  mech?: Record<string, number> // the engine's mechanical moves made (key → when): never twice
  ci?: { head: string, red: boolean } // its PR's CI at the task's commit, as the engine last read it
  queue?: number // its place in its project's merge queue (mergeQueue.ts), 1: merging now
  queueOut?: string // why it stepped out of the queue's line (a conflict, its checks, its agent's work)
  idle?: number // since when the agent holding its step sits idle, its report still due (blocked.ts)
  stall?: { cause: string, reason: string, since: number } // its stall as the engine last saw it (blocked.ts)
  stalls?: Record<string, { since: number, nudged?: number, restarted?: number, handled?: number, back?: number }> // each cause seen: when it began, its one nudge, restart and hand-over, when its agent went back to work
  selfFix?: { step: string, block: string, tried: string[], at: number, woke?: number } // the engine's tries on a block in this step (selfFix.ts)
  fixes?: { step: string, n: number } // mechanical fixes the coordinator's wakes made in this step (tell --fix)
  run?: string // the current run
  weight?: Weight // light, standard or heavy, set by the user or the coordinator (weight.ts); else from its type
  machine?: string // where its first start put it: it always goes back there (none, once started: its project's machine)
  step?: StepState // where the step engine has it
  base?: string // the project's working branch when it started ('' none): a later change leaves it alone
  branch?: string // its branch, named at its first start (branchName.ts), or the one its worker said it pushed
  branchStart?: string // the branch its worktree was made on (none: task/<id>)
  prefs?: Prefs
  tags?: string[] // short texts, shown on the card
  links?: { label: string, url: string }[] // the PR, the ticket…
  shotToken?: string // the agent's key for POST /api/pm/shot (never sent to the browser)
  log?: TaskLogEntry[] // who changed what, newest last
  marks?: Mark[] // when its step or turn changed, added by the store (times.ts)
  after?: string // tasks of the same project, comma-separated: this one starts once they are done
  stopped?: Stopped // who stopped it and why (stop.ts): it waits for the user
  autopilot?: true // started or added by the coordinator in a wake: its autopilot's own
  auto?: string // the automation that added it
  origin?: TaskOrigin // who made it: only automatic work is held by the pace (pace.ts)
  addedBy?: string // who added it: 'user', 'automation', or a coordinator's key (MAIN for the main one)
  held?: string // an automatic start waits for memory on its machine (memory.ts): the engine starts it once memory is back
  cleanup?: { done?: true, skipped?: string } // its worktree removed, or why it stays (cleanup.ts)
  report?: Report // a problem the user reported, open until the coordinator acts (report.ts)
  createdAt: number
}

// A task as the browser gets it: the agent's screenshot key stays on the server.
export const publicTask = ({ shotToken: _, ...t }: Task): Task => t

export interface TaskLogEntry { at: number, by: string, text: string }

export interface Run {
  id: string
  task: string
  role: 'worker' | 'reviewer'
  program: string // claude or codex
  model: string // pinned at launch
  machine: string // herdr-core machine key, '' = the wherdr host
  worktree: string
  branch: string
  instructions: string // file the agent reads first
  terminal?: string // herdr-core address, once started
  attempt: number // 1, or 2 after an agent that exited at once
  state: 'starting' | 'running' | 'ended'
  endedBy?: 'exit' | 'lost' | 'stopped' | 'released' // released: idle while its task waited for the user (release.ts)
  startedAt: number
  peakMb?: number // the most its worktree's processes took, sampled each tick (peaks.ts)
}

export const LABEL = { install: 'wherdr.install', task: 'wherdr.task', run: 'wherdr.run', role: 'wherdr.role', report: 'wherdr.report' } as const

export type WaitKind = NonNullable<Task['waitKind']>
// What a running agent waits for: its wherdr.report label (blocked:<kind>),
// else herdr-core's 'blocked' status, a tool's permission prompt.
export function waitOf(t: { labels?: Record<string, string>, status?: string | { state?: string } | null } | null | undefined): WaitKind | undefined {
  const m = /^blocked:(question|permission|auth)$/.exec(t?.labels?.[LABEL.report] ?? '')
  if (m) return m[1] as WaitKind
  const s = typeof t?.status === 'string' ? t.status : t?.status?.state
  if (s === 'blocked') return 'permission'
}
// Claude's "Do you trust this folder?" dialog on the worktree the engine made
// for the task from the user's own project: the engine answers it, once.
export const trustPrompt = (screen: string, worktree: string) =>
  /Yes, I trust this folder/.test(screen) && screen.includes(worktree)
// An agent that stopped because it is not logged in.
export const isAuthFailure = (text: string) => /not logged in|log ?in again|please (run )?\/?login|authenticat|unauthori[sz]ed|invalid api key|\b401\b/i.test(text)
// Agents the engine knows how to start with a pinned model and a first message.
export const PROGRAMS = ['claude', 'codex'] as const
// reviewModel: the worker's own model, in a new session.
export const SAME_MODEL = 'same'
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:[\]/-]{0,63}$/

export const runLabels = (install: string, run: Run) =>
  ({ [LABEL.install]: install, [LABEL.task]: run.task, [LABEL.run]: run.id, [LABEL.role]: run.role })

// Where a task works on its machine, under that machine's home.
export const taskPaths = (home: string, id: string, branch = `task/${id}`) => ({
  worktree: `${home}/.wherdr/pm/worktrees/${id}`,
  instructions: `${home}/.wherdr/pm/tasks/${id}/instructions.md`,
  branch,
})

// A task's agents keep their temporary files in its worktree, not in the
// machine's /tmp (often small, in memory, and shared by every agent): ignored
// by git, removed with the worktree, kept when the agents are released.
export const TMP_DIR = '.wherdr-tmp'
export const agentEnv = (worktree: string) => {
  const tmp = `${worktree}/${TMP_DIR}`
  return { DISABLE_AUTOUPDATER: '1', TMPDIR: tmp, CLAUDE_CODE_TMPDIR: tmp, NODE_COMPILE_CACHE: tmp }
}
// Below this, the machine's /tmp would make the agent's shell commands fail.
export const MIN_TMP_FREE_KB = 500 * 1024
// The temp folder script's output: the KB free in /tmp. Unknown: no refusal.
export function tmpRefusal(out: string) {
  const kb = Number(out.trim().split('\n').pop())
  if (!out.trim() || !Number.isFinite(kb) || kb >= MIN_TMP_FREE_KB) return undefined
  return `/tmp on the task's machine has only ${Math.floor(kb / 1024)} MB free (needs ${MIN_TMP_FREE_KB / 1024} MB): free some space, then start the task again`
}

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
// The shell line that starts the agent: model pinned, first message points at the file.
export function agentLine(program: string, model: string, instructions: string) {
  return ['exec', program, '--model', model, `Read ${instructions} and follow it.`].map((s, i) => (i < 2 ? s : quote(s))).join(' ')
}

// A task's working branch: the one it started with, else its project's now.
export const taskBase = (task: Pick<Task, 'base'>, p?: Pick<Project, 'base'>) =>
  (task.base !== undefined ? task.base : p?.base) || undefined

// A task's planned steps, with its working branch.
export const taskPlan = (t: Template, task: Pick<Task, 'type' | 'prefs' | 'base'>, p?: Pick<Project, 'base'>) =>
  planSteps(t, { type: task.type, ...(task.prefs ? { prefs: task.prefs } : {}) }, taskBase(task, p))

export const typeSteps = (t: Template, type: string): Step[] =>
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

// Program and model of the reviewer: reviewAgent and reviewModel, nearest
// level first. The reviewer is of another model than the worker, unless the
// template says reviewModel "same": a fresh session of the worker's model.
export function reviewerPlan(t: Template, task: Task): { program: string, model: string } | { reason: string } {
  const worker = workerPlan(t, task)
  if ('reason' in worker) return worker
  if (!typeSteps(t, task.type).some(s => s.holder === 'reviewer')) return { reason: `Task type "${task.type}" has no reviewer step` }
  const tt = t.taskTypes[task.type]
  const pick = (k: 'reviewAgent' | 'reviewModel') => task.prefs?.[k] || tt?.prefs?.[k] || t.prefs?.[k] || ''
  const program = pick('reviewAgent') || worker.program, asked = pick('reviewModel')
  const same = asked === SAME_MODEL, model = same ? worker.model : asked
  if (!(PROGRAMS as readonly string[]).includes(program)) return { reason: `The engine cannot start "${program}": claude or codex` }
  if (same && program !== worker.program) return { reason: `reviewModel "${SAME_MODEL}" needs the worker's agent (${worker.program})` }
  if (!MODEL_RE.test(model)) return { reason: model ? `Invalid review model "${model}"` : 'No review model set: add prefs.reviewModel to the template' }
  if (!same && model === worker.model) return { reason: `The reviewer must use another model than the worker (${model}), or set reviewModel to "${SAME_MODEL}"` }
  return { program, model }
}

// The worker's step that asks for screenshots, if any.
export const shotStep = (t: Template, type: string) => typeSteps(t, type).find(s => s.holder === 'worker' && needsShots(s))

// How the worker gives its screenshots: one ready command per image, to wherdr
// at `base`, with the task's key (no browser, no passkey session needed).
export function shotsSection(step: Step, task: Pick<Task, 'id'>, shots: { base: string, token: string }) {
  const both = shotMode(step) === 'before-after'
  const url = (phase: string) => `${shots.base.replace(/\/+$/, '')}/api/pm/shot?task=${task.id}&phase=${phase}`
  const cmd = (phase: string) => `curl -fsS -X POST -H 'Content-Type: image/png' -H 'X-Wherdr-Shot-Token: ${shots.token}' --data-binary @shot.png '${url(phase)}'`
  return [
    '## Screenshots', '',
    both
      ? 'Step "' + step.id + '" needs screenshots before and after your change: take the before ones first, on the unchanged code, then the same screens after.'
      : 'Step "' + step.id + '" needs screenshots of the result.',
    'Upload each one (PNG, JPEG or WebP, 10 MB max; set Content-Type to match) with:', '',
    ...(both ? ['    ' + cmd('before')] : []), '    ' + cmd('after'), '',
  ]
}

// The instructions file: the task, then every level's instructions, broadest
// first, then how to upload screenshots when a worker step asks for them, then
// a public repository's rule (leakCheck: its own check, see ownLeakCheck).
export function instructionsText(p: Project, t: Template, task: Task, run: Pick<Run, 'worktree' | 'branch'>, shots?: { base: string, token: string }, leakCheck?: string) {
  const step = typeSteps(t, task.type).find(s => s.holder === 'worker')
  const parts = [t.instructions, t.taskTypes[task.type]?.instructions, step?.instructions].map(s => s?.trim()).filter(Boolean).map(s => fillBase(s!, taskBase(task, p)))
  const visual = shotStep(t, task.type)
  return [
    `# ${task.id}: ${task.title}`, '', task.description.trim() || '(no description)', '',
    '## Instructions', '', ...(parts.length ? parts : ['(none)']), '',
    ...(visual && shots ? shotsSection(visual, task, shots) : []),
    ...(isPublic(p) ? publicWorkerSection(leakCheck) : []),
    `You work in ${run.worktree} on branch ${run.branch} of project ${p.name}. If you push your work to another branch, add a line \`Branch: <its name>\` to your note: the engine then follows that branch.`, '',
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

// Two live agents of one role on a task (two starts that raced): the one the
// engine tracks stays (the task's run, else its newest unended run), the others end.
export function duplicateAgents(terminals: LabelledTerminal[], runs: Run[], tasks: Pick<Task, 'id' | 'run'>[], install: string) {
  const groups = new Map<string, LabelledTerminal[]>()
  for (const x of terminals) {
    const l = x.labels
    if (x.state === 'finished' || l?.[LABEL.install] !== install || !l[LABEL.task] || !l[LABEL.role]) continue
    const k = `${l[LABEL.task]}\u0000${l[LABEL.role]}`
    groups.set(k, [...(groups.get(k) ?? []), x])
  }
  return [...groups.values()].filter(g => g.length > 1).map(g => {
    const task = g[0]!.labels![LABEL.task]!, role = g[0]!.labels![LABEL.role]! as Run['role']
    const tracked = tasks.find(t => t.id === task)?.run
    const rank = (x: LabelledTerminal) => {
      const id = x.labels![LABEL.run]
      if (id === tracked) return Infinity
      return runs.find(r => r.id === id && r.state !== 'ended')?.startedAt ?? -1
    }
    const keep = g.reduce((a, b) => (rank(b) > rank(a) ? b : a))
    return { task, role, keep, end: g.filter(x => x !== keep) }
  })
}
