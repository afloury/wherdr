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
import path from 'node:path'
import { joinId } from '../../shared/ids'
import {
  type MachineTasks, type TaskDetails, type TaskRow, type TasksBoard,
  taskCanFix, taskCanApproveAnyway, failureIsStale, type StartOptions, type TaskCommand, addArgs, delegateArgs, isAgentName, parseWorkerAgent, restoreAgentArgs, runOver, type TaskAgent, cleanRepo, cleanTarget, cleanTell, cleanTitle, type CoordinatorStatus, coordinatorArgs, coordinatorRestartArgs, coordinatorStatusArgs, parseCoordinatorStatus, detailsFromTaskFile, isTaskCommand,
  isTaskId, parseRepoKey, parseTaskDetails, parseTaskList, repoKeysFromFile, rowFromTaskFile, taskActions,
} from '../../shared/projectsTasks'
import { HERDR_BIN, HERDR_CHILD_ENV, IN_CONTAINER, log } from './env'
import { USER_PATH_SH, userPath } from '../../bin/lib/userpath.mjs'
import { NATIVE_MOVE_URL } from './updates'
import { HerdrError } from './herdr'
import { type Machine, allMachines, baseMachines } from './machines'
import { machineFor } from './actions'
import { projectsPluginInfo } from './projectsPlugin'
import { installedAgentKinds } from './agentAvailability'
import { dropStartAgent, rememberStartAgent, startAgentKey, startAgentOf, startAgentsOf } from './startAgents'
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
// The remote shell is not a login shell: its PATH is completed first, as on
// this machine (bin/lib/userpath.mjs), so herdr-projects finds the agents.
export const REMOTE_TASKS_SCRIPT = USER_PATH_SH + 'export HERDR_BIN_PATH="$1"; unset HERDR_SOCKET_PATH; '
  + 'if [ -n "$2" ] && [ "$2" != default ]; then export HERDR_SESSION="$2"; else unset HERDR_SESSION; fi; shift 2; exec "$@"'

// The environment of herdr-projects on this machine. Run directly (not as a
// Herdr plugin command), it does not widen its PATH by itself: it gets the
// user's (bin/lib/userpath.mjs), read again each time since herdr-projects'
// record of it may be newer, so it finds the agents in user folders.
export function launcherEnv(home: string, sock?: string | null, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const PATH = userPath({ env: { PATH: HERDR_CHILD_ENV.PATH, HERDR_PROJECTS_DATA_DIR: env.HERDR_PROJECTS_DATA_DIR, HERDR_PROJECTS_HOME: env.HERDR_PROJECTS_HOME }, home })
  return { ...HERDR_CHILD_ENV, PATH, HERDR_BIN_PATH: HERDR_BIN, NO_COLOR: '1', ...(sock ? { HERDR_SOCKET_PATH: sock } : {}) }
}

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
    env: launcherEnv(m.home, sock),
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
const CONTAINER = IN_CONTAINER || process.env.WHERDR_TASKS_FROM_FILES === '1'
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
// is named in `failed` (a partial read). `archived`: the archived tasks instead.
async function listFromFiles(m: Machine, archived = false): Promise<{ tasks: TaskRow[], failed: string[] }> {
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
  return { tasks: rows.filter((r): r is TaskRow => r !== null && r.archived === archived).slice(0, FILES_MAX), failed }
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
  const started = Date.now()
  const read = (readsFiles(m) ? listFromFiles(m) : command(m, ['list', '--json'], LIST_TIMEOUT_MS).then(async text => ({ tasks: await Promise.all(parseTaskList(text).map(async row => {
    if (row.stage !== 'approval') return row
    // The CLI list omits these blockers. Read only their file flags, with no
    // extra upkeep commands, so Home, Board and panel use the same group.
    const file = await readTaskFile(m, row.id).catch(() => null)
    return file?.stage === 'approval' && rowFromTaskFile(file, null)?.approvalBlocked
      ? { ...row, approvalBlocked: true, group: 'needs' as const } : row
  })), failed: [] as string[] })))
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
    .then(async (c: Cached) => {
      lists.set(m.key, c)
      if (c.error && !c.partial) return c
      if (!readsFiles(m)) void restoreFinished(m, c.tasks, started).catch(() => {})
      // A repo never seen: its key is waited for a moment, so the first look names its tasks right.
      const keys = readKeys(m, c.tasks.map(t => t.repo))
      if (c.tasks.some(t => !repoKeys.get(m.key)?.has(t.repo))) await Promise.race([keys, new Promise(r => setTimeout(r, KEYS_WAIT_MS).unref?.())])
      return c
    })
    .finally(() => reading.delete(m.key))
  reading.set(m.key, read)
  return read
}

// ---------------------------------------------------------------- repo keys
// A task's name on the board is its repo's short key and its number (`APP-6`).
// `list --json` gives ids only, so each repo's key is asked once
// (`show --repo=<name> --json`), after a list, behind the Board's own commands,
// and asked again after a while (a key can be changed). In a container: read
// from the board's record of keys (data/repo-keys.json).
const KEYS_TTL_MS = 10 * 60_000
const KEYS_RETRY_MS = 60_000
const KEYS_WAIT_MS = 3_000
const repoKeys = new Map<string, Map<string, { key: string, at: number }>>()
const keysReading = new Set<string>()

export function repoKeyOf(machine: string, repo: string): string {
  return repoKeys.get(machine)?.get(repo)?.key || ''
}
const withKeys = (machine: string, tasks: TaskRow[]): TaskRow[] => {
  const known = repoKeys.get(machine)
  return known ? tasks.map((t) => { const key = known.get(t.repo)?.key; return key ? { ...t, repoKey: key } : t }) : tasks
}

async function readKeys(m: Machine, repos: string[]): Promise<void> {
  if (keysReading.has(m.key)) return
  const known = repoKeys.get(m.key) ?? new Map<string, { key: string, at: number }>()
  const now = Date.now()
  const due = [...new Set(repos)].filter(r => (known.get(r)?.at ?? 0) <= now - KEYS_TTL_MS)
  if (!due.length) return
  keysReading.add(m.key)
  try {
    if (readsFiles(m)) {
      let keys: Record<string, string> = {}
      try { keys = repoKeysFromFile(await m.fs.readFile(path.posix.join(m.home, '.herdr-projects/data/repo-keys.json'))) }
      catch { /* no record yet: no keys */ }
      for (const r of due) known.set(r, { key: keys[r] || '', at: Date.now() })
    } else {
      for (const r of due) {
        // A failed read is asked again sooner.
        try { known.set(r, { key: parseRepoKey(await command(m, ['show', `--repo=${r}`, '--json'], LIST_TIMEOUT_MS)), at: Date.now() }) }
        catch { known.set(r, { key: known.get(r)?.key || '', at: Date.now() - KEYS_TTL_MS + KEYS_RETRY_MS }) }
      }
    }
    repoKeys.set(m.key, known)
  } finally { keysReading.delete(m.key) }
}

// What a cached read says: its tasks, when they were read, and why they may be old.
function shown(machine: string, c: Cached): Pick<MachineTasks, 'tasks' | 'at' | 'error' | 'stale'> {
  return { tasks: withKeys(machine, c.tasks), ...(c.readAt ? { at: c.readAt } : {}), ...(c.error ? { error: c.error, stale: !c.partial && c.tasks.length > 0 } : {}) }
}

// `fresh`: the Board just opened (or asked to): check the plugin again rather
// than trust the last answer, so an install or update shows at once.
async function machineTasks(m: Machine, fresh = false): Promise<MachineTasks | null> {
  const last = lists.get(m.key)
  if (!m.local && m.status !== 'online') {
    const error = fmt('{machine} is unreachable', { machine: m.label })
    return last ? { machine: m.key, status: 'ready', version: '', ...shown(m.key, last), error, stale: true } : null
  }
  let info
  try { info = await projectsPluginInfo(m, fresh) }
  catch (e) {
    // Herdr did not answer: say so, with the last tasks read there.
    return { machine: m.key, status: 'error', version: '', tasks: [], ...(last ? shown(m.key, last) : {}), error: (e as Error).message, ...(last?.tasks.length ? { stale: true } : {}) }
  }
  const base = { machine: m.key, status: info.status, version: info.version || '', ...(readsFiles(m) ? { readOnly: true, moveUrl: NATIVE_MOVE_URL } : {}) }
  if (info.status !== 'ready') return { ...base, tasks: [] }
  if (last && Date.now() - last.at < REUSE_MS) return { ...base, ...shown(m.key, last) }
  const deadline = new Promise<null>(resolve => setTimeout(() => resolve(null), READ_DEADLINE_MS).unref?.())
  const c = await Promise.race([readList(m), deadline])
  if (!c) return { ...base, tasks: withKeys(m.key, last?.tasks || []), ...(last?.readAt ? { at: last.readAt } : {}), stale: true }
  return { ...base, ...shown(m.key, c) }
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

// The task's row as the last list has it; read again when that list was
// dropped (an action just ran) or never read.
async function taskOf(m: Machine, id: string): Promise<TaskRow | null> {
  const known = lists.get(m.key)
  const hit = known?.tasks.find(t => t.id === id)
  if (hit || (known && !known.error && Date.now() - known.at < REUSE_MS)) return hit || null
  return (await readList(m)).tasks.find(t => t.id === id) || null
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
  // The closing note and whether it is archived: in the task's file only (1.2.1's `details` leaves them out).
  if (!d.summary && typeof file?.summary === 'string') d = { ...d, summary: file.summary.slice(0, 8000).trim() }
  if (!d.archived && file?.archivedAt) d = { ...d, archived: true }
  return { ...withStale(d, file), pane: taskPane(m, file) }
}

// Whether its failure is behind it: the task's file has when it last moved on.
function withStale(d: TaskDetails, file: Record<string, unknown> | null): TaskDetails {
  return { ...d, failureStale: failureIsStale(d.stage, d.failureAt, file) }
}

// The task's agent pane in Herdr: only the one the board linked it to (its
// task.json, read only, in the session it names), while Herdr shows it. No
// readable link, or a linked pane that is gone: no pane (the sheet opens). An
// agent working in the same folder is never taken for the task's.
function taskPane(m: Machine, file: Record<string, unknown> | null): string | null {
  const linked = linkedPane(m, file)
  return linked.pane && findPane(linked.pane) ? linked.pane : null
}

function forget(m: Machine) { lists.delete(m.key) }
// Tests start from an empty cache.
// `keepKeys`: the repos' keys stay (a later list without asking them again).
export function resetTasksCache(keepKeys = false) {
  lists.clear(); reading.clear(); queues.clear()
  if (!keepKeys) { repoKeys.clear(); keysReading.clear() }
}

export async function tellTask(machine: unknown, id: unknown, text: unknown): Promise<{ ok: true, msg: string }> {
  const m = boardOf(machine)
  const tid = checkId(id)
  const words = cleanTell(text)
  if (!words) throw new HerdrError('empty', 'Nothing to send')
  const row = await taskOf(m, tid)
  if (row && !taskActions(row).tell) throw new HerdrError('bad_action', 'This task has no agent to talk to')
  const out = await command(m, ['tell', '--', tid, words])
  forget(m)
  log(`herdr-projects tell ${tid}${m.local ? '' : ` on ${m.label}`}`)
  return { ok: true, msg: firstLine(out) }
}

export async function approveTask(machine: unknown, id: unknown, anyway: unknown = false): Promise<{ ok: true, msg: string }> {
  const m = boardOf(machine)
  const tid = checkId(id)
  const row = await taskOf(m, tid)
  if (!row || !taskActions(row).approve) throw new HerdrError('bad_action', 'This task does not wait for approval')
  if (anyway !== false && anyway !== true) throw new HerdrError('bad_action', 'Invalid approval')
  if (anyway && (!row || !taskCanApproveAnyway(row, await taskDetails(machine, id)))) throw new HerdrError('bad_action', 'This task cannot bypass approval checks')
  const out = await command(m, ['approve', ...(anyway ? ['--anyway'] : []), '--', tid])
  forget(m)
  log(`herdr-projects approve ${tid}${m.local ? '' : ` on ${m.label}`}`)
  return { ok: true, msg: firstLine(out) }
}

// One of the task commands that take only its id (`delegate`, `stop`,
// `retry`, `archive`), on a task the last list shows it applies to.
// `agent` (delegate only): start it with that agent, one installed on the
// task's machine, for this start only (shared delegateArgs); none: its default.
export async function taskCommand(machine: unknown, id: unknown, action: unknown, agent?: unknown): Promise<{ ok: true, msg: string }> {
  const m = boardOf(machine)
  const tid = checkId(id)
  if (!isTaskCommand(action)) throw new HerdrError('bad_action', 'Unknown action')
  const chosen = agent === undefined || agent === null || agent === '' ? null : agent
  if (chosen !== null && action !== 'delegate') throw new HerdrError('bad_action', 'Only Start takes an agent')
  if (chosen !== null && (!isAgentName(chosen) || !(await installedAgentKinds(m)).includes(chosen))) {
    throw new HerdrError('bad_agent', fmt('{agent} is not installed on {machine}', { agent: isAgentName(chosen) ? chosen : '?', machine: m.label }))
  }
  // An archived task is not in the list: its own row (`restore` only applies to it).
  const row = action === 'restore' ? await archivedRow(m, tid) : await taskOf(m, tid)
  // A failed task: what failed decides between Retry and Start (`details`).
  // `fix` also needs to know the failure is still current (its file).
  const failure = action === 'fix' || (row?.stage === 'failed' && (action === 'retry' || action === 'delegate'))
    ? withStale(parseTaskDetails(await command(m, ['details', '--json', '--', tid], LIST_TIMEOUT_MS)), action === 'fix' ? await readTaskFile(m, tid).catch(() => null) : null)
    : null
  if (!row || (action === 'fix' ? !taskCanFix(row, failure) : !taskActions(row, failure)[action])) throw refused(action)
  // A new start: an agent picked for an earlier one goes first, so the task
  // starts from its own default again (or from the one picked now).
  let prev: string | null = null
  if (action === 'delegate') {
    await restoreStartAgent(m, tid)
    if (chosen) { const own = await taskAgent(m, tid); prev = own?.place === 'task' ? own.value : null }
  }
  const out = await command(m, action === 'delegate' ? delegateArgs(tid, chosen) : [action, '--', tid])
  forget(m)
  if (chosen && chosen !== prev) await rememberStartAgent(startAgentKey(m.key, tid), { agent: chosen, prev, at: Date.now() })
  log(`herdr-projects ${action} ${tid}${chosen ? ` --worker.agent=${chosen}` : ''}${m.local ? '' : ` on ${m.label}`}`)
  return { ok: true, msg: firstLine(out) }
}

// The task's worker.agent as 1.x resolves it, and where it comes from.
async function taskAgent(m: Machine, id: string): Promise<TaskAgent | null> {
  return parseWorkerAgent(await command(m, ['show', '--json', '--', id], LIST_TIMEOUT_MS))
}

// Puts back what the task had before an agent was picked for one start, while
// its own worker.agent is still that pick (one set since by someone else stays).
async function restoreStartAgent(m: Machine, id: string): Promise<void> {
  const key = startAgentKey(m.key, id)
  const rec = await startAgentOf(key)
  if (!rec) return
  const own = await taskAgent(m, id)
  if (own?.place === 'task' && own.value === rec.agent) {
    await command(m, restoreAgentArgs(id, rec.prev))
    log(`herdr-projects ${rec.prev ? `set worker.agent ${rec.prev}` : 'unset worker.agent'} --task ${id} (after a start with ${rec.agent})${m.local ? '' : ` on ${m.label}`}`)
  }
  await dropStartAgent(key)
}

// After a list: the picks of runs now over are taken back, behind the Board's
// own commands. Only with a list read after the pick (`since`): an older one
// still shows the task as it was before its start.
async function restoreFinished(m: Machine, tasks: TaskRow[], since: number): Promise<void> {
  for (const [id, rec] of await startAgentsOf(m.key)) {
    const row = tasks.find(t => t.id === id)
    if (rec.at >= since || !row || !runOver(row)) continue
    await restoreStartAgent(m, id).catch(e => log(`herdr-projects: could not put back worker.agent of ${id}: ${(e as Error).message}`))
  }
}
// What Start offers on a task: the agent it starts with by default (`show <id>
// --json`: its worker.agent and where that comes from) and the agents
// installed on its machine. From a container nothing is run: no default known.
export async function taskStartOptions(machine: unknown, id: unknown): Promise<StartOptions> {
  const m = boardOf(machine)
  const tid = checkId(id)
  const [agent, agents] = await Promise.all([
    // The default as the next start will have it: an earlier pick put back first.
    readsFiles(m) ? null : restoreStartAgent(m, tid).then(() => taskAgent(m, tid)),
    installedAgentKinds(m).catch(() => [] as string[]),
  ])
  return { agent, agents }
}

function refused(action: TaskCommand): HerdrError {
  switch (action) {
    case 'delegate': return new HerdrError('bad_action', 'This task cannot be started now')
    case 'stop': return new HerdrError('bad_action', 'This task has no agent at work to stop')
    case 'fix': return new HerdrError('bad_action', 'This failure needs the human first')
    case 'retry': return new HerdrError('bad_action', 'This task has nothing to retry')
    case 'finish': return new HerdrError('bad_action', 'This task has nothing to finish as it is')
    case 'archive': return new HerdrError('bad_action', 'This task cannot be archived while an agent works on it')
    case 'restore': return new HerdrError('bad_action', 'This task is not archived')
  }
}

// An archived task's row: from its file (read only), else from the archived list.
async function archivedRow(m: Machine, id: string): Promise<TaskRow | null> {
  const file = await readTaskFile(m, id).catch(() => null)
  const row = file ? rowFromTaskFile(file, null) : null
  if (row) return row
  return (await archivedList(m)).find(t => t.id === id) || null
}

// The archived tasks of a machine's board (`list --json --archived`, or the
// files from a container), newest first. Not cached: asked when the Board's
// "Archived" is opened, or for one task.
async function archivedList(m: Machine): Promise<TaskRow[]> {
  if (readsFiles(m)) return (await listFromFiles(m, true)).tasks
  return parseTaskList(await command(m, ['list', '--json', '--archived'], LIST_TIMEOUT_MS)).filter(t => t.archived)
}
export async function archivedTasks(machine: unknown): Promise<{ machine: string, tasks: TaskRow[] }> {
  const m = boardOf(machine)
  const tasks = (await archivedList(m)).sort((a, b) => b.n - a.n || a.repo.localeCompare(b.repo))
  void readKeys(m, tasks.map(t => t.repo)).catch(() => {})
  return { machine: m.key, tasks: withKeys(m.key, tasks) }
}

// A new task (`add`): in a repo the board knows (its name or its folder), or
// in the home folder; `delegate` puts an agent on it at once.
export async function addTask(machine: unknown, b: { title?: unknown, description?: unknown, repo?: unknown, delegate?: unknown }): Promise<{ ok: true, msg: string }> {
  const m = boardOf(machine)
  const title = cleanTitle(b.title)
  if (!title) throw new HerdrError('empty', 'A task needs a title')
  const repo = cleanRepo(b.repo)
  if (repo === null) throw new HerdrError('bad_repo', 'Invalid repo')
  const out = await command(m, addArgs({ title, description: cleanTell(b.description), repo, delegate: b.delegate === true }))
  forget(m)
  log(`herdr-projects add${b.delegate === true ? ' --delegate' : ''}${m.local ? '' : ` on ${m.label}`}`)
  return { ok: true, msg: firstLine(out) }
}

// A message to one of the machine's coordinators (the agent behind the
// board's box): its Coordinator by default, the machine coordinator, or a
// repo's project coordinator. It turns it into tasks; `delegate` puts an agent
// on each task it adds. Started by herdr-projects when it is not running, in
// the machine's own session.
// The pane a coordinator talks in, as herdr-projects keeps it: asked in the
// board's own session (where `coordinator tell` starts it), so its pane id is
// that session's, and only a pane Herdr shows there now. `pane: null`: not
// started, starting, or gone (its first message starts it). `error`: why its
// last start failed (it waits for Try again, `restartCoordinator`). From a
// container: not asked (nothing runs there), so no pane.
export async function coordinatorPane(machine: unknown, to: unknown): Promise<CoordinatorStatus> {
  const m = boardOf(machine)
  const target = cleanTarget(to)
  if (!target) throw new HerdrError('bad_target', 'Invalid coordinator')
  if (readsFiles(m)) return { pane: null, state: 'unknown', error: '', name: '', queued: null }
  const st = parseCoordinatorStatus(await command(m, coordinatorStatusArgs(target), LIST_TIMEOUT_MS))
  const pane = st.pane ? joinId(m.key, st.pane) : null
  return { ...st, pane: pane && findPane(pane) ? pane : null }
}

// Try again after a failed start: `coordinator restart` clears the error
// herdr-projects kept and starts it, with the words still waiting.
export async function restartCoordinator(machine: unknown, to: unknown): Promise<{ ok: true, msg: string }> {
  const m = boardOf(machine)
  const target = cleanTarget(to)
  if (!target) throw new HerdrError('bad_target', 'Invalid coordinator')
  const out = await command(m, coordinatorRestartArgs(target))
  forget(m)
  log(`herdr-projects coordinator${target.kind === 'main' ? '' : ` (${target.kind === 'project' ? target.repo : 'machine'})`} restart${m.local ? '' : ` on ${m.label}`}`)
  return { ok: true, msg: firstLine(out) }
}

export async function tellCoordinator(machine: unknown, text: unknown, opts: { to?: unknown, delegate?: unknown } = {}): Promise<{ ok: true, msg: string }> {
  const m = boardOf(machine)
  const words = cleanTell(text)
  if (!words) throw new HerdrError('empty', 'Nothing to send')
  const to = cleanTarget(opts.to)
  if (!to) throw new HerdrError('bad_target', 'Invalid coordinator')
  const out = await command(m, coordinatorArgs(to, words, opts.delegate === true))
  forget(m)
  log(`herdr-projects coordinator${to.kind === 'main' ? '' : ` (${to.kind === 'project' ? to.repo : 'machine'})`} tell${opts.delegate === true ? ' --delegate' : ''}${m.local ? '' : ` on ${m.label}`}`)
  return { ok: true, msg: firstLine(out) }
}
