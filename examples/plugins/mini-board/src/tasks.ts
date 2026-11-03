// .wherdr/tasks.json of a project: read leniently (the coordinator, an agent, writes it
// too), written back in one stable shape. Pure functions: tested in tests/miniBoardTasks.test.ts.

export const STATUSES = ['todo', 'working', 'review', 'done', 'failed'] as const
export type TaskStatus = typeof STATUSES[number]
export interface Task {
  id: string
  title: string
  description: string
  status: TaskStatus
  terminal: string | null // the worker's hc terminal (t7, machine/t7)
  branch: string | null
  notes: string
}
export interface TaskFile { version: 1, maxWorkers: number, tasks: Task[] }

export const TASKS_PATH = '.wherdr/tasks.json'
export const DEFAULT_MAX_WORKERS = 2
const MAX_TASKS = 500
const str = (v: unknown, max: number) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').slice(0, max)
const optStr = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

export const emptyFile = (): TaskFile => ({ version: 1, maxWorkers: DEFAULT_MAX_WORKERS, tasks: [] })

/**
 * Parses the file's text. `null` (no file) gives an empty board. Invalid JSON or a wrong
 * shape gives `ok: false`: the board then refuses to write, so that it never replaces a
 * file it cannot read. Odd tasks are fixed or skipped, with a warning each.
 */
export function parseTasks(text: string | null): { ok: true, file: TaskFile, warnings: string[] } | { ok: false, error: string } {
  if (text === null || !text.trim()) return { ok: true, file: emptyFile(), warnings: [] }
  let raw: unknown
  try { raw = JSON.parse(text) } catch (e) { return { ok: false, error: `Invalid JSON: ${(e as Error).message}` } }
  // A bare array of tasks is accepted too.
  const obj = Array.isArray(raw) ? { tasks: raw } : raw
  if (!obj || typeof obj !== 'object' || !Array.isArray((obj as { tasks?: unknown }).tasks)) return { ok: false, error: 'Expected { "tasks": [...] }' }
  const o = obj as { maxWorkers?: unknown, tasks: unknown[] }
  const warnings: string[] = []
  const n = Number(o.maxWorkers)
  const maxWorkers = Number.isInteger(n) && n >= 1 && n <= 16 ? n : DEFAULT_MAX_WORKERS
  if (o.maxWorkers !== undefined && maxWorkers !== n) warnings.push(`maxWorkers ${JSON.stringify(o.maxWorkers)} ignored (1 to 16)`)
  const tasks: Task[] = []
  const seen = new Set<string>()
  for (const [i, t] of o.tasks.slice(0, MAX_TASKS).entries()) {
    if (!t || typeof t !== 'object') { warnings.push(`Task ${i + 1} skipped: not an object`); continue }
    const r = t as Record<string, unknown>
    const id = str(r.id, 40).trim()
    const title = str(r.title, 200).trim()
    if (!id || seen.has(id)) { warnings.push(`Task ${i + 1} skipped: ${id ? `duplicate id ${id}` : 'no id'}`); continue }
    seen.add(id)
    let status = str(r.status, 20).trim().toLowerCase() as TaskStatus
    if (!STATUSES.includes(status)) { warnings.push(`Task ${id}: unknown status ${JSON.stringify(r.status)}, read as todo`); status = 'todo' }
    tasks.push({
      id, title: title || id, description: str(r.description, 8000), status,
      terminal: optStr(r.terminal, 100), branch: optStr(r.branch, 200), notes: str(r.notes, 4000),
    })
  }
  if (o.tasks.length > MAX_TASKS) warnings.push(`Only the first ${MAX_TASKS} tasks are shown`)
  return { ok: true, file: { version: 1, maxWorkers, tasks }, warnings }
}

export const serializeTasks = (f: TaskFile) => JSON.stringify({ version: 1, maxWorkers: f.maxWorkers, tasks: f.tasks }, null, 2) + '\n'

/** The next free id: t1, t2… after the highest tN already used. */
export function nextId(tasks: Pick<Task, 'id'>[]): string {
  const max = tasks.reduce((m, t) => Math.max(m, /^t(\d+)$/.exec(t.id) ? Number(t.id.slice(1)) : 0), 0)
  return `t${max + 1}`
}

export function addTask(f: TaskFile, title: string, description = ''): TaskFile {
  const t = title.trim().slice(0, 200)
  if (!t) throw new Error('A task needs a title')
  return { ...f, tasks: [...f.tasks, { id: nextId(f.tasks), title: t, description: description.trim().slice(0, 8000), status: 'todo', terminal: null, branch: null, notes: '' }] }
}

/** Absolute path of the tasks file of a project folder. */
export const tasksPath = (folder: string) => `${folder.replace(/\/+$/, '')}/${TASKS_PATH}`
