// The wherdr v2 herdr-projects board, read only, when Alfred asks for it
// (`wherdr alfred v2`): its projects, as candidates for v3 projects, with their
// open tasks. The install reads nothing of it; nothing here writes.
import fs from 'node:fs'
import path from 'node:path'

type Obj = Record<string, any>
export interface BoardTask { repo: string, n?: unknown, id?: unknown, stage?: unknown, title?: unknown, description?: unknown, archivedAt?: unknown }
export interface Board { repos: Record<string, unknown>, settings: Record<string, Obj>, tasks: BoardTask[] }
export interface V2Candidate { key: string, name: string, path: string, here: boolean, base?: string, left: string[], tasks: { v2: string, stage: string, title: string, description: string }[] }

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const readJson = (f: string): unknown => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
const list = (d: string) => { try { return fs.readdirSync(d) } catch { return [] } }

// repos.json { name: path }, settings/config.json repos.<name> (key and per-repo settings),
// data/tasks/<repo>/<n>/task.json.
export function readBoard(hpDir: string): Board | null {
  const repos = readJson(path.join(hpDir, 'data', 'repos.json'))
  if (!isObj(repos)) return null
  const config = readJson(path.join(hpDir, 'settings', 'config.json'))
  const tasks: BoardTask[] = []
  const tdir = path.join(hpDir, 'data', 'tasks')
  for (const repo of list(tdir).sort()) {
    for (const n of list(path.join(tdir, repo)).sort((a, b) => Number(a) - Number(b))) {
      const t = readJson(path.join(tdir, repo, n, 'task.json'))
      if (isObj(t)) tasks.push({ ...t, repo })
    }
  }
  return { repos, settings: isObj(config) && isObj(config.repos) ? config.repos : {}, tasks }
}

// Same rules as shared/pm/project.ts (KEY_RE, BRANCH_RE).
const KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/
const BRANCH_RE = /^(?!.*\.\.)(?!.*@\{)(?!\/)(?!.*\/$)[\w./-]{1,100}$/
const DONE_STAGES = new Set(['done', 'merged', 'closed', 'cancelled', 'canceled'])

function keyFor(name: string, wanted: string, taken: Set<string>) {
  const derived = name.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^\d+/, '').slice(0, 10)
  const base = KEY_RE.test(wanted) ? wanted : KEY_RE.test(derived) ? derived : 'PRJ'
  let key = base
  for (let i = 2; taken.has(key); i++) key = `${base.slice(0, 10 - String(i).length)}${i}`
  return key
}

// Flattened setting paths of a repo: { merge: { by: 'x' } } → ['merge.by'].
const flat = (o: Obj, pre = ''): string[] => Object.entries(o || {}).flatMap(([k, v]) => (isObj(v) ? flat(v, `${pre}${k}.`) : [`${pre}${k}`]))

// How v2 showed a board task: KEY-n with the repo's key (WHR-37), else its id (app/1).
export function v2TaskName(board: Board, t: BoardTask) {
  const key = String(board.settings[t.repo]?.repo?.key || '').toUpperCase()
  const n = Number(t.n)
  return KEY_RE.test(key) && Number.isInteger(n) && n > 0 ? `${key}-${n}` : String(t.id || `${t.repo}/${t.n}`)
}

// Board repos → candidates for v3 projects. None is added here: Alfred offers
// them to the user. Each: a suggested key (free in v3), its folder on this
// machine and whether it is there, its base branch, the v2 settings to redo in
// its template, and its open tasks. `existing`: v3's projects.
export function mapCandidates(board: Board, existing: { key: string }[] = [], exists = (p: string) => fs.existsSync(p)) {
  const projects: V2Candidate[] = [], skipped: { name: string, path: string, reason: string }[] = []
  const taken = new Set(existing.map(p => p.key))
  for (const [name, folder] of Object.entries(board.repos).sort(([a], [b]) => a.localeCompare(b))) {
    if (typeof folder !== 'string' || !folder.startsWith('/')) { skipped.push({ name, path: String(folder), reason: 'not an absolute path' }); continue }
    const s = board.settings[name] || {}
    const key = keyFor(name, String(s.repo?.key || '').toUpperCase(), taken)
    taken.add(key)
    const from = s.workspace?.from
    const base = typeof from === 'string' && BRANCH_RE.test(from) ? from : undefined
    const left = flat(s).filter(k => k !== 'repo.key' && !(k === 'workspace.from' && base))
    const tasks = board.tasks
      .filter(t => t.repo === name && !t.archivedAt && !DONE_STAGES.has(String(t.stage || 'todo')))
      .map(t => ({ v2: v2TaskName(board, t), stage: String(t.stage || 'todo'), title: String(t.title || '').trim().slice(0, 200) || `Task ${v2TaskName(board, t)}`, description: String(t.description || '').slice(0, 20000) }))
    projects.push({ key, name: name.slice(0, 80), path: folder, here: exists(folder), ...(base ? { base } : {}), left, tasks })
  }
  return { projects, skipped }
}

// The v2 projects, read now from the board. A v3 project already made from one
// (same folder or name) keeps its key out of the others' way, not its own.
export function readV2Projects(hpDir: string, existing: { key: string, path: string, name: string }[] = [], exists?: (p: string) => boolean): V2Candidate[] {
  const board = readBoard(hpDir)
  if (!board) return []
  const own = new Set(Object.entries(board.repos).flatMap(([n, p]) => [n, String(p)]))
  return mapCandidates(board, existing.filter(p => !own.has(p.path) && !own.has(p.name)), exists).projects
}
