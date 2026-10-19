// herdr-projects 1.x on the home list: which Herdr panes and spaces belong to
// the board, and the groups the list draws from that (one per repo: its
// project coordinator, then its tasks' agents; the machine's Coordinator and
// machine coordinator above them).
//
// What the board knows is read from its files only (server/utils/boardLinks.ts),
// never through its CLI, whose every command also runs the board's upkeep:
//  - a task's `task.json` (data/tasks/<repo>/<n>): `link.pane`, `link.workspace`
//    (`ownsWorkspace`: the board made that space for it), `link.reviewer.pane`,
//    in the session `link.socket` names;
//  - an attempt's `task.json` (data/tasks/<repo>/<n><letter>, `attemptOf`);
//  - each coordinator's `state.json` (data/coordinator/<session>/state.json,
//    `machine/state.json`, `projects/<repo>/state.json`): `pane`, `space`.
// Pure functions, tested in tests/boardLinks.test.ts.
import type { Pane, Workspace } from './types'
import { type RowGroup, type Row, rowGroup } from './spaces'
import { joinId, machineOf } from './ids'

export type PaneRole = 'worker' | 'reviewer' | 'attempt'
export interface LinkedTask {
  id: string // `<repo>/<n>`
  repo: string
  n: number
  key: string // `WHR-2`, or `#2` while the repo's key is not known
  title: string
  // Its agents' panes (app ids), with their role; `letter`: an attempt's.
  panes: { id: string, role: PaneRole, letter?: string }[]
  // The space the board made for it (app id), if any.
  workspace: string | null
  stage: string
  // The board's report: progress (0-100), the line on what it does now, and
  // when the current agent's turn on it began (ms; the reviewer's while it reviews).
  progress: number | null
  msg: string
  since: number | null
}
export type CoordinatorLevel = 'top' | 'machine' | 'project'
export interface LinkedCoordinator {
  level: CoordinatorLevel
  repo?: string // a project coordinator's
  pane: string | null // app id
  workspace: string | null // app id
}
// A repo of the board (data/repos.json) and its main checkout: its branch and
// how many commits it is behind its upstream, as git last knew it (null: unknown).
export interface RepoInfo { repo: string, root: string, branch: string, behind: number | null }
// One board (a base machine): its tasks, coordinators and repos.
export interface MachineLinks { machine: string, tasks: LinkedTask[], coordinators: LinkedCoordinator[], repos?: RepoInfo[] }
export interface BoardLinks { version: string, machines: MachineLinks[] }
export type BoardLinksReply = BoardLinks | { same: true, version: string }

type Raw = Record<string, unknown>
const obj = (v: unknown): Raw | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Raw : null)
const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '')
const PANE_LOCAL_RE = /^w[0-9a-z]+:p[0-9a-z]+$/i
const SPACE_LOCAL_RE = /^w[0-9a-z]+$/i
const REPO_RE = /^[A-Za-z0-9][\w.-]{0,79}$/
// A task folder (`12`) or an attempt's (`12a`).
export const TASK_DIR_RE = /^\d{1,7}[a-e]?$/

// The machine key of the session a socket names (null: one wherdr has not opened).
export type SessionKey = (socket: unknown) => string | null

const paneOf = (key: string | null, v: unknown) => (key !== null && typeof v === 'string' && PANE_LOCAL_RE.test(v) ? joinId(key, v) : null)
const spaceOf = (key: string | null, v: unknown) => (key !== null && typeof v === 'string' && SPACE_LOCAL_RE.test(v) ? joinId(key, v) : null)

// What a `task.json` links to. An attempt (`attemptOf`) comes back as its
// task's id with its pane as an attempt; the caller merges it into the task.
export interface FileLinks extends Pick<LinkedTask, 'stage' | 'progress' | 'msg' | 'since'> { id: string, repo: string, n: number, title: string, attemptOf: string | null, letter: string, archived: boolean, panes: LinkedTask['panes'], workspace: string | null }
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
export function linksFromTaskFile(t: unknown, sessionKey: SessionKey): FileLinks | null {
  const r = obj(t)
  if (!r) return null
  const id = str(r.id, 100)
  const m = /^([A-Za-z0-9][\w.-]{0,79})\/(\d{1,7})([a-e]?)$/.exec(id)
  if (!m) return null
  const attemptOf = m[3] ? str(r.attemptOf, 100) : ''
  if (m[3] && attemptOf !== `${m[1]}/${m[2]}`) return null
  const link = obj(r.link)
  const key = link ? sessionKey(link.socket) : null
  const panes: LinkedTask['panes'] = []
  const worker = paneOf(key, link?.pane)
  const letter = m[3] ? (str(r.letter, 1) || m[3]).toUpperCase() : ''
  if (worker) panes.push(attemptOf ? { id: worker, role: 'attempt', letter } : { id: worker, role: 'worker' })
  const reviewer = paneOf(key, obj(link?.reviewer)?.pane)
  if (reviewer) panes.push({ id: reviewer, role: 'reviewer' })
  const stage = str(r.stage, 30)
  const watch = obj(r.watch)
  const progress = num(watch?.progress)
  // When the turn on it began, as the board counts it (flow/state.rs began).
  const began = stage === 'reviewing' ? num(r.reviewAt) : Math.max(num(r.since) ?? 0, num(r.workAt) ?? 0) || null
  return {
    id: attemptOf || id, repo: m[1]!, n: Number(m[2]), title: str(r.title).replace(/\s+/g, ' ').trim(),
    attemptOf: attemptOf || null, letter, archived: Boolean(r.archivedAt),
    panes, workspace: link?.ownsWorkspace === true ? spaceOf(key, link.workspace) : null,
    stage,
    progress: progress === null ? null : Math.max(0, Math.min(100, Math.round(progress))),
    msg: (str(watch?.msg, 400) || str(r.msg, 400)).replace(/\s+/g, ' ').trim(),
    since: began && began > 0 ? began : null,
  }
}

// Tasks from their files' links: attempts merged into their task, tasks with
// nothing open in Herdr left out. `keys`: repo -> its short key.
export function tasksFromFiles(files: FileLinks[], keys: Record<string, string>): LinkedTask[] {
  const byId = new Map<string, LinkedTask>()
  const own = files.filter(f => !f.attemptOf)
  const task = (f: FileLinks): LinkedTask => ({ id: f.id, repo: f.repo, n: f.n, key: taskKeyOf(f.id, keys[f.repo]), title: f.title, panes: [...f.panes], workspace: f.workspace, stage: f.stage, progress: f.progress, msg: f.msg, since: f.since })
  for (const f of own) byId.set(f.id, task(f))
  for (const a of files.filter(f => f.attemptOf)) {
    const t = byId.get(a.id)
    // An attempt whose task is gone (or unread) still belongs to that task.
    if (t) t.panes.push(...a.panes)
    else byId.set(a.id, task(a))
  }
  return [...byId.values()].filter(t => t.panes.length || t.workspace).sort((a, b) => a.repo.localeCompare(b.repo) || b.n - a.n)
}
const taskKeyOf = (id: string, key?: string) => { const n = id.split('/')[1] || ''; return key ? `${key}-${n}` : `#${n}` }

// A coordinator's `state.json`. `repo`: a project coordinator's (its file's
// own `repo`, else its folder's name).
export function coordinatorFromFile(level: CoordinatorLevel, s: unknown, sessionKey: SessionKey, folder = ''): LinkedCoordinator | null {
  const r = obj(s)
  if (!r) return null
  const key = sessionKey(r.socket)
  const pane = paneOf(key, r.pane)
  const workspace = spaceOf(key, r.space) || spaceOf(key, r.workspace)
  if (!pane && !workspace) return null
  if (level !== 'project') return { level, pane, workspace }
  const repo = str(r.repo, 80) || folder
  return REPO_RE.test(repo) ? { level, repo, pane, workspace } : null
}

// ---------------------------------------------------------------- grouping
// The home list follows Herdr's own sidebar: a repo's group is Herdr's
// worktree group (the spaces that share its `repo_key`): the repo's own space
// (its main checkout, the plain shell herdr-projects keeps there) heads it, and
// the spaces of its linked worktrees, the tasks', hang under it. The board adds
// what Herdr does not know: which space is which task (id, title, progress),
// and the repo's project coordinator.

export interface Member {
  row: Row
  // The board's task in it; none: a worktree space of the repo the board does not own.
  task: LinkedTask | null
  // The machine whose board has that task (its Board link).
  board?: string
  role: PaneRole
  letter?: string
}
export interface ProjectSection {
  id: string // Herdr's repo_key, else `repo:<name>`
  repo: string // its name, as the board calls it (else Herdr's)
  key: string // its tasks' key (`WHR`), else ''
  info: RepoInfo | null // branch and how far behind, when known
  // The repo's own space (main checkout): the group's header. null: not open.
  space: Row | null
  coordinator: Row | null
  // Its project coordinator runs in another section (another machine or
  // session): the pane to open.
  remote: { pane: string, machine: string } | null
  // Most urgent first (your turn, working, ready), Herdr's order on a tie.
  members: Member[]
  // Agents only (the repo's shell is no state).
  sum: { blocked: number, working: number, ready: number, total: number }
  state: RowGroup
}
export interface BoardSections {
  // The machine's Coordinator, then its machine coordinator.
  coordinators: { row: Row, level: CoordinatorLevel }[]
  projects: ProjectSection[]
  // Rows that are neither the board's nor in a repo group: listed as before.
  others: Row[]
}

const rowPanes = (r: Row) => (r.kind === 'space' ? r.panes : [r.pane])
const rowSpace = (r: Row) => (r.kind === 'space' ? r.workspace.id : r.lead.workspace)
const paneRow = (p: Pane): Row => ({ kind: 'pane', key: p.id, pane: p, lead: p })
const LEVEL_ORDER: CoordinatorLevel[] = ['top', 'machine', 'project']
const GROUP_ORDER: RowGroup[] = ['blocked', 'working', 'ready']
const hasAgent = (r: Row) => rowPanes(r).some(p => p.agent)

// A section's rows (one machine, or the only one) sorted out with Herdr's
// spaces (`workspaces`) and every board's links. `live`: the pane ids Herdr
// shows now, everywhere (a coordinator's pane elsewhere is a "Coordinated
// from" link only while it is there).
// herdr-projects keeps its coordinators as tabs of one space ("herdr-projects",
// or "chat"): such a space is split into one row per coordinator, and its other
// agents, if any, are listed as before.
export function boardSections(rows: Row[], workspaces: Pick<Workspace, 'id' | 'repo' | 'repoName' | 'worktree'>[], machines: MachineLinks[], live: ReadonlySet<string>): BoardSections {
  const wsOf = new Map(workspaces.map(w => [w.id, w]))
  const coordByPane = new Map<string, LinkedCoordinator>()
  const coordBySpace = new Map<string, LinkedCoordinator>()
  const taskByPane = new Map<string, { task: LinkedTask, role: PaneRole, letter?: string }>()
  const boardOf = new Map<LinkedTask, string>()
  const taskBySpace = new Map<string, LinkedTask>()
  const repoInfo = new Map<string, RepoInfo>()
  for (const m of machines) {
    for (const c of m.coordinators) {
      if (c.pane) coordByPane.set(c.pane, c)
      if (c.workspace && !coordBySpace.has(c.workspace)) coordBySpace.set(c.workspace, c)
    }
    for (const t of m.tasks) {
      boardOf.set(t, m.machine)
      for (const p of t.panes) if (!taskByPane.has(p.id)) taskByPane.set(p.id, { task: t, role: p.role, letter: p.letter })
      if (t.workspace && !taskBySpace.has(t.workspace)) taskBySpace.set(t.workspace, t)
    }
    for (const r of m.repos || []) if (!repoInfo.has(r.repo)) repoInfo.set(r.repo, r)
  }
  const out: BoardSections = { coordinators: [], projects: [], others: [] }

  // 1. Who each row is: a coordinator, a task, a repo space, or none of these.
  type Sorted = { row: Row, coord?: LinkedCoordinator, task?: { task: LinkedTask, role: PaneRole, letter?: string } }
  const sorted: Sorted[] = []
  for (const row of rows) {
    const panes = rowPanes(row)
    const coordPanes = panes.filter(p => coordByPane.has(p.id))
    // Coordinators by their panes: one row each; the space's other agents stay listed.
    if (coordPanes.length && row.kind === 'space' && (coordPanes.length > 1 || panes.some(p => p.agent && !coordByPane.has(p.id)))) {
      for (const p of coordPanes) sorted.push({ row: paneRow(p), coord: coordByPane.get(p.id) })
      for (const p of panes) if (p.agent && !coordByPane.has(p.id)) sorted.push({ row: paneRow(p) })
      continue
    }
    // A coordinator alone in its space (or known by its space): the whole row.
    const coord = (coordPanes[0] && coordByPane.get(coordPanes[0].id)) || coordBySpace.get(rowSpace(row))
    if (coord) { sorted.push({ row, coord }); continue }
    // A task's agent: the pane that leads the row, else any of its panes, else its space.
    const hit = taskByPane.get(row.lead.id) || panes.map(p => taskByPane.get(p.id)).find(Boolean)
    const task = hit?.task || taskBySpace.get(rowSpace(row))
    if (!task) { sorted.push({ row }); continue }
    // A space that holds the task's worker is the task itself, whatever leads it.
    const worker = panes.some(p => taskByPane.get(p.id)?.task === task && taskByPane.get(p.id)?.role === 'worker')
    const role = worker || !hit || hit.task !== task ? 'worker' : hit.role
    sorted.push({ row, task: { task, role, ...(role === 'attempt' && hit?.letter ? { letter: hit.letter } : {}) } })
  }

  // 2. A repo's group id: Herdr's repo_key, learnt from its tasks' spaces and its
  // main checkout's folder; `repo:<name>` while Herdr shows none of its spaces.
  const idOfName = new Map<string, string>()
  const nameOfId = new Map<string, string>()
  const learn = (name: string, id: string | undefined) => {
    if (!id || idOfName.has(name)) return
    idOfName.set(name, id)
    if (!nameOfId.has(id)) nameOfId.set(id, name)
  }
  for (const s of sorted) if (s.task) learn(s.task.task.repo, wsOf.get(rowSpace(s.row))?.repo)
  for (const r of repoInfo.values()) {
    const w = workspaces.find(x => x.repo && !x.worktree && (x.repo === r.root || x.repo === `${r.root}/.git`))
    learn(r.repo, w?.repo)
  }
  const groupId = (name: string) => idOfName.get(name) || `repo:${name}`
  const groups = new Map<string, ProjectSection>()
  const group = (id: string, name?: string) => {
    let g = groups.get(id)
    if (!g) {
      const repo = name || nameOfId.get(id) || workspaces.find(w => w.repo === id)?.repoName || id
      g = { id, repo, key: '', info: repoInfo.get(repo) || null, space: null, coordinator: null, remote: null, members: [], sum: { blocked: 0, working: 0, ready: 0, total: 0 }, state: 'ready' }
      groups.set(id, g)
      out.projects.push(g)
    }
    return g
  }
  // Repos with a group: the board's (a task, a coordinator, its repos list) and
  // Herdr's worktree groups that have a linked space open.
  const linked = new Set(workspaces.filter(w => w.repo && w.worktree).map(w => w.repo!))

  // 3. Placed in Herdr's order.
  for (const s of sorted) {
    if (s.coord) {
      if (s.coord.level !== 'project') { out.coordinators.push({ row: s.row, level: s.coord.level }); continue }
      const g = group(groupId(s.coord.repo!), s.coord.repo)
      if (!g.coordinator) { g.coordinator = s.row; continue }
      out.others.push(s.row)
      continue
    }
    if (s.task) {
      const t = s.task
      group(groupId(t.task.repo), t.task.repo).members.push({ row: s.row, task: t.task, board: boardOf.get(t.task) ?? '', role: t.role, ...(t.letter ? { letter: t.letter } : {}) })
      continue
    }
    const w = wsOf.get(rowSpace(s.row))
    const known = w?.repo && (nameOfId.has(w.repo) || linked.has(w.repo))
    if (w?.repo && known) {
      const g = group(w!.repo!)
      if (!w!.worktree && !g.space) { g.space = s.row; continue }
      if (w!.worktree) { g.members.push({ row: s.row, task: null, role: 'worker' }); continue }
    }
    out.others.push(s.row)
  }
  out.coordinators.sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level))
  const mine = new Set<string>()
  for (const row of rows) for (const p of rowPanes(row)) mine.add(p.id)
  for (const g of out.projects) {
    g.key = g.members.map(m => m.task && /^([A-Z][A-Z0-9]{1,4})-\d/.exec(m.task.key)?.[1]).find(Boolean) || ''
    // Stable sort: most urgent first, Herdr's order on a tie.
    g.members = g.members.map((m, i) => ({ m, i })).sort((a, b) => GROUP_ORDER.indexOf(rowGroup(a.m.row)) - GROUP_ORDER.indexOf(rowGroup(b.m.row)) || a.i - b.i).map(x => x.m)
    if (!g.coordinator) {
      // Coordinated from elsewhere: a project coordinator of that repo that Herdr shows, outside this section.
      const far = machines.flatMap(m => m.coordinators).find(c => c.level === 'project' && c.repo === g.repo && c.pane && live.has(c.pane) && !mine.has(c.pane))
      if (far?.pane) g.remote = { pane: far.pane, machine: machineOf(far.pane) }
    }
    for (const r of [...(g.space ? [g.space] : []), ...(g.coordinator ? [g.coordinator] : []), ...g.members.map(m => m.row)]) {
      if (!hasAgent(r)) continue
      g.sum.total++
      g.sum[rowGroup(r)]++
    }
    g.state = g.sum.blocked ? 'blocked' : g.sum.working ? 'working' : 'ready'
  }
  return out
}

// The board's tasks whose agents a set of spaces holds (what closing them stops).
export function tasksIn(spaces: string[], panes: Pick<Pane, 'id' | 'workspace'>[], machines: MachineLinks[]): LinkedTask[] {
  const set = new Set(spaces)
  const inside = new Set(panes.filter(p => set.has(p.workspace)).map(p => p.id))
  const out: LinkedTask[] = []
  for (const m of machines) for (const t of m.tasks) {
    if ((t.workspace && set.has(t.workspace)) || t.panes.some(p => inside.has(p.id))) out.push(t)
  }
  return out
}

// What a card of the board says (app/components/AgentCard.vue `board`).
export interface BoardCard { tag: string, name?: string, progress?: number | null, since?: number | null, msg?: string, onBoard?: () => void }

// What a member's card says before its title: `WHR-2`, `WHR-2 · review`, `WHR-2 · A`.
export function memberTag(m: Pick<Member, 'task' | 'role' | 'letter'>, review: string): string {
  if (!m.task) return ''
  if (m.role === 'reviewer') return `${m.task.key} · ${review}`
  if (m.role === 'attempt' && m.letter) return `${m.task.key} · ${m.letter}`
  return m.task.key
}

// Time on a task as Herdr's sidebar shows it: `45s`, `17m`, `2h05`, `3d`.
export function elapsedLabel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h${String(m % 60).padStart(2, '0')}`
  return `${Math.floor(h / 24)}d`
}

// `<branch>\t<behind>` (server/utils/boardLinks.ts REPO_GIT_SCRIPT).
export function parseRepoGit(text: string): Pick<RepoInfo, 'branch' | 'behind'> {
  const [b = '', n = ''] = (text.split('\n')[0] || '').split('\t')
  const branch = /^[\w./-]{1,120}$/.test(b.trim()) ? b.trim() : ''
  const behind = /^\d{1,7}$/.test(n.trim()) ? Number(n.trim()) : null
  return { branch, behind }
}
