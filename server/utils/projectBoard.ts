// "Project" panel of a herdr-projects coordinator, read-only:
// TASKS.md of the project folder and `herdr-projects thread list --json`, on the
// coordinator's machine (local, or remote over the SSH connection).
//
// Nothing is hard-coded: the binary comes from the plugin as Herdr declares it
// (`plugin.list`: plugin_root + manifest command), the project folder is
// the coordinator's (`<root>/<slug>`), the root is its parent.
import { execFile } from 'node:child_process'
import path from 'node:path'
import type { Pane } from '../../shared/types'
import { type ProjectBoard, type ProjectThread, maxParallelThreads, normalizeThreads, parseTasks, splitThreads } from '../../shared/projectBoard'
import { projectOf } from '../../shared/projects'
import { type RawProjectsPlugin, manifestBinary } from '../../shared/projectsPlugin'
import { isProjectThread } from '../../shared/paneTitle'
import { HERDR_BIN, HERDR_CHILD_ENV } from './env'
import { HerdrError, herdrOn } from './herdr'
import type { Machine } from './machines'
import { machineFor } from './actions'
import { currentMachineSlots, paneBaseMachine } from './threadLimits'

const TASKS_BYTES = 256 * 1024
const PROJECT_HEAD_BYTES = 16 * 1024
const REPORT_BYTES = 512 * 1024
const THREADS_BYTES = 8 * 1024 * 1024
const BIN_TTL_MS = 60000
const PLUGIN_ID = 'herdr-projects'

// herdr-projects binary according to the manifest: path relative to plugin_root.
// None for herdr-projects 1.x (see shared/projectsPlugin.ts).
export function pluginBinary(plugins: RawProjectsPlugin[]): string | null {
  const p = (plugins || []).find(x => x && x.plugin_id === PLUGIN_ID && x.enabled !== false)
  if (!p || typeof p.plugin_root !== 'string' || !path.posix.isAbsolute(p.plugin_root)) return null
  const bin = manifestBinary(p)
  if (!bin) return null
  return path.posix.isAbsolute(bin) ? bin : path.posix.join(p.plugin_root, bin)
}

const bins = new Map<string, { at: number, bin: Promise<string | null> }>()
export function binaryOn(m: Machine): Promise<string | null> {
  const hit = bins.get(m.key)
  if (hit && Date.now() - hit.at < BIN_TTL_MS) return hit.bin
  const bin = herdrOn<{ plugins?: RawProjectsPlugin[] }>(m.key, 'plugin.list', {}, 8000)
    .then(r => pluginBinary(r.plugins || []))
  bin.catch(() => bins.delete(m.key))
  bins.set(m.key, { at: Date.now(), bin })
  return bin
}

// Project folder of a coordinator: its working folder, named like the
// project, with the herdr-projects files.
async function projectDir(m: Machine, p: Pane): Promise<{ dir: string, slug: string } | null> {
  const slug = projectOf(p)
  const cwd = (p.cwd || '').replace(/\/+$/, '')
  if (!slug || !p.agent || isProjectThread(p) || !path.posix.isAbsolute(cwd)) return null
  if (path.posix.basename(cwd).toLowerCase() !== slug.toLowerCase()) return null
  const [tasks, project] = await m.fs.statMany([`${cwd}/TASKS.md`, `${cwd}/PROJECT.md`])
  if (!(tasks?.isFile || project?.isFile)) return null
  return { dir: cwd, slug: path.posix.basename(cwd) }
}

export interface Target { m: Machine, dir: string, slug: string, bin: string }
export async function target(pane: Pane): Promise<Target | null> {
  const m = machineFor(pane.machine)
  const bin = await binaryOn(m).catch(() => null)
  if (!bin) return null
  const where = await projectDir(m, pane)
  return where ? { m, bin, ...where } : null
}

// Light version: TASKS.md (size, date), PROJECT.md (thread slots) and the
// threads folder, which herdr-projects rewrites (atomic writes) on every
// thread change.
async function version(t: Target): Promise<{ v: string, tasks: { size: number } | null, project: { size: number } | null }> {
  const [tasks, threads, project] = await t.m.fs.statMany([`${t.dir}/TASKS.md`, `${t.dir}/threads`, `${t.dir}/PROJECT.md`])
  const v = `${tasks ? `${tasks.size}.${tasks.mtimeMs}` : '-'}|${threads ? threads.mtimeMs : '-'}|${project ? project.mtimeMs : '-'}`
  return { v, tasks: tasks?.isFile ? tasks : null, project: project?.isFile ? project : null }
}

// A herdr-projects command of the project, on its machine, in its Herdr
// session: argv only (remote: positional parameters of a fixed script).
export interface ProjectsRun { code: number, stdout: string, stderr: string }
const REMOTE_RUN = 'export HERDR_BIN_PATH="$1" HERDR_SESSION="$2"; bin="$3"; shift 3; exec "$bin" "$@"'
// `maxBytes` bounds the output on both sides: more is a failed command.
export function runProjectCommand(t: Pick<Target, 'm' | 'bin'>, args: string[], timeoutMs = 15000, maxBytes = 1024 * 1024): Promise<ProjectsRun> {
  const session = t.m.session && t.m.session !== 'default' ? t.m.session : ''
  const remote = t.m.exec
  if (remote) {
    const herdrBin = (t.m as { bin?: string }).bin || 'herdr'
    // The SSH runner has no output limit of its own: an output over the limit
    // is refused here, never decoded, parsed or sent to the app.
    return remote(REMOTE_RUN, [herdrBin, session, t.bin, ...args], { timeoutMs })
      .then(r => (r.stdout.length > maxBytes
        ? { code: 1, stdout: '', stderr: 'output too long' }
        : { code: r.code ?? 1, stdout: r.stdout.toString('utf8'), stderr: r.stderr }))
  }
  const env: NodeJS.ProcessEnv = { ...HERDR_CHILD_ENV, HERDR_BIN_PATH: HERDR_BIN }
  if (session) env.HERDR_SESSION = session
  return new Promise((resolve) => {
    execFile(t.bin, args, { env, timeout: timeoutMs, maxBuffer: maxBytes }, (err, out, stderr) => resolve({
      code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
      stdout: String(out),
      stderr: String(stderr || (err ? err.message : '')),
    }))
  })
}

// Projects root of a project folder (`--root`): its parent.
export const projectsRoot = (t: Pick<Target, 'dir'>) => path.posix.dirname(t.dir)

async function threadList(t: Target): Promise<string> {
  const r = await runProjectCommand(t, ['--root', projectsRoot(t), 'thread', 'list', t.slug, '--json'], 15000, THREADS_BYTES)
  if (r.code !== 0) throw new Error(r.stderr.trim().split('\n').pop() || `code ${r.code}`)
  if (r.stdout.length > THREADS_BYTES) throw new Error('thread list too long')
  return r.stdout
}

export type BoardReply = ProjectBoard | { same: true, version: string } | { available: false }

// Last thread list read for each project: shown again while a read fails
// (refused SSH session, timeout) instead of an error.
const lastThreads = new Map<string, ProjectThread[]>()

export async function readProjectBoard(pane: Pane, since?: string): Promise<BoardReply> {
  const t = await target(pane)
  if (!t) return { available: false }
  const ver = await version(t)
  // Global limit of the machine: other projects' threads change it too.
  const machine = (await currentMachineSlots().catch(() => [])).find(s => s.key === paneBaseMachine(pane))
  if (machine?.max) ver.v += `|m${machine.open}/${machine.max}`
  if (since && since === ver.v) return { same: true, version: ver.v }
  const [tasksText, projectText, threads] = await Promise.all([
    ver.tasks ? t.m.fs.read(`${t.dir}/TASKS.md`, 0, Math.min(ver.tasks.size, TASKS_BYTES)).then(b => b.toString('utf8')) : Promise.resolve(null),
    ver.project ? t.m.fs.read(`${t.dir}/PROJECT.md`, 0, Math.min(ver.project.size, PROJECT_HEAD_BYTES)).then(b => b.toString('utf8')).catch(() => '') : Promise.resolve(''),
    threadList(t).then(out => ({ list: normalizeThreads(JSON.parse(out)), error: undefined as string | undefined }))
      .then((r) => { lastThreads.set(`${t.m.key}|${t.dir}`, r.list); return r })
      .catch((e: Error) => {
        const last = lastThreads.get(`${t.m.key}|${t.dir}`)
        return last ? { list: last, error: undefined } : { list: [], error: e.message || 'threads illisibles' }
      }),
  ])
  const { open, resolved } = splitThreads(threads.list)
  const board: ProjectBoard = { slug: t.slug, lists: parseTasks(tasksText || ''), open, resolved, version: ver.v }
  if (tasksText === null) board.tasksMissing = true
  if (threads.error) board.threadsError = threads.error
  // herdr-projects counts every open thread against max_parallel_threads.
  const max = maxParallelThreads(projectText)
  if (max && !threads.error) board.slots = { used: open.length, max }
  if (machine?.max) board.machineSlots = { label: machine.label, open: machine.open, max: machine.max }
  return board
}

// Report of a thread: copy kept by herdr-projects in threads/t-NNNN.md.
export async function readThreadReport(pane: Pane, id: string): Promise<{ id: string, text: string, truncated: boolean }> {
  if (!/^t-\d{4,}$/.test(id)) throw new HerdrError('bad_thread', 'invalid thread')
  const t = await target(pane)
  if (!t) throw new HerdrError('no_project', 'project not found')
  const file = `${t.dir}/threads/${id}.md`
  const st = await t.m.fs.stat(file).catch(() => null)
  if (!st || !st.isFile) throw new HerdrError('no_report', 'no report for this thread')
  const len = Math.min(st.size, REPORT_BYTES)
  const text = (await t.m.fs.read(file, 0, len)).toString('utf8')
  return { id, text, truncated: st.size > REPORT_BYTES }
}
