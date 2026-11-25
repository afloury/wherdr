// The files a task names (its step, its report) opened in the Files view
// without its agent running: looked for in its worktree, then in its task
// folder (taskPaths, shared/pm/run.ts), on the task's machine.
// A path as written is relative to a root, or absolute and inside one; never
// `..`, never `~`. Existence is checked on the machine (symlinks resolved,
// protected files refused: files.ts), so only a regular file is ever offered.
import path from 'node:path'
import { insideRoot } from '../../shared/filePaths'
import { taskMachine } from '../../shared/pm/project'
import { taskPaths } from '../../shared/pm/run'
import { cleanRelative, existsIn, findByName } from './files'
import { log } from './env'
import { HerdrError } from './herdr'
import { coreFilesMachine } from './coreFilesMachine'
import type { Machine } from './machines'
import { pmDir } from './pmHome'
import { pmStore } from './pmStore'

export type TaskRoot = 'worktree' | 'task'
// The order a path is looked for in.
export const TASK_ROOTS: TaskRoot[] = ['worktree', 'task']
export const MAX_TASK_PATHS = 200
const MAX_PATH = 1024

export const isTaskRoot = (v: unknown): v is TaskRoot => v === 'worktree' || v === 'task'

// Where each root is on a machine of home `home`.
export function taskRoots(home: string, id: string, pm = pmDir()): Record<TaskRoot, string> {
  const p = taskPaths(home, id, undefined, pm)
  return { worktree: p.worktree, task: path.posix.dirname(p.instructions) }
}

// The (root, path under it) a written path may name, in lookup order: a
// relative path under each root, an absolute one under the root it is inside.
// None for a path outside both, with `..` or `~`, or empty.
export function taskCandidates(written: unknown, roots: Record<TaskRoot, string>): { root: TaskRoot, rel: string }[] {
  const w = typeof written === 'string' ? written.trim().replace(/\\/g, '/') : ''
  if (!w || w.length > MAX_PATH || w.includes('\0') || w.startsWith('~')) return []
  if (w.split('/').includes('..')) return []
  if (w.startsWith('/')) {
    const abs = path.posix.normalize(w).replace(/\/+$/, '')
    const root = TASK_ROOTS.find(r => abs !== roots[r] && insideRoot(roots[r], abs))
    return root ? [{ root, rel: abs.slice(roots[root].length + 1) }] : []
  }
  try {
    const rel = cleanRelative(w)
    return rel ? TASK_ROOTS.map(root => ({ root, rel })) : []
  } catch { return [] }
}

// Each written path with the first root it exists in as a regular file.
export async function findTaskFiles(m: Machine, id: string, paths: unknown[]): Promise<Record<string, { root: TaskRoot, rel: string }>> {
  const roots = taskRoots(m.home, id)
  const written = [...new Set(paths.filter((p): p is string => typeof p === 'string'))].slice(0, MAX_TASK_PATHS)
  const checks = written.flatMap(w => taskCandidates(w, roots).map(c => ({ w, ...c, abs: roots[c.root] })))
  const there = await existsIn(m, checks.map(c => ({ root: c.abs, rel: c.rel })))
  const found: Record<string, { root: TaskRoot, rel: string }> = {}
  checks.forEach((c, i) => { if (there[i] && !found[c.w]) found[c.w] = { root: c.root, rel: c.rel } })
  // A bare name (`catalogue.md`) the roots' tops do not have is looked for below them: a worker
  // writes it in a folder of the repository (`harvey-library/catalogue.md`), the step names it short.
  const bare = written.filter(w => !found[w] && !w.includes('/') && taskCandidates(w, roots).length)
  for (const root of TASK_ROOTS) {
    const todo = bare.filter(w => !found[w])
    if (!todo.length) break
    const rels = await findByName(m, roots[root], todo)
    const hits = todo.flatMap((w, i) => (rels[i] ? [{ w, rel: rels[i]! }] : []))
    const there = await existsIn(m, hits.map(h => ({ root: roots[root], rel: h.rel })))
    hits.forEach((h, i) => { if (there[i]) found[h.w] = { root, rel: h.rel } })
  }
  return found
}

interface Deps { store?: Pick<ReturnType<typeof pmStore>, 'task' | 'projects'>, machine?: (key: string) => Promise<Machine> }

// The machine of a task and one of its roots on it.
export async function taskSource(id: unknown, inRoot: unknown, deps: Deps = {}): Promise<{ m: Machine, root: string, id: string }> {
  const store = deps.store ?? pmStore()
  const task = await store.task(id)
  if (!task) throw new HerdrError('not_found', 'Unknown task')
  const p = (await store.projects()).find(x => x.key === task.project)
  if (!p) throw new HerdrError('not_found', 'Unknown project')
  const placed = taskMachine(task, p)
  if ('refused' in placed) throw new HerdrError('refused', placed.refused)
  if (!isTaskRoot(inRoot)) throw new HerdrError('bad_root', 'Unknown folder of the task')
  const m = await (deps.machine ?? coreFilesMachine)(placed.machine)
  return { m, root: taskRoots(m.home, task.id)[inRoot], id: task.id }
}

// `task=<id>&in=worktree|task` on /api/files/read and /download: given, the
// file is one of that task's.
export const taskQuery = (q: Record<string, unknown>) => (q.task === undefined ? undefined : taskSource(q.task, q.in))

interface OpenDeps extends Deps { open?: (file: string) => Promise<boolean> }

// A file of a task in the default application of this computer, as a double-click:
// only from a browser on it, for a task on it, a regular file found in the task's
// worktree or folder (the same checks as findTaskFiles). `refused` otherwise: the
// browser then offers the file as a download.
export async function openTaskFile(body: { task?: unknown, root?: unknown, rel?: unknown }, sameMachine: boolean, deps: OpenDeps = {}): Promise<{ ok: true }> {
  if (!sameMachine) throw new HerdrError('not_local', 'This works from a browser on the task’s computer only')
  const { m, root, id } = await taskSource(body.task, body.root, deps)
  if (!m.local) throw new HerdrError('not_local', 'This works for a task on this computer only')
  const rel = typeof body.rel === 'string' ? cleanRelative(body.rel) : ''
  if (!rel || rel.length > MAX_PATH) throw new HerdrError('bad_path', 'Invalid file')
  if (!(await existsIn(m, [{ root, rel }]))[0]) throw new HerdrError('not_found', 'This file does not exist')
  const { openWithDefaultApp } = await import('./openFile')
  const ok = await (deps.open ?? openWithDefaultApp)(path.posix.join(root, rel))
  log(`open-task-file: ${id}: ${ok ? 'opened' : 'no application'}`)
  if (!ok) throw new HerdrError('open_failed', 'No application found to open this file')
  return { ok: true }
}
