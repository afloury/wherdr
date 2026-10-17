// herdr-projects 1.x on every machine: its tasks (GET /api/tasks), one task's
// details, and what the Board can do on a task (tell, approve, open its pane).
//
// Everything goes through the plugin's own CLI, run by its launcher
// (`sh <plugin_root>/bin/run.sh …`), only where Herdr reports a 1.x from
// 1.2.1 on (shared/projectsPlugin.ts). Each command also runs the board's
// own upkeep, so wherdr calls it sparingly:
//  - one command at a time per machine;
//  - a list read less than REUSE_MS ago is reused, and polls in between get it;
//  - a read slower than READ_DEADLINE_MS answers with the last list, marked stale.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { joinId } from '../../shared/ids'
import {
  type MachineTasks, type TaskDetails, type TaskRow, type TasksBoard,
  cleanTell, isTaskId, parseTaskDetails, parseTaskList, taskActions,
} from '../../shared/projectsTasks'
import { HERDR_BIN, HERDR_CHILD_ENV, log } from './env'
import { HerdrError } from './herdr'
import { type Machine, allMachines } from './machines'
import { machineFor } from './actions'
import { REMOTE_PROJECTS_SCRIPT } from './pluginPolicy'
import { projectsPluginInfo } from './projectsPlugin'
import { findPane, getState } from './state'
import { fmt } from '../../shared/message'

export const REUSE_MS = 5000
export const READ_DEADLINE_MS = 4000
const LIST_TIMEOUT_MS = 30_000
const ACTION_TIMEOUT_MS = 60_000
const OUTPUT_MAX = 8 * 1024 * 1024

export interface RunResult { code: number, stdout: string, stderr: string }
export type Runner = (m: Machine, launcher: string, args: string[], timeoutMs: number) => Promise<RunResult>

// The plugin's launcher with argv only: no shell on this machine, and
// positional parameters of a fixed script on a remote one.
const runLauncher: Runner = async (m, launcher, args, timeoutMs) => {
  if (m.exec) {
    const herdrBin = 'bin' in m && typeof (m as { bin?: unknown }).bin === 'string' ? (m as { bin: string }).bin : 'herdr'
    const r = await m.exec(REMOTE_PROJECTS_SCRIPT, [herdrBin, 'sh', launcher, ...args], { timeoutMs })
    return { code: r.code ?? 1, stdout: r.stdout.toString('utf8'), stderr: r.stderr.trim() }
  }
  const sock = m.sock()
  return new Promise(resolve => execFile('sh', [launcher, ...args], {
    cwd: m.home,
    env: { ...HERDR_CHILD_ENV, HERDR_BIN_PATH: HERDR_BIN, NO_COLOR: '1', ...(sock ? { HERDR_SOCKET_PATH: sock } : {}) },
    timeout: timeoutMs, maxBuffer: OUTPUT_MAX,
  }, (err, stdout, stderr) => resolve({
    code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
    stdout: String(stdout), stderr: String(stderr || (err && !stdout ? err.message : '')).trim(),
  })))
}
let runner: Runner = runLauncher
// Tests replace the launcher with recorded output.
export function setRunner(r: Runner | null) { runner = r || runLauncher }

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
  const launcher = await launcherOf(m)
  const r = await serial(m.key, () => runner(m, launcher, args, timeoutMs))
  if (r.code !== 0) throw new HerdrError('projects_failed', firstLine(r.stderr) || firstLine(r.stdout) || `herdr-projects ${args[0]}: code ${r.code}`)
  return r.stdout
}

// ---------------------------------------------------------------- the list
interface Cached { tasks: TaskRow[], at: number, error?: string }
const lists = new Map<string, Cached>()
const reading = new Map<string, Promise<Cached>>()

function readList(m: Machine): Promise<Cached> {
  const now = reading.get(m.key)
  if (now) return now
  const read = command(m, ['list', '--json'], LIST_TIMEOUT_MS)
    .then(out => ({ tasks: parseTaskList(out), at: Date.now() }))
    .catch((e: Error) => ({ tasks: lists.get(m.key)?.tasks || [], at: Date.now(), error: e.message }))
    .then((c) => { lists.set(m.key, c); return c })
    .finally(() => reading.delete(m.key))
  reading.set(m.key, read)
  return read
}

async function machineTasks(m: Machine): Promise<MachineTasks | null> {
  if (!m.local && m.status !== 'online') {
    const last = lists.get(m.key)
    return last ? { machine: m.key, status: 'ready', version: '', tasks: last.tasks, stale: true, error: fmt('{machine} is unreachable', { machine: m.label }) } : null
  }
  let info
  try { info = await projectsPluginInfo(m) }
  catch { return null } // no Herdr there: nothing to say
  const base = { machine: m.key, status: info.status, version: info.version || '' }
  if (info.status !== 'ready') return { ...base, tasks: [] }
  const hit = lists.get(m.key)
  if (hit && Date.now() - hit.at < REUSE_MS) return { ...base, tasks: hit.tasks, ...(hit.error ? { error: hit.error } : {}) }
  const deadline = new Promise<null>(resolve => setTimeout(() => resolve(null), READ_DEADLINE_MS).unref?.())
  const c = await Promise.race([readList(m), deadline])
  if (!c) return { ...base, tasks: hit?.tasks || [], stale: true }
  return { ...base, tasks: c.tasks, ...(c.error ? { error: c.error } : {}) }
}

// Every machine's tasks. `since`: the version the client has; `{ same: true }` when nothing changed.
export async function readTasksBoard(since?: string): Promise<TasksBoard | { same: true, version: string }> {
  const machines = (await Promise.all(allMachines().map(machineTasks))).filter((x): x is MachineTasks => x !== null)
  const version = createHash('sha1').update(JSON.stringify(machines)).digest('hex').slice(0, 16)
  return since === version ? { same: true, version } : { version, machines }
}

// ---------------------------------------------------------------- one task
function taskOf(m: Machine, id: string): TaskRow | null {
  return lists.get(m.key)?.tasks.find(t => t.id === id) || null
}

function checkId(id: unknown): string {
  if (!isTaskId(id)) throw new HerdrError('bad_task', 'Invalid task')
  return id
}

export async function taskDetails(machine: unknown, id: unknown): Promise<TaskDetails & { pane: string | null }> {
  const m = machineFor(machine)
  const tid = checkId(id)
  const d = parseTaskDetails(await command(m, ['details', '--json', '--', tid], LIST_TIMEOUT_MS))
  return { ...d, pane: await taskPane(m, tid, d.worktree).catch(() => null) }
}

// The task's agent pane in Herdr: the one the board linked it to (its task.json,
// read only), or else the pane working in its worktree. null: none open.
async function taskPane(m: Machine, id: string, worktree: string): Promise<string | null> {
  const [repo, n] = id.split('/') as [string, string]
  const file = path.posix.join(m.home, '.herdr-projects/data/tasks', repo, n, 'task.json')
  let linked = ''
  try {
    const t = JSON.parse(await m.fs.readFile(file)) as { link?: { pane?: unknown } }
    if (typeof t?.link?.pane === 'string' && /^w[0-9a-z]+:p[0-9a-z]+$/i.test(t.link.pane)) linked = t.link.pane
  } catch { /* moved by HERDR_PROJECTS_HOME, or not started yet */ }
  if (linked && findPane(joinId(m.key, linked))) return joinId(m.key, linked)
  if (!worktree) return null
  const hit = getState().panes.find(p => (p.machine || '') === m.key && p.agent && (p.cwd || '').replace(/\/+$/, '') === worktree.replace(/\/+$/, ''))
  return hit ? hit.id : null
}

function forget(m: Machine) { lists.delete(m.key) }

export async function tellTask(machine: unknown, id: unknown, text: unknown): Promise<{ ok: true, msg: string }> {
  const m = machineFor(machine)
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
  const m = machineFor(machine)
  const tid = checkId(id)
  const row = taskOf(m, tid)
  if (!row || !taskActions(row).approve) throw new HerdrError('bad_action', 'This task does not wait for approval')
  const out = await command(m, ['approve', '--', tid])
  forget(m)
  log(`herdr-projects approve ${tid}${m.local ? '' : ` on ${m.label}`}`)
  return { ok: true, msg: firstLine(out) }
}

// A message to the machine's Coordinator (the agent behind the board's box):
// it turns it into tasks. Started by herdr-projects when it is not running.
export async function tellCoordinator(machine: unknown, text: unknown): Promise<{ ok: true, msg: string }> {
  const m = machineFor(machine)
  const words = cleanTell(text)
  if (!words) throw new HerdrError('empty', 'Nothing to send')
  const out = await command(m, ['coordinator', '--', 'tell', words])
  forget(m)
  log(`herdr-projects coordinator tell${m.local ? '' : ` on ${m.label}`}`)
  return { ok: true, msg: firstLine(out) }
}
