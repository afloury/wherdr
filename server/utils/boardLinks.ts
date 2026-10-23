// herdr-projects 1.x on the home list (GET /api/tasks/links): which panes and
// spaces of every machine belong to its board (see shared/boardLinks.ts).
//
// Read from the board's files only, never through its CLI (each 1.x command
// runs the board's upkeep): the task folders, the coordinators' state files
// and the repos' keys. On an SSH machine over its connection: a few `readdir`,
// one `stat` of every file, and only the files that changed since are read
// again. A machine's answer is reused for REUSE_MS; an unreachable machine
// keeps its last one.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import {
  type BoardLinks, type FileLinks, type LinkedCoordinator, type MachineLinks, type RepoInfo,
  parseRepoGit,
  TASK_DIR_RE, coordinatorFromFile, linksFromTaskFile, socketSession, tasksFromFiles,
} from '../../shared/boardLinks'
import { repoKeysFromFile } from '../../shared/projectsTasks'
import type { FsStat } from './fsx'
import { type Machine, baseMachines } from './machines'
import { sessionMachine } from './projectsTasks'

const REUSE_MS = 8000
// Task folders looked at per repo (the newest), and files in all.
const PER_REPO_MAX = 300
const FILES_MAX = 2000
const DIR_RE = /^[A-Za-z0-9][\w.-]{0,79}$/

interface Seen { mtime: number, size: number, value: unknown }
interface Cache { at: number, links: MachineLinks, files: Map<string, Seen> }
const caches = new Map<string, Cache>()
const reading = new Map<string, Promise<MachineLinks>>()

const dataDir = (m: Machine) => path.posix.join(m.home, '.herdr-projects/data')
async function names(m: Machine, dir: string): Promise<string[]> {
  try { return (await m.fs.readdir(dir)).filter(n => DIR_RE.test(n)) }
  catch { return [] }
}

// The files' contents, parsed: read again only when their size or time changed.
async function readChanged(m: Machine, files: Map<string, Seen>, paths: string[]): Promise<Map<string, unknown>> {
  const stats: (FsStat | null)[] = paths.length ? await m.fs.statMany(paths) : []
  const out = new Map<string, unknown>()
  await Promise.all(paths.map(async (p, i) => {
    const st = stats[i]
    if (!st?.isFile) { files.delete(p); return }
    const seen = files.get(p)
    if (seen && seen.mtime === st.mtimeMs && seen.size === st.size) { out.set(p, seen.value); return }
    let value: unknown = null
    try { value = JSON.parse(await m.fs.readFile(p)) }
    catch { /* being written, or not JSON: nothing from it this time */ }
    files.set(p, { mtime: st.mtimeMs, size: st.size, value })
    out.set(p, value)
  }))
  for (const p of [...files.keys()]) if (!paths.includes(p)) files.delete(p)
  return out
}

async function readMachine(m: Machine, files: Map<string, Seen>): Promise<MachineLinks> {
  const data = dataDir(m)
  const tasksDir = path.posix.join(data, 'tasks')
  const coordDir = path.posix.join(data, 'coordinator')
  const taskPaths: string[] = []
  for (const repo of await names(m, tasksDir)) {
    const dirs = (await names(m, path.posix.join(tasksDir, repo))).filter(n => TASK_DIR_RE.test(n))
      .sort((a, b) => parseInt(b, 10) - parseInt(a, 10) || a.localeCompare(b)).slice(0, PER_REPO_MAX)
    for (const n of dirs) taskPaths.push(path.posix.join(tasksDir, repo, n, 'task.json'))
  }
  const coordPaths: { p: string, level: LinkedCoordinator['level'], session: string, folder?: string }[] = []
  for (const s of await names(m, coordDir)) {
    const top = path.posix.join(coordDir, s)
    coordPaths.push({ p: path.posix.join(top, 'state.json'), level: 'top', session: s }, { p: path.posix.join(top, 'machine/state.json'), level: 'machine', session: s })
    for (const r of await names(m, path.posix.join(top, 'projects'))) coordPaths.push({ p: path.posix.join(top, 'projects', r, 'state.json'), level: 'project', session: s, folder: r })
  }
  const keysPath = path.posix.join(data, 'repo-keys.json')
  const all = [...taskPaths.slice(0, FILES_MAX), ...coordPaths.map(c => c.p), keysPath, path.posix.join(data, 'repos.json')]
  const read = await readChanged(m, files, all)
  const sessionKey = (socket: unknown) => sessionMachine(m, socket)
  const keysFile = read.get(keysPath)
  const keys = keysFile ? repoKeysFromFile(JSON.stringify(keysFile)) : {}
  const links = taskPaths.map(p => linksFromTaskFile(read.get(p), sessionKey, socket => socketSession(socket, m.session || 'default'))).filter((x): x is FileLinks => x !== null && !x.archived)
  const coordinators = coordPaths.map(c => coordinatorFromFile(c.level, read.get(c.p), sessionKey, c.folder, c.session)).filter((c): c is LinkedCoordinator => c !== null)
  const reposFile = read.get(path.posix.join(data, 'repos.json'))
  return { machine: m.key, tasks: tasksFromFiles(links, keys), coordinators, repos: await reposOf(m, reposFile) }
}

// ---------------------------------------------------------------- repos
// Each repo's main checkout (data/repos.json: name -> folder): its branch and how
// many commits it is behind its upstream, as git last fetched it (nothing is
// fetched here). Asked again after REPOS_TTL_MS.
const REPOS_TTL_MS = 60_000
const REPOS_MAX = 30
// `$1` the folder. Prints `<branch>\t<behind>` (behind empty without an upstream).
export const REPO_GIT_SCRIPT = 'cd "$1" 2>/dev/null || exit 0; b=$(git symbolic-ref --short -q HEAD 2>/dev/null); '
  + 'n=$(git rev-list --count "HEAD..@{upstream}" 2>/dev/null); printf \'%s\\t%s\\n\' "$b" "$n"'
const repoCache = new Map<string, { at: number, info: RepoInfo }>()
function gitOf(m: Machine, root: string): Promise<string> {
  if (m.exec) return m.exec(REPO_GIT_SCRIPT, [root], { timeoutMs: 8000 }).then(r => r.stdout.toString('utf8'), () => '')
  return new Promise(resolve => execFile('sh', ['-c', REPO_GIT_SCRIPT, 'sh', root], { timeout: 8000, maxBuffer: 64 * 1024 }, (_e, out) => resolve(String(out || ''))))
}
async function reposOf(m: Machine, file: unknown): Promise<RepoInfo[]> {
  const o = file && typeof file === 'object' && !Array.isArray(file) ? file as Record<string, unknown> : {}
  const list = Object.entries(o).filter((e): e is [string, string] => DIR_RE.test(e[0]) && typeof e[1] === 'string' && e[1].startsWith('/')).slice(0, REPOS_MAX)
  return Promise.all(list.map(async ([repo, root]) => {
    const k = `${m.key}|${repo}|${root}`
    const hit = repoCache.get(k)
    if (hit && Date.now() - hit.at < REPOS_TTL_MS) return hit.info
    const info = { repo, root, ...parseRepoGit(await gitOf(m, root)) }
    repoCache.set(k, { at: Date.now(), info })
    return info
  }))
}

function machineLinks(m: Machine): Promise<MachineLinks> | MachineLinks | null {
  const last = caches.get(m.key)
  if (!m.local && m.status !== 'online') return last?.links ?? null
  if (last && Date.now() - last.at < REUSE_MS) return last.links
  const now = reading.get(m.key)
  if (now) return now
  const files = last?.files ?? new Map<string, Seen>()
  const job = readMachine(m, files)
    .then((links) => { caches.set(m.key, { at: Date.now(), links, files }); return links })
    .catch(() => last?.links ?? { machine: m.key, tasks: [], coordinators: [] })
    .finally(() => reading.delete(m.key))
  reading.set(m.key, job)
  return job
}

// Every board's links. `since`: the version the client has; `{ same: true }` when nothing changed.
export async function readBoardLinks(since?: string): Promise<BoardLinks | { same: true, version: string }> {
  const machines = (await Promise.all(baseMachines().map(machineLinks))).filter((x): x is MachineLinks => x !== null)
  const version = createHash('sha1').update(JSON.stringify(machines)).digest('hex').slice(0, 16)
  return since === version ? { same: true, version } : { version, machines }
}

// Tests start from an empty cache.
export function resetBoardLinks() { caches.clear(); reading.clear(); repoCache.clear() }
