// Panneau « Projet » d'un coordinateur herdr-projects, en lecture seule :
// TASKS.md du dossier du projet et `herdr-projects thread list --json`, sur la
// machine du coordinateur (locale, ou distante par la connexion SSH).
//
// Rien n'est écrit en dur : le binaire vient du plugin tel que Herdr le déclare
// (`plugin.list` : plugin_root + commande du manifeste), le dossier du projet est
// celui du coordinateur (`<root>/<slug>`), la racine est son parent.
import { execFile } from 'node:child_process'
import path from 'node:path'
import type { Pane } from '../../shared/types'
import { type ProjectBoard, normalizeThreads, parseTasks, splitThreads } from '../../shared/projectBoard'
import { projectOf } from '../../shared/projects'
import { isProjectThread } from '../../shared/paneTitle'
import { HERDR_BIN, HERDR_CHILD_ENV } from './env'
import { HerdrError, herdrOn } from './herdr'
import type { Machine } from './machines'
import { machineFor } from './actions'

const TASKS_BYTES = 256 * 1024
const REPORT_BYTES = 512 * 1024
const THREADS_BYTES = 8 * 1024 * 1024
const BIN_TTL_MS = 60000
const PLUGIN_ID = 'herdr-projects'

interface RawCommand { command?: unknown }
interface RawPluginFull {
  plugin_id?: string
  enabled?: boolean
  plugin_root?: string
  startup?: RawCommand[]
  actions?: RawCommand[]
  panes?: RawCommand[]
}

// Binaire de herdr-projects d'après le manifeste : chemin relatif à plugin_root.
export function pluginBinary(plugins: RawPluginFull[]): string | null {
  const p = (plugins || []).find(x => x && x.plugin_id === PLUGIN_ID && x.enabled !== false)
  if (!p || typeof p.plugin_root !== 'string' || !path.posix.isAbsolute(p.plugin_root)) return null
  for (const c of [...(p.startup || []), ...(p.actions || []), ...(p.panes || [])]) {
    const argv = Array.isArray(c?.command) ? c.command : []
    const bin = typeof argv[0] === 'string' ? argv[0] : ''
    if (!/(^|\/)herdr-projects$/.test(bin) || bin.split('/').includes('..')) continue
    return path.posix.isAbsolute(bin) ? bin : path.posix.join(p.plugin_root, bin)
  }
  return null
}

const bins = new Map<string, { at: number, bin: Promise<string | null> }>()
function binaryOn(m: Machine): Promise<string | null> {
  const hit = bins.get(m.key)
  if (hit && Date.now() - hit.at < BIN_TTL_MS) return hit.bin
  const bin = herdrOn<{ plugins?: RawPluginFull[] }>(m.key, 'plugin.list', {}, 8000)
    .then(r => pluginBinary(r.plugins || []))
  bin.catch(() => bins.delete(m.key))
  bins.set(m.key, { at: Date.now(), bin })
  return bin
}

// Dossier du projet d'un coordinateur : son dossier de travail, nommé comme le
// projet, avec les fichiers de herdr-projects.
async function projectDir(m: Machine, p: Pane): Promise<{ dir: string, slug: string } | null> {
  const slug = projectOf(p)
  const cwd = (p.cwd || '').replace(/\/+$/, '')
  if (!slug || !p.agent || isProjectThread(p) || !path.posix.isAbsolute(cwd)) return null
  if (path.posix.basename(cwd).toLowerCase() !== slug.toLowerCase()) return null
  const [tasks, project] = await m.fs.statMany([`${cwd}/TASKS.md`, `${cwd}/PROJECT.md`])
  if (!(tasks?.isFile || project?.isFile)) return null
  return { dir: cwd, slug: path.posix.basename(cwd) }
}

interface Target { m: Machine, dir: string, slug: string, bin: string }
async function target(pane: Pane): Promise<Target | null> {
  const m = machineFor(pane.machine)
  const bin = await binaryOn(m).catch(() => null)
  if (!bin) return null
  const where = await projectDir(m, pane)
  return where ? { m, bin, ...where } : null
}

// Version légère : TASKS.md (taille, date) et le dossier des threads, que
// herdr-projects réécrit (écritures atomiques) à chaque changement d'un thread.
async function version(t: Target): Promise<{ v: string, tasks: { size: number } | null }> {
  const [tasks, threads] = await t.m.fs.statMany([`${t.dir}/TASKS.md`, `${t.dir}/threads`])
  return { v: `${tasks ? `${tasks.size}.${tasks.mtimeMs}` : '-'}|${threads ? threads.mtimeMs : '-'}`, tasks: tasks || null }
}

function threadList(t: Target): Promise<string> {
  const root = path.posix.dirname(t.dir)
  const session = t.m.session && t.m.session !== 'default' ? t.m.session : ''
  const remote = t.m.exec
  if (remote) {
    const herdrBin = (t.m as { bin?: string }).bin || 'herdr'
    return remote('HERDR_BIN_PATH="$1" HERDR_SESSION="$2" exec "$3" --root "$4" thread list "$5" --json', [herdrBin, session, t.bin, root, t.slug], { timeoutMs: 15000 })
      .then((r) => {
        if (r.code !== 0) throw new Error(r.stderr.trim().split('\n').pop() || `code ${r.code}`)
        if (r.stdout.length > THREADS_BYTES) throw new Error('liste des threads trop longue')
        return r.stdout.toString('utf8')
      })
  }
  const env: NodeJS.ProcessEnv = { ...HERDR_CHILD_ENV, HERDR_BIN_PATH: HERDR_BIN }
  if (session) env.HERDR_SESSION = session
  return new Promise((resolve, reject) => {
    execFile(t.bin, ['--root', root, 'thread', 'list', t.slug, '--json'], { env, timeout: 15000, maxBuffer: THREADS_BYTES }, (err, out, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).trim().split('\n').pop()))
      else resolve(String(out))
    })
  })
}

export type BoardReply = ProjectBoard | { same: true, version: string } | { available: false }

export async function readProjectBoard(pane: Pane, since?: string): Promise<BoardReply> {
  const t = await target(pane)
  if (!t) return { available: false }
  const ver = await version(t)
  if (since && since === ver.v) return { same: true, version: ver.v }
  const [tasksText, threads] = await Promise.all([
    ver.tasks ? t.m.fs.read(`${t.dir}/TASKS.md`, 0, Math.min(ver.tasks.size, TASKS_BYTES)).then(b => b.toString('utf8')) : Promise.resolve(null),
    threadList(t).then(out => ({ list: normalizeThreads(JSON.parse(out)), error: undefined as string | undefined }))
      .catch((e: Error) => ({ list: [], error: e.message || 'threads illisibles' })),
  ])
  const { open, resolved } = splitThreads(threads.list)
  const board: ProjectBoard = { slug: t.slug, lists: parseTasks(tasksText || ''), open, resolved, version: ver.v }
  if (tasksText === null) board.tasksMissing = true
  if (threads.error) board.threadsError = threads.error
  return board
}

// Rapport d'un thread : copie gardée par herdr-projects dans threads/t-NNNN.md.
export async function readThreadReport(pane: Pane, id: string): Promise<{ id: string, text: string, truncated: boolean }> {
  if (!/^t-\d{4,}$/.test(id)) throw new HerdrError('bad_thread', 'thread invalide')
  const t = await target(pane)
  if (!t) throw new HerdrError('no_project', 'projet introuvable')
  const file = `${t.dir}/threads/${id}.md`
  const st = await t.m.fs.stat(file).catch(() => null)
  if (!st || !st.isFile) throw new HerdrError('no_report', 'pas de rapport pour ce thread')
  const len = Math.min(st.size, REPORT_BYTES)
  const text = (await t.m.fs.read(file, 0, len)).toString('utf8')
  return { id, text, truncated: st.size > REPORT_BYTES }
}
