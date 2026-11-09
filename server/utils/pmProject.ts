// A project's settings (the project sheet): what it holds, and its changes.
// Guards are changed by the user or by Alfred only: a project coordinator's
// token is refused, and a workflow save (the user's or a coordinator's
// proposal) may not touch them.
import { MAIN, sameGuards } from '../../shared/pm/coordinator'
import { projectPlace } from '../../shared/pm/places'
import { freedMerge } from '../../shared/pm/guardEffects'
import { allowedMachines, cleanProjectUpdate, type Project } from '../../shared/pm/project'
import { taskPlan } from '../../shared/pm/run'
import { PREF_KEYS, type Guards, type Prefs, type Template } from '../../shared/pm/workflow'
import { HerdrError } from './herdr'
import { alfredTokenOk, scopeOf } from './pmCoordinator'
import type { CoreAdminDeps } from './coreCreate'
import { stepAction } from './pmBoard'
import { lastReadiness } from './pmReady'
import type { PmStore } from './pmStore'

const bearer = (authorization: unknown) => String(authorization || '').replace(/^Bearer\s+/i, '')

// Who changes the guards: the user's session (no token), or Alfred with one
// of its tokens (`wherdr alfred`, or the main coordinator's `wherdr pm`).
// Any other token, a project coordinator's first, is refused.
export async function guardsAuthor(store: PmStore, authorization: unknown): Promise<'user' | 'Alfred'> {
  const token = bearer(authorization)
  if (!token) return 'user'
  const scope = await scopeOf(store, token)
  if (scope === MAIN || await alfredTokenOk(store, token)) return 'Alfred'
  if (scope) throw new HerdrError('forbidden', `A project coordinator never changes guards: the user does it in ${projectPlace(scope, 'guards', true)}`)
  throw new HerdrError('forbidden', 'Guards are changed by the user or by Alfred only')
}

async function workflowOf(store: PmStore, key: unknown) {
  const p = await store.project(key)
  if (!p) throw new HerdrError('not_found', 'Unknown project')
  const t = await store.workflow(p.key)
  if (!t) throw new HerdrError('not_found', 'The project has no workflow: start it from a template')
  return { p, t }
}

// GET /api/pm/project?key=: one load for the project sheet.
export async function projectView(store: PmStore, key: string) {
  const p = await store.project(key)
  if (!p) throw new HerdrError('not_found', 'Unknown project')
  const proposal = (await store.coordinator(p.key))?.proposal
  // ready: each other allowed machine's last readiness check ('' ready, its failures otherwise; none never checked).
  const ready = Object.fromEntries(allowedMachines(p).slice(1).flatMap(m => { const r = lastReadiness(p.key, m); return r === undefined ? [] : [[m, r]] }))
  return {
    project: p, workflow: await store.workflow(p.key), log: await store.workflowLog(p.key), ready,
    ...(proposal ? { proposal: { diff: proposal.diff, at: proposal.at, base: proposal.base, ...(proposal.said ? { said: proposal.said } : {}) } } : {}),
  }
}

// { name?, base?, prefs? }: prefs (worker and reviewer agents) live in the workflow.
export async function updateProject(store: PmStore, key: unknown, body: Record<string, unknown>) {
  const { update, errors } = cleanProjectUpdate(body)
  if (!update) throw new HerdrError('bad_input', errors.map(e => `${e.path}: ${e.message}`).join('; '))
  if (body.prefs !== undefined) {
    const { t } = await workflowOf(store, key)
    const raw = (body.prefs && typeof body.prefs === 'object' ? body.prefs : {}) as Record<string, unknown>
    // An empty value goes back to the default.
    const prefs = Object.fromEntries(PREF_KEYS.flatMap(k => (typeof raw[k] === 'string' && raw[k] ? [[k, raw[k]]] : []))) as Prefs
    const { prefs: _old, ...rest } = t
    await store.saveWorkflow(t.id.toUpperCase(), Object.keys(prefs).length ? { ...rest, prefs } : rest)
  }
  return { project: await store.updateProject(key, update) }
}

// The user's save of the workflow: everything but the guards.
export async function saveProjectWorkflow(store: PmStore, key: unknown, next: unknown) {
  const { p, t } = await workflowOf(store, key)
  if (!sameGuards(t, next as Template)) throw new HerdrError('refused', `Guards are saved in ${projectPlace(p.key, 'guards')}, not with the workflow`)
  return { workflow: await store.saveWorkflow(p.key, next, { by: 'user' }) }
}

// The project's own guards (each task type's stay in its workflow). With
// deps, the merges they now give the engine are tried again at once (retryFreedMerges).
export async function saveProjectGuards(store: PmStore, key: unknown, guards: unknown, by: 'user' | 'Alfred', deps?: CoreAdminDeps) {
  const { p, t } = await workflowOf(store, key)
  const { guards: _old, ...rest } = t
  const next = guards && typeof guards === 'object' && Object.keys(guards).length ? { ...rest, guards: guards as Guards } : rest
  const workflow = await store.saveWorkflow(p.key, next, { by })
  if (deps) void retryFreedMerges({ ...deps, store }, p, t, next).catch(() => {})
  return { workflow }
}

// Each task of the project waiting at a merge its old guards refused and the
// new ones give the engine: the log says why, then the engine runs the step
// again, as its minute tick would for a merge it may do.
export async function retryFreedMerges(deps: CoreAdminDeps & { store: PmStore }, p: Project, before: Template, after: Template) {
  for (const task of (await deps.store.tasks()).filter(x => x.project === p.key)) {
    const into = freedMerge(task, taskPlan(before, task, p), taskPlan(after, task, p))
    if (!into) continue
    await deps.store.logTask(task, 'engine', `guards changed: the engine may now merge into ${into}, so it tries the step again`)
    await stepAction(deps, task.id, 'engine').catch(() => {})
  }
}

// Save as template: a copy of the project's workflow joins the library under
// `id` (a taken id is refused). The project is untouched.
export async function templateFromProject(store: PmStore, key: unknown, id: unknown) {
  const { t } = await workflowOf(store, key)
  const { version: _version, ...copy } = t
  return { template: await store.saveTemplate({ ...copy, id }) }
}
