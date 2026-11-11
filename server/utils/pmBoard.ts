// The board's data, and the user's button on a step that waits for them.
import { boardColumns, cardOf, shownTexts, type Board, type BoardMachine, type Card } from '../../shared/pm/board'
import { initialState, onEvent, planSteps, reviewedCommit, reworkSince, waitsToMerge, type StepEvent } from '../../shared/pm/steps'
import { taskGuards, type ActionResult } from '../../shared/pm/actions'
import type { MergeBy, Template } from '../../shared/pm/workflow'
import { addShot, isImage, needsShots, SHOT_TYPES, type Shot } from '../../shared/pm/shots'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { taskPlan, type Task } from '../../shared/pm/run'
import { boardOrder } from '../../shared/pm/boardOrder'
import { weightOf, weightText } from '../../shared/pm/weight'
import { allowedMachines, type Project } from '../../shared/pm/project'
import type { MachineInfo } from '../../shared/types'
import { lastReadiness } from './pmReady'
import { shownTaskId } from '../../shared/pm/projectKey'
import { taskAgents, type TaskAgent } from '../../shared/pm/taskAgents'
import { CHOICES, type Choice } from '../../shared/pm/verdict'
import { actionShell, runAction } from './pmActions'
import type { CoreAdminDeps } from './coreCreate'
import { runOn } from './pmLaunch'
import { HerdrError } from './herdr'
import type { PmStore } from './pmStore'
import { archiveDays, archiveDue, archivedMatch, archivedText, doneAt } from '../../shared/pm/archive'

const planOf = (t: Template | null, task: Task, p?: Project) => (t ? taskPlan(t, task, p) : [])

async function templatesOf(store: PmStore) {
  const out = new Map<string, Template | null>()
  for (const p of await store.projects()) out.set(p.key, p ? await store.workflow(p.key) : null)
  return out
}

// What the mechanic last read of each task's PR (prNow), for the cards' status
// line. In memory: read again within a minute of a restart.
export const prSeen = new Map<string, string>()
const withPr = (c: Card): Card => (prSeen.has(c.id) ? { ...c, prNow: prSeen.get(c.id)! } : c)

const machinesOf = (p: Project, known: MachineInfo[]): BoardMachine[] | undefined => {
  const keys = allowedMachines(p)
  if (keys.length < 2) return undefined
  return keys.map((key) => {
    const m = known.find(x => x.key === key), unready = key === p.machine ? undefined : lastReadiness(p.key, key)
    return { key, label: m?.label ?? key, online: !!m && (m.local || m.status === 'online'), ...(unready !== undefined ? { unready } : {}) }
  })
}

// The cards of these tasks, as the board shows them.
async function cardsOf(store: PmStore, tasks: Task[], known: MachineInfo[]): Promise<Card[]> {
  const [projects, templates, runs] = [await store.projects(), await templatesOf(store), await store.runs()]
  return tasks.map((task) => {
    const p = projects.find(x => x.key === task.project)
    // A project with several machines: the card names the one its task went to.
    const on = task.machine !== undefined && p && allowedMachines(p).length > 1 ? known.find(m => m.key === task.machine)?.label ?? (task.machine || 'Local') : undefined
    return withPr({ ...shownTexts(projects, cardOf(task, planOf(templates.get(task.project) ?? null, task, p), runs)), shown: shownTaskId(projects, task.id), ...(p?.color ? { color: p.color } : {}), ...(on ? { machine: on } : {}), ...(task.sameFiles && task.state === 'todo' ? { sameFiles: shownTaskId(projects, task.sameFiles) } : {}) })
  })
}

// known: the machines wherdr knows, to name those a project allows.
// Archived tasks stay off it: only their count per project.
export async function board(store: PmStore, known: MachineInfo[] = []): Promise<Board> {
  const [projects, templates, all] = [await store.projects(), await templatesOf(store), boardOrder(await store.tasks())]
  const archived: Record<string, number> = {}
  for (const t of all) if (t.archived) archived[t.project] = (archived[t.project] ?? 0) + 1
  return {
    projects: projects.map((p) => {
      const t = templates.get(p.key), machines = machinesOf(p, known)
      const plans = t ? Object.keys(t.taskTypes).map(type => ({ id: type, steps: planSteps(t, { type }, p.base) })) : []
      return { key: p.key, ...(p.base ? { base: p.base } : {}), ...(p.label ? { label: p.label } : {}), ...(p.aliases ? { aliases: p.aliases } : {}), ...(p.color ? { color: p.color } : {}), name: p.name, columns: boardColumns(plans.map(x => x.steps)), types: plans.map(x => ({ id: x.id, plan: x.steps.map(s => s.id).join(' → '), weight: weightText(weightOf(t, { type: x.id })) })), ...(machines ? { machines } : {}) }
    }),
    // Done ones last, newest done first; the others in board order.
    cards: await cardsOf(store, [...all.filter(t => !t.step?.done), ...all.filter(t => t.step?.done && !t.archived).sort((a, b) => doneAt(b) - doneAt(a))], known),
    archived,
  }
}

// GET /api/pm/archived: the archived tasks of these projects (all when none
// named), newest archived first, matching the search, a page at a time.
export const ARCHIVED_PAGE = 30
export async function archivedCards(store: PmStore, known: MachineInfo[], q: { projects?: string[], search?: string, offset?: number }) {
  const projects = await store.projects()
  const tasks = (await store.tasks()).filter(t => t.archived && (!q.projects?.length || q.projects.includes(t.project)))
    .sort((a, b) => b.archived! - a.archived!)
  const found = (await cardsOf(store, tasks, known)).filter(c => archivedMatch({ ...c, shown: shownTaskId(projects, c.id) }, q.search ?? ''))
  const at = Math.max(0, Math.floor(q.offset ?? 0))
  return { cards: found.slice(at, at + ARCHIVED_PAGE), total: found.length }
}

// One task's card by any key it had, archived or not: a link, a notification or
// a chat's task card opens an archived task, which the board leaves out. null: unknown.
export async function cardById(store: PmStore, known: MachineInfo[], id: unknown) {
  const task = await store.task(id)
  return { card: task ? (await cardsOf(store, [task], known))[0]! : null }
}

// Brings an archived task back to Done; its delay runs again from now.
export async function unarchiveTask(store: PmStore, id: unknown) {
  const task = await store.task(id)
  if (!task) throw new HerdrError('not_found', 'Unknown task')
  if (!task.archived) throw new HerdrError('refused', `${task.id} is not archived`)
  return store.logTask({ ...task, archived: undefined, unarchived: Date.now() }, 'user', 'unarchived: back in Done')
}

// The engine's pass: archives each done task past its project's delay, once at
// start (older done tasks too) then with the other periodic sweeps.
export async function archiveDone(store: Pick<PmStore, 'projects' | 'tasks' | 'logTask'>, now = Date.now()) {
  const projects = await store.projects()
  for (const t of await store.tasks()) {
    const days = archiveDays(projects.find(p => p.key === t.project))
    if (archiveDue(t, days, now)) await store.logTask({ ...t, archived: now }, 'engine', archivedText(days))
  }
}

// The running agents of tasks, by herdr-core address: their task and role (sidebar rows).
export async function boardAgents(store: PmStore): Promise<Record<string, TaskAgent>> {
  if (!await store.enabled()) return {}
  const [projects, templates, tasks, runs] = [await store.projects(), await templatesOf(store), await store.tasks(), await store.runs()]
  return taskAgents(tasks, runs, t => planOf(templates.get(t.project) ?? null, t, projects.find(p => p.key === t.project)), id => shownTaskId(projects, id))
}

// The step's userLabel button: the same 'user' event as "it is merged" said
// by the user. A step with an action (git.verify-merged) runs it at once,
// started by the user, and its result moves the task on or back to Your turn.
export const userStep = (deps: CoreAdminDeps & { store: PmStore }, id: unknown) => stepAction(deps, id, 'user')

// by 'engine': a failed action tried again, or one entered and not run yet
// (a merge the branch rule gives the engine); its guard is checked again.
// Tasks whose engine action runs now: one at a time (the user's gesture, the engine's pass).
const running = new Set<string>()
export async function stepAction(deps: CoreAdminDeps & { store: PmStore }, id: unknown, by: MergeBy): Promise<Task> {
  const { store } = deps
  const task = await store.task(id)
  if (!task) throw new HerdrError('not_found', 'Unknown task')
  if (task.stopped) throw new HerdrError('refused', 'The task is stopped: continue it first')
  // A reported problem that blocks the merge: no step action, the engine's neither.
  if (task.report?.block) { if (by === 'user') throw new HerdrError('refused', 'A problem you reported blocks the merge: withdraw it, or wait for the coordinator'); return task }
  if (running.has(task.id)) throw new HerdrError('busy', 'Already checking')
  running.add(task.id)
  try { return await stepActionOf(deps, task, by) } finally { running.delete(task.id) }
}

async function stepActionOf(deps: CoreAdminDeps & { store: PmStore }, task: Task, by: MergeBy): Promise<Task> {
  const { store } = deps
  const p = (await store.projects()).find(x => x.key === task.project)
  const t = p ? await store.workflow(p.key) : null
  if (!p || !t) throw new HerdrError('not_found', 'The project has no template')
  const plan = planOf(t, task, p)
  const cur = task.step ?? initialState()
  const step = plan[cur.at]
  const r = by === 'engine' && cur.acting && step?.action
    ? { state: cur, effects: [{ kind: 'action' as const, step: step.id, action: step.action, attempt: cur.tries?.[step.id] ?? 1 }] }
    : onEvent(plan, cur, by === 'engine' ? { kind: 'user', engine: true } : { kind: 'user' }, Date.now())
  if ('refused' in r && r.refused) throw new HerdrError('refused', r.refused)
  let state = r.state
  if (state.approved && !cur.approved) task = await store.logTask({ ...task, step: state }, 'user', `approved the merge${state.approved.commit ? ` at ${state.approved.commit.slice(0, 7)}` : ''}: it merges by itself once the PR is ready`)
  // An approved merge the engine carries out stays the user's: their guard applies.
  const approved = !!state.approved && waitsToMerge(step)
  const act = r.effects.find(e => e.kind === 'action')
  // The base a merge went to, kept on the task: a done task is no longer read by the mechanic.
  let mergedInto: string | undefined
  const fresh = async () => {
    const t = await store.task(task.id) ?? task
    return mergedInto && t.prBase?.base !== mergedInto ? { ...t, prBase: { base: mergedInto } } : t
  }
  if (act?.kind === 'action') {
    await store.saveTask({ ...task, step: state }) // checking, before the action runs
    const run = await workerRun(store, task.id)
    const result: ActionResult = run
      ? await runAction({ store, sh: actionShell(deps, runOn(deps, run)) }, {
          task, shown: shownTaskId(p ? [p] : [], task.id), step: act.step, attempt: act.attempt, action: act.action, by: approved ? 'user' : by, guards: taskGuards(t, task.type), worktree: run.worktree, branch: run.branch,
          reviewed: reviewedCommit(plan, state), ...(approved && state.approved!.commit ? { approved: state.approved!.commit } : {}),
          halted: async () => !!(await store.task(task.id))?.stopped,
        }).catch((e: Error) => ({ ok: false, error: e.message }))
      : { ok: false, error: 'No worktree: the task never started' }
    const evidence = { ...(result.link ? { link: result.link } : {}), ...(result.commit ? { commit: result.commit } : {}), ...(result.report ? { report: result.report } : {}) }
    const catchUp = result.catchUp && result.commit ? { catchUp: { base: result.catchUp, head: result.commit } } : {}
    const back = onEvent(plan, state, { kind: 'action-result', ok: result.ok, ...(result.later ? { later: true } : {}), ...(result.detail ? { detail: result.detail } : {}), ...(result.error ? { error: result.error } : {}), ...(result.review ? { review: result.review } : {}), ...(result.unapproved ? { unapproved: true as const } : {}), ...catchUp, evidence }, Date.now())
    state = back.state
    mergedInto = result.ok ? result.base : undefined
    const log = back.effects.find(e => e.kind === 'log')
    if (log?.kind === 'log') return store.logTask({ ...(await fresh()), step: state }, 'engine', log.text)
    const auto = result.ok && approved && by === 'engine' ? 'merged by itself, as the user approved' : undefined
    const said = [auto, result.note, result.alert].filter(Boolean).join('. ')
    if (said) return store.logTask({ ...(await fresh()), step: state }, 'engine', `${act.step}: ${said}`)
  }
  return store.saveTask({ ...(await fresh()), step: state })
}

const workerRun = async (store: PmStore, id: string) =>
  (await store.runs()).filter(x => x.task === id && x.role === 'worker').sort((a, b) => b.startedAt - a.startedAt)[0]

// The commit the task's worktree is at, on its machine; undefined when unknown.
export async function worktreeHead(deps: CoreAdminDeps, store: PmStore, task: Task) {
  const run = await workerRun(store, task.id)
  if (!run) return
  const r = await actionShell(deps, runOn(deps, run))('git -C "$1" rev-parse HEAD', [run.worktree]).catch(() => undefined)
  const head = r?.code === 0 ? r.out.trim().split('\n')[0] : ''
  return /^[0-9a-f]{40,64}$/.test(head ?? '') ? head : undefined
}

// After a restart: a merge step still marked running was cut by it. The engine
// runs it again, and runAction asks GitHub where its PR stands first.
export async function resumeMerges(deps: CoreAdminDeps & { store: PmStore }) {
  const projects = await deps.store.projects()
  for (const task of await deps.store.tasks()) {
    if (!task.step?.acting || task.step.done || task.stopped) continue
    const p = projects.find(x => x.key === task.project)
    const step = planOf(p ? await deps.store.workflow(p.key) : null, task, p)[task.step.at]
    if (step?.action?.kind === 'github.merge') await stepAction(deps, task.id, 'engine').catch(() => {})
  }
}

// The user's choice on a review the after-N rule handed to them (Decisions):
// any choice, like the coordinator's `task decide` but not limited to its options.
export async function userDecide(store: PmStore, id: unknown, choice: unknown) {
  if (!CHOICES.includes(choice as Choice)) throw new HerdrError('bad_input', `choice: one of ${CHOICES.join(', ')}`)
  return userEvent(store, id, { kind: 'decide', by: 'user', choice: choice as Choice })
}

// The user sends their step (a visual merge) back to the worker, saying what to change.
export async function userSendBack(store: PmStore, id: unknown, note: unknown) {
  if (typeof note !== 'string' || note.length > 2000) throw new HerdrError('bad_input', 'note: what to change, 2000 characters at most')
  return userEvent(store, id, { kind: 'back', note })
}

export async function userEvent(store: PmStore, id: unknown, ev: StepEvent, by = 'user') {
  const task = await store.task(id)
  if (!task) throw new HerdrError('not_found', 'Unknown task')
  const p = (await store.projects()).find(x => x.key === task.project)
  const t = p ? await store.workflow(p.key) : null
  if (!t) throw new HerdrError('not_found', 'The project has no template')
  const r = onEvent(planOf(t, task, p), task.step ?? initialState(), ev, Date.now())
  if (r.refused) throw new HerdrError('refused', r.refused)
  // The step sent back answers a reported problem.
  return store.logTask({ ...task, step: r.state, ...(ev.kind === 'back' ? { report: undefined } : {}) }, by, r.effects.flatMap(e => (e.kind === 'log' ? [e.text] : [])).join('; '))
}

const sameKey = (a: string | undefined, b: unknown) =>
  !!a && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

// An agent's screenshot for its current step (POST /api/pm/shot), kept with
// the task's data. `token`: the task's key, written in the agent's instructions file.
// head: reads the task's commit, asked only on a step that takes no screenshots:
// new commits since the review let the worker replace its screenshots (addShot).
export async function uploadShot(store: PmStore, id: unknown, phase: unknown, data: Buffer, ctype: string, token: unknown, head?: (task: Task) => Promise<string | undefined>): Promise<Shot> {
  const task = await store.task(id)
  // An unknown task and a wrong key answer the same.
  if (!task || !sameKey(task.shotToken, token)) throw new HerdrError('forbidden', 'Unknown task or wrong screenshot key')
  const ext = SHOT_TYPES[ctype]
  if (!ext || !isImage(data, ext)) throw new HerdrError('bad_input', 'A PNG, JPEG or WebP image, matching its Content-Type')
  if (phase !== 'before' && phase !== 'after') throw new HerdrError('bad_input', 'phase: before or after')
  const p = (await store.projects()).find(x => x.key === task.project)
  const plan = planOf(p ? await store.workflow(p.key) : null, task, p)
  const open = task.step && plan[task.step.at]
  const now = open && !needsShots(open) && head ? await head(task) : undefined
  const shot: Shot = { file: `${randomUUID().replace(/-/g, '').slice(0, 12)}.${ext}`, phase, at: Date.now() }
  let kept = shot
  await store.addShot(task.id, shot.file, data, (fresh) => {
    const r = addShot(plan, fresh.step, shot, fresh.step && reworkSince(plan, fresh.step, now))
    if ('refused' in r) throw new HerdrError('refused', r.refused)
    kept = Object.values(r.state.shots ?? {}).flat().find(s => s.file === shot.file) ?? shot
    const dropped = fresh.step?.approved ? [{ at: shot.at, by: 'engine', text: 'approval dropped: new screenshots, the user looks again before the merge' }] : []
    return { ...fresh, step: r.state, ...(dropped.length ? { log: [...(fresh.log ?? []), ...dropped] } : {}) }
  })
  return kept
}
