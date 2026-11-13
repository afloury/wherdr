// `wherdr pm feature split <WS-n>` (shared/pm/feature.ts): the plan checked
// whole first, the repositories it needs adopted, its sub-tasks added in one
// store write (store.splitFeature: all or none), then those that wait for
// nothing started.
import { parsePlan } from '../../shared/pm/feature'
import { isWorkspace, membersOf, repoPath } from '../../shared/pm/workspace'
import type { Project } from '../../shared/pm/project'
import type { Task } from '../../shared/pm/run'
import type { CoreAdminDeps } from './coreCreate'
import { HerdrError } from './herdr'
import { adoptRepo } from './pmAdopt'
import type { PmStore } from './pmStore'

type Deps = CoreAdminDeps & { store: PmStore }

export async function splitFeature(deps: Deps, ws: Project | undefined, feature: Task, input: unknown, { by, origin }: { by: string, origin: 'user' | 'coordinator' }, start: (t: Task) => Promise<unknown>) {
  if (!ws || !isWorkspace(ws) || feature.kind !== 'feature') throw new HerdrError('bad_input', `${feature.id} is not a workspace's feature`)
  let raw: unknown
  try { raw = JSON.parse(String(input ?? '')) } catch { throw new HerdrError('bad_input', 'The plan is not valid JSON (on stdin)') }
  const plan = parsePlan(raw)
  if ('error' in plan) throw new HerdrError('bad_input', plan.error)
  const { store } = deps
  const memberOf = (list: Project[], repo: string) => membersOf(ws.key, list).find(m => m.key === repo || repoPath(m, ws) === repo)
  // Every task type checked before anything changes: a new member runs the workspace's workflow.
  let list = await store.projects()
  for (const t of plan.tasks) {
    const types = (await store.workflow(memberOf(list, t.repo)?.key ?? ws.key))?.taskTypes
    if (types && !Object.hasOwn(types, t.type)) throw new HerdrError('bad_input', `${t.repo}: no task type "${t.type}": ${Object.keys(types).join(', ')}`)
  }
  const adopted: string[] = []
  for (const t of plan.tasks.filter(x => !memberOf(list, x.repo))) {
    adopted.push((await adoptRepo(deps, ws, list, { name: 'repo adopt', repo: t.repo }, by)).adopted.key)
    list = await store.projects()
  }
  const index = (repo: string) => plan.tasks.findIndex(t => t.repo === repo)
  const { feature: split, tasks } = await store.splitFeature(feature.id, plan.tasks.map(t => ({
    project: memberOf(list, t.repo)!.key, title: t.title, type: t.type, description: t.description, files: t.files, origin, addedBy: ws.key,
    after: t.after.filter(a => index(a) < 0).join(','), afterIndex: t.after.map(index).filter(i => i >= 0),
  })), plan.order, by)
  // A start that fails leaves its sub-task to do, as task start would: the split stays.
  const started: string[] = [], notStarted: Record<string, string> = {}
  for (const t of tasks.filter(x => !x.after)) await start(t).then(() => started.push(t.id), (e: Error) => { notStarted[t.id] = e.message })
  return { feature: split, tasks: tasks.map(t => ({ id: t.id, project: t.project, title: t.title, ...(t.after ? { after: t.after } : {}) })), ...(adopted.length ? { adopted } : {}), started, ...(Object.keys(notStarted).length ? { notStarted } : {}) }
}
