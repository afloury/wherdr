// herdr-projects 1.x on every machine: its tasks (GET /api/tasks), one task's
// details, and what the Board can do on a task (tell, approve, open its pane).
//
// One board per machine: herdr-projects keeps it in the machine's HOME
// (~/.herdr-projects), so the named sessions of a machine share it. Its cache,
// its queue and its card list are the base machine's.
//
// How a board is read:
//  - on the host (wherdr installed natively, or any SSH machine): the plugin's
//    own CLI, run by its launcher (`sh <plugin_root>/bin/run.sh …`), in the
//    machine's own Herdr session. Each command also runs the board's upkeep, as
//    any 1.x command does on that machine; wherdr calls it sparingly: one
//    command at a time per machine, a list reused for REUSE_MS, the last list
//    kept (marked stale) when a read outlives READ_DEADLINE_MS.
//  - wherdr in a container, for its own machine: the board's files, read only.
//    The CLI would run the upkeep in the container (repositories read-only,
//    no gh, another environment) with write access to the shared board, so it
//    is never run there, and the actions are left to the host.
// Only where Herdr reports a 1.x from 1.2.1 on (shared/projectsPlugin.ts).
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { joinId } from '../../shared/ids'
import {
  type MachineTasks, type TaskDetails, type TaskRow, type TasksBoard,
  cleanTell, detailsFromTaskFile, isTaskId, parseTaskDetails, parseTaskList, rowFromTaskFile, taskActions,
} from '../../shared/projectsTasks'
import { HERDR_BIN, HERDR_CHILD_ENV, IN_DOCKER, log } from './env'
import { HerdrError } from './herdr'
import { type Machine, allMachines, baseMachines } from './machines'
import { machineFor } from './actions'
import { projectsPluginInfo } from './projectsPlugin'
import { findPane, getState } from './state'
import { fmt } from '../../shared/message'

export const REUSE_MS = 5000
export const READ_DEADLINE_MS = 4000
const LIST_TIMEOUT_MS = 30_000
const ACTION_TIMEOUT_MS = 60_000
const OUTPUT_MAX = 8 * 1024 * 1024
// Rows shown per machine, the newest first; task files read to find them
// (archived ones included, left out after reading).
const FILES_MAX = 500
const FILES_READ_MAX = 3000

export interface RunResult { code: number, stdout: string, stderr: string }
export type Runner = (m: Machine, launcher: string, args: string[], timeoutMs: number) => Promise<RunResult>

// On an SSH machine: its own Herdr session, by name, as herdr-projects finds it
// there (never the socket wherdr forwards here). `$1` herdr binary, `$2` session
// ('' or 'default': the default one), then the command.
export const REMOTE_TASKS_SCRIPT = 'export HERDR_BIN_PATH="$1"; unset HERDR_SOCKET_PATH; '
  + 'if [ -n "$2" ] && [ "$2" != default ]; then export HERDR_SESSION="$2"; else unset HERDR_SESSION; fi; shift 2; exec "$@"'

// The plugin's launcher with argv only: no shell on this machine, and
// positional parameters of a fixed script on a remote one.
const runLauncher: Runner = async (m, launcher, args, timeoutMs) => {
  if (m.exec) {
    const herdrBin = 'bin' in m && typeof (m as { bin?: unknown }).bin === 'string' ? (m as { bin: string }).bin : 'herdr'
    // Bounded while it arrives (the SSH runner stops the command past it).
    const r = await m.exec(REMOTE_TASKS_SCRIPT, [herdrBin, m.session || '', 'sh', launcher, ...args], { timeoutMs, maxBytes: OUTPUT_MAX })
    return { code: r.code ?? 1, stdout: r.stdout.toString('utf8'), stderr: r.stderr.trim() }
  }
  const sock = m.sock()
  return new Promise(resolve => execFile('sh', [launcher, ...args], {
    cwd: m.home,
    env: { ...HERDR_CHILD_ENV, HERDR_BIN_PATH: HERDR_BIN, NO_COLOR: '1', ...(sock ? { HERDR_SOCKET_PATH: sock } : {}) },
    timeout: timeoutMs, maxBuffer: OUTPUT_MAX,
  }, (err, stdout, stderr) => resolve({
    code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
    stdout: String(stdout),
    stderr: String(stderr || (err ? (err.killed ? `herdr-projects did not answer within ${Math.round(timeoutMs / 1000)} s` : err.message) : '')).trim(),
  })))
}
let runner: Runner = runLauncher
// Tests replace the launcher with recorded output.
export function setRunner(r: Runner | null) { runner = r || runLauncher }
// wherdr in a container (Docker, or Podman's /run/.containerenv), or told to
// read the boards from their files (WHERDR_TASKS_FROM_FILES=1). Tests set it.
const CONTAINER = IN_DOCKER || existsSync('/run/.containerenv') || process.env.WHERDR_TASKS_FROM_FILES === '1'
let inContainer = CONTAINER
export function setInContainer(v: boolean | null) { inContainer = v ?? CONTAINER }

// The board of this machine is read from its files: wherdr's own machine, from a container.
export const readsFiles = (m: Machine) => m.local && inContainer

// The base machine of a machine or a named session: the board's owner.
export function boardMachine(m: Machine): Machine {
  const key = m.info().baseKey
  return (key !== undefined && baseMachines().find(b => b.key === key)) || m
}

// One command at a time per machine.
const queues = new Map<string, Promise<unknown>>()
function serial<T>(key: string, job: () => Promise<T>): Promise<T> {
  const before = queues.get(key) || Promise.resolve()
  const next = before.catch(() => {}).then(job)
  queues.set(key, next)
  next.finally(() => { if (queues.get(key) === next) queues.delete(key) }).catch(() => {})
  return next
}

const firstLine = (s: string) => s.split('\n').map(l => l.trim()).find(Boolean)?.slice(0, 300) || ''

async function launcherOf(m: Machine): Promise<string> {
  const info = await projectsPluginInfo(m)
  if (info.status !== 'ready' || !info.launcher) throw new HerdrError('projects_unavailable', fmt('herdr-projects 1.2.1 or later is not available on {machine}', { machine: m.label }))
  return info.launcher
}

async function command(m: Machine, args: string[], timeoutMs = ACTION_TIMEOUT_MS): Promise<string> {
  if (readsFiles(m)) throw new HerdrError('projects_host_only', 'wherdr runs in a container: run herdr-projects on the host for this')
  const launcher = await launcherOf(m)
  const r = await serial(m.key, () => runner(m, launcher, args, timeoutMs))
  if (r.code !== 0) throw new HerdrError('projects_failed', firstLine(r.stderr) || firstLine(r.stdout) || `herdr-projects ${args[0]}: code ${r.code}`)
  return r.stdout
}

// ---------------------------------------------------------------- the board's files
const tasksRoot = (m: Machine) => path.posix.join(m.home, '.herdr-projects/data/tasks')

const missing = (e: unknown) => (e as { code?: unknown })?.code === 'ENOENT'

// A task's file. null: no such file (a task being made, or cleared). Anything
// else that keeps it from being read (rights, disk, broken JSON) is an error.
async function readTaskFile(m: Machine, id: string): Promise<Record<string, unknown> | null> {
  const [repo, n] = id.split('/') as [string, string]
  let text: string
  try { text = await m.fs.readFile(path.posix.join(tasksRoot(m), repo, n, 'task.json')) }
  catch (e) { if (missing(e)) return null; throw e }
  const t: unknown = JSON.parse(text)
  if (!t || typeof t !== 'object' || Array.isArray(t)) throw new Error('not a task')
  return t as Record<string, unknown>
}

// The machine key of the session a task's agent runs in (its link.socket):
// `…/sessions/<name>/herdr.sock`, or the default session's socket. null: a
// session wherdr has not opened. Never another session's key: a pane id
// (w1:p1) means another agent there.
export function sessionMachine(base: Machine, socket: unknown): string | null {
  // No socket named: the board's own session, as herdr-projects reads it (flow/live.rs).
  if (typeof socket !== 'string' || !socket) return base.key
  const parts = typeof socket === 'string' ? socket.split('/') : []
  const n = parts.length
  const name = n >= 3 && parts[n - 1] === 'herdr.sock' && parts[n - 3] === 'sessions' ? parts[n - 2]! : 'default'
  if (name === (base.session || 'default')) return base.key
  return allMachines().find(m => m.info().baseKey === base.key && m.session === name)?.key ?? null
}

// The task's agent pane as its file links it, in the session it names. `known`:
// that session is open in wherdr (false: no pane can be named for it).
function linkedPane(base: Machine, t: Record<string, unknown> | null): { pane: string | null, known: boolean } {
  const link = t && typeof t.link === 'object' && t.link ? t.link as Record<string, unknown> : null
  if (!link || typeof link.pane !== 'string' || !/^w[0-9a-z]+:p[0-9a-z]+$/i.test(link.pane)) return { pane: null, known: true }
  const key = sessionMachine(base, link.socket)
  return key === null ? { pane: null, known: false } : { pane: joinId(key, link.pane), known: true }
}

// Every task's row. Only a board not made yet (no tasks folder) reads as empty;
// a folder or file that cannot be read fails the read, or, for some tasks only,
// is named in `failed` (a partial read).
async function listFromFiles(m: Machine): Promise<{ tasks: TaskRow[], failed: string[] }> {
  const root = tasksRoot(m)
  let repos: string[]
  try { repos = await m.fs.readdir(root) }
  catch (e) { if (missing(e)) return { tasks: [], failed: [] }; throw e }
  const ids: string[] = []
  const failed: string[] = []
  for (const repo of repos) {
    let ns: string[]
    try { ns = await m.fs.readdir(path.posix.join(root, repo)) }
    catch (e) { if (!missing(e)) failed.push(`${repo} (${(e as Error).message})`); continue }
    for (const n of ns) if (isTaskId(`${repo}/${n}`)) ids.push(`${repo}/${n}`)
  }
  // Newest first, so the caps keep the latest tasks rather than readdir's order.
  ids.sort((a, b) => Number(b.split('/')[1]) - Number(a.split('/')[1]) || a.localeCompare(b))
  const panes = getState().panes
  const rows = await Promise.all(ids.slice(0, FILES_READ_MAX).map(async (id) => {
    let t: Record<string, unknown> | null
    try { t = await readTaskFile(m, id) }
    catch (e) { failed.push(`${id} (${(e as Error).message})`); return null }
    const { pane } = linkedPane(m, t)
    return t ? rowFromTaskFile(t, pane ? panes.find(p => p.id === pane)?.status ?? null : null) : null
  }))
  return { tasks: rows.filter((r): r is TaskRow => r !== null && !r.archived).slice(0, FILES_MAX), failed }
}

// ---------------------------------------------------------------- the list
// `partial`: some tasks could not be read; those rows are marked stale one by one.
interface Cached { tasks: TaskRow[], at: number, readAt: number, error?: string, partial?: boolean }
const lists = new Map<string, Cached>()
const reading = new Map<string, Promise<Cached>>()

// `at`: when this answer was given; `readAt`: when its tasks were read (kept on an error).
function readList(m: Machine): Promise<Cached> {
  const now = reading.get(m.key)
  if (now) return now
  const read = (readsFiles(m) ? listFromFiles(m) : command(m, ['list', '--json'], LIST_TIMEOUT_MS).then(tasks => ({ tasks: parseTaskList(tasks), failed: [] as string[] })))
    .then(({ tasks, failed }): Cached => {
      if (!failed.length) return { tasks, at: Date.now(), readAt: Date.now() }
      // Some tasks could not be read: the others are fresh, those keep their last row, and it is said.
      const ids = new Set(tasks.map(t => t.id))
      const last = lists.get(m.key)
      const kept = (last?.tasks || [])
        .filter(t => !ids.has(t.id) && failed.some(f => f.startsWith(`${t.id} `) || f.startsWith(`${t.repo} `)))
        .map(t => ({ ...t, stale: true, readAt: t.readAt ?? last?.readAt }))
      return { tasks: [...tasks, ...kept], at: Date.now(), readAt: Date.now(), partial: true, error: fmt('Some tasks could not be read: {list}', { list: failed.slice(0, 3).join(', ') + (failed.length > 3 ? ` (+${failed.length - 3})` : '') }) }
    })
    .catch((e: Error) => {
      const last = lists.get(m.key)
      return { tasks: last?.tasks || [], at: Date.now(), readAt: last?.readAt ?? 0, error: e.message }
    })
    .then((c) => { lists.set(m.key, c); return c })
    .finally(() => reading.delete(m.key))
  reading.set(m.key, read)
  return read
}

// What a cached read says: its tasks, when they were read, and why they may be old.
function shown(c: Cached): Pick<MachineTasks, 'tasks' | 'at' | 'error' | 'stale'> {
  return { tasks: c.tasks, ...(c.readAt ? { at: c.readAt } : {}), ...(c.error ? { error: c.error, stale: !c.partial && c.tasks.length > 0 } : {}) }
}

// `fresh`: the Board just opened (or asked to): check the plugin again rather
// than trust the last answer, so an install or update shows at once.
async function machineTasks(m: Machine, fresh = false): Promise<MachineTasks | null> {
  const last = lists.get(m.key)
  if (!m.local && m.status !== 'online') {
    const error = fmt('{machine} is unreachable', { machine: m.label })
    return last ? { machine: m.key, status: 'ready', version: '', ...shown(last), error, stale: true } : null
  }
  let info
  try { info = await projectsPluginInfo(m, fresh) }
  catch (e) {
    // Herdr did not answer: say so, with the last tasks read there.
    return { machine: m.key, status: 'error', version: '', tasks: [], ...(last ? shown(last) : {}), error: (e as Error).message, ...(last?.tasks.length ? { stale: true } : {}) }
  }
  const base = { machine: m.key, status: info.status, version: info.version || '', ...(readsFiles(m) ? { readOnly: true } : {}) }
  if (info.status !== 'ready') return { ...base, tasks: [] }
  if (last && Date.now() - last.at < REUSE_MS) return { ...base, ...shown(last) }
  const deadline = new Promise<null>(resolve => setTimeout(() => resolve(null), READ_DEADLINE_MS).unref?.())
  const c = await Promise.race([readList(m), deadline])
  if (!c) return { ...base, tasks: last?.tasks || [], ...(last?.readAt ? { at: last.readAt } : {}), stale: true }
  return { ...base, ...shown(c) }
}

// Every machine's tasks. `since`: the version the client has; `{ same: true }` when nothing changed.
// Without it (the Board opening, or Refresh), each machine's plugin is checked afresh.
export async function readTasksBoard(since?: string): Promise<TasksBoard | { same: true, version: string }> {
  const machines = (await Promise.all(baseMachines().map(m => machineTasks(m, !since)))).filter((x): x is MachineTasks => x !== null)
  // What the Board shows, without when it was read: the same tasks read again are the same version.
  const version = createHash('sha1').update(JSON.stringify(machines, (k, v) => (k === 'at' || k === 'readAt' ? undefined : v))).digest('hex').slice(0, 16)
  return since === version ? { same: true, version } : { version, machines }
}

// ---------------------------------------------------------------- one task
// The board a request names: a machine key of the Board (a base machine); a
// named session's key reaches its machine's board.
const boardOf = (machine: unknown) => boardMachine(machineFor(machine))

function taskOf(m: Machine, id: string): TaskRow | null {
  return lists.get(m.key)?.tasks.find(t => t.id === id) || null
}

function checkId(id: unknown): string {
  if (!isTaskId(id)) throw new HerdrError('bad_task', 'Invalid task')
  return id
}

export async function taskDetails(machine: unknown, id: unknown): Promise<TaskDetails & { pane: string | null }> {
  const m = boardOf(machine)
  const tid = checkId(id)
  // From a container the file is the only source: an unreadable one is said.
  const file = readsFiles(m) ? await readTaskFile(m, tid) : await readTaskFile(m, tid).catch(() => null)
  let d: TaskDetails
  if (readsFiles(m)) {
    const fromFile = detailsFromTaskFile(file)
    if (!fromFile) throw new HerdrError('bad_task', 'Task not found')
    d = fromFile
  } else d = parseTaskDetails(await command(m, ['details', '--json', '--', tid], LIST_TIMEOUT_MS))
  return { ...d, pane: taskPane(m, file, d.worktree) }
}

// The task's agent pane in Herdr: the one the board linked it to (its task.json,
// read only, in the session it names), or else the pane working in its worktree.
function taskPane(m: Machine, file: Record<string, unknown> | null, worktree: string): string | null {
  const linked = linkedPane(m, file)
  // Linked to a session wherdr has not opened: no pane to offer, not one of another session.
  if (!linked.known) return null
  if (linked.pane && findPane(linked.pane)) return linked.pane
  if (!worktree) return null
  const keys = new Set(allMachines().filter(x => boardMachine(x).key === m.key).map(x => x.key))
  const hit = getState().panes.find(p => keys.has(p.machine || '') && p.agent && (p.cwd || '').replace(/\/+$/, '') === worktree.replace(/\/+$/, ''))
  return hit ? hit.id : null
}

function forget(m: Machine) { lists.delete(m.key) }
// Tests start from an empty cache.
export function resetTasksCache() { lists.clear(); reading.clear(); queues.clear() }

export async function tellTask(machine: unknown, id: unknown, text: unknown): Promise<{ ok: true, msg: string }> {
  const m = boardOf(machine)
  const tid = checkId(id)
  const words = cleanTell(text)
  if (!words) throw new HerdrError('empty', 'Nothing to send')
  const row = taskOf(m, tid)
  if (row && !taskActions(row).tell) throw new HerdrError('bad_action', 'This task has no agent to talk to')
  const out = await command(m, ['tell', '--', tid, words])
  forget(m)
  log(`herdr-projects tell ${tid}${m.local ? '' : ` on ${m.label}`}`)
  return { ok: true, msg: firstLine(out) }
}

export async function approveTask(machine: unknown, id: unknown): Promise<{ ok: true, msg: string }> {
  const m = boardOf(machine)
  const tid = checkId(id)
  const row = taskOf(m, tid)
  if (!row || !taskActions(row).approve) throw new HerdrError('bad_action', 'This task does not wait for approval')
  const out = await command(m, ['approve', '--', tid])
  forget(m)
  log(`herdr-projects approve ${tid}${m.local ? '' : ` on ${m.label}`}`)
  return { ok: true, msg: firstLine(out) }
}

// A message to the machine's Coordinator (the agent behind the board's box):
// it turns it into tasks. Started by herdr-projects when it is not running, in
// the machine's own session.
export async function tellCoordinator(machine: unknown, text: unknown): Promise<{ ok: true, msg: string }> {
  const m = boardOf(machine)
  const words = cleanTell(text)
  if (!words) throw new HerdrError('empty', 'Nothing to send')
  const out = await command(m, ['coordinator', '--', 'tell', words])
  forget(m)
  log(`herdr-projects coordinator tell${m.local ? '' : ` on ${m.label}`}`)
  return { ok: true, msg: firstLine(out) }
}
