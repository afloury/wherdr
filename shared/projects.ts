import type { Pane } from './types'
import { isProjectThread } from './paneTitle'
import { type RepoRoot, type Row, urgency } from './spaces'

// herdr-projects projects: a coordinator (cwd ~/.herdr-projects/<slug>) and its
// threads (pane `hp-<slug>-t-NNNN`, worktree of the same name). The project comes
// first from the tokens the plugin puts on its panes (`hp_project`, otherwise
// `hp_group`, copied into Pane.project by the server), then from the name or folder.

// Usable project name: a slug. herdr-projects puts in `hp_group` a
// technical value starting with "~" ("~!0003") for a pane detached from its
// project (closed thread left open): we ignore it and fall back on the pane's
// name or folder.
const SLUG = /^[a-z0-9][a-z0-9._-]*$/i
const validProject = (v: unknown): string | undefined =>
  typeof v === 'string' && SLUG.test(v.trim()) ? v.trim() : undefined

// Pane tokens in Herdr's snapshot (`tokens: { hp_project, hp_rank }`).
export function projectToken(tokens: unknown): string | undefined {
  const t = tokens && typeof tokens === 'object' ? tokens as Record<string, unknown> : {}
  return validProject(t.hp_project) || validProject(t.hp_group)
}

type ProjectPane = Pick<Pane, 'name' | 'cwd'> & Partial<Pick<Pane, 'project' | 'hpThread'>>

const norm = (cwd: string | null | undefined) => (cwd || '').replace(/\\/g, '/').replace(/\/+$/, '')
const THREAD = /^hp-(.+?)-t-(\d{4,})(?:-|$)/i
const THREAD_DIR = /\/\.herdr\/worktrees\/[^/]+\/hp-(.+?)-t-(\d{4,})(?:-[^/]*)?(?:\/|$)/i
const PROJECT_DIR = /\/\.herdr-projects\/([^/]+)(?:\/|$)/

export function projectOf(p: ProjectPane): string | null {
  const token = validProject(p.project)
  if (token) return token
  const byName = p.name && THREAD.exec(p.name)
  if (byName) return byName[1]!
  const cwd = norm(p.cwd)
  return THREAD_DIR.exec(cwd)?.[1] || PROJECT_DIR.exec(cwd)?.[1] || null
}

// Thread number (t-0018 -> 18), for a stable order; null: coordinator.
export function threadNumber(p: ProjectPane): number | null {
  if (!isProjectThread(p)) return null
  const m = (p.hpThread && /\/t-(\d{4,})$/i.exec(p.hpThread)) || (p.name && THREAD.exec(p.name)) || THREAD_DIR.exec(norm(p.cwd)) || /\/threads\/t-(\d{4,})/.exec(norm(p.cwd))
  return m ? Number(m[m.length - 1]) : null
}

export interface ProjectGroup<P> {
  key: string // slug, en minuscules
  name: string
  coordinator: P | null
  panes: P[] // coordinator first, then the threads
  blocked: number
  working: number
}

// Agents grouped by project (alphabetical order of projects); the others
// keep their original order.
export function groupByProject<P extends ProjectPane & Pick<Pane, 'status'>>(list: P[]): { projects: ProjectGroup<P>[], others: P[] } {
  const byKey = new Map<string, { name: string, coord: P[], threads: P[] }>()
  const others: P[] = []
  for (const p of list) {
    const name = projectOf(p)
    if (!name) {
      others.push(p)
      continue
    }
    const key = name.toLowerCase()
    const g = byKey.get(key) || { name, coord: [], threads: [] }
    byKey.set(key, g)
    ;(isProjectThread(p) ? g.threads : g.coord).push(p)
  }
  const projects = [...byKey.entries()].map(([key, g]) => {
    const coordinator = g.coord.find(p => norm(p.cwd).toLowerCase().endsWith(`/.herdr-projects/${key}`)) || g.coord[0] || null
    const threads = g.threads
      .map((p, i) => ({ p, i, n: threadNumber(p) }))
      .sort((a, b) => (a.n ?? Infinity) - (b.n ?? Infinity) || a.i - b.i)
      .map(x => x.p)
    const panes = [...(coordinator ? [coordinator] : []), ...g.coord.filter(p => p !== coordinator), ...threads]
    return {
      key,
      name: g.name,
      coordinator,
      panes,
      blocked: panes.filter(p => p.status === 'blocked').length,
      working: panes.filter(p => p.status === 'working').length,
    }
  }).sort((a, b) => a.key.localeCompare(b.key))
  return { projects, others }
}

// Coordinator of a project: an agent attached to a project without being one of its
// threads (the server also checks that its folder is the project's).
export function isCoordinator(p: ProjectPane & Pick<Pane, 'agent'>): boolean {
  return Boolean(p.agent && projectOf(p) && !isProjectThread(p))
}

// herdr-projects can open a thread as a tab of its coordinator's space
// (`--kind tab`). The space stays one card, the coordinator's: it represents
// the space (name, state, preview, mini-map, tab opened by default) even when
// a thread tab is more urgent, so the card keeps its place at the top of its
// project. The thread is only seen in the space's tabs.
export function leadByCoordinator(rows: Row[]): Row[] {
  return rows.map((r) => {
    if (r.kind !== 'space') return r
    const lead = r.panes.find(isCoordinator)
    if (!lead || lead === r.lead) return r
    return { ...r, lead, leadTab: r.tabs.find(e => e.panes.includes(lead))! }
  })
}

// Coordinator of a project on another machine (threads stay under
// their own): this machine's project block says where it is coordinated from and links there.
// `all`: agents of all machines; `machine`: the block's machine.
export function remoteCoordinator<P extends ProjectPane & Pick<Pane, 'agent'> & Partial<Pick<Pane, 'machine'>>>(
  group: Pick<ProjectGroup<P>, 'key' | 'coordinator'>, all: P[], machine: string,
): P | null {
  if (group.coordinator) return null
  return all.find(p => (p.machine || '') !== machine && isCoordinator(p) && projectOf(p)!.toLowerCase() === group.key) || null
}

export interface ProjectRepo<P> {
  key: string
  name: string
  root: RepoRoot | null
  worktrees: number
  panes: P[]
  blocked: number
  working: number
}

// A thread's repository comes first from the workspace attached to the root shell.
// Without a visible shell, the worktree path still gives a collapsible group.
export function projectSections<P extends ProjectPane & Pick<Pane, 'workspace' | 'agent' | 'status'>>(
  group: ProjectGroup<P>, roots: RepoRoot[],
): { coordinator: P | null, repos: ProjectRepo<P>[], others: P[] } {
  const repos: ProjectRepo<P>[] = roots.map(root => ({
    key: root.row.lead.cwd || root.row.key, name: root.name, root,
    worktrees: root.worktrees.length, panes: [], blocked: 0, working: 0,
  }))
  const others: P[] = []
  for (const p of group.panes) {
    if (p === group.coordinator) continue
    if (!isProjectThread(p)) { others.push(p); continue }
    let repo = repos.find(r => r.root?.worktrees.includes(p.workspace))
    if (!repo) {
      const match = /^(.*?)\/\.herdr\/worktrees\/([^/]+)\/[^/]+/.exec(norm(p.cwd))
      if (match) {
        const key = `${match[1]}/.herdr/worktrees/${match[2]}`
        repo = repos.find(r => r.key === key)
        if (!repo) {
          repo = { key, name: match[2]!, root: null, worktrees: 0, panes: [], blocked: 0, working: 0 }
          repos.push(repo)
        }
      }
    }
    if (repo) repo.panes.push(p)
    else others.push(p)
  }
  const byUrgency = (a: P, b: P) => urgency(a) - urgency(b)
  for (const repo of repos) {
    repo.panes.sort(byUrgency)
    repo.blocked = repo.panes.filter(p => p.status === 'blocked').length
    repo.working = repo.panes.filter(p => p.status === 'working').length
    if (!repo.root) repo.worktrees = new Set(repo.panes.map(p => p.workspace)).size
  }
  others.sort(byUrgency)
  return { coordinator: group.coordinator, repos: repos.filter(r => r.panes.length), others }
}
