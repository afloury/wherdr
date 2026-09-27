import type { Pane } from './types'
import { isProjectThread } from './paneTitle'
import { urgency, type RepoRoot } from './spaces'

// Projets herdr-projects : un coordinateur (cwd ~/.herdr-projects/<slug>) et ses
// threads (pane `hp-<slug>-t-NNNN`, worktree du même nom). Le projet vient
// d'abord des jetons que le plugin pose sur ses panes (`hp_project`, sinon
// `hp_group`, repris dans Pane.project par le serveur), puis du nom ou du dossier.

// Nom de projet utilisable : un slug. herdr-projects met dans `hp_group` une
// valeur technique commençant par « ~ » (« ~!0003 ») pour un pane détaché de son
// projet (thread clôturé resté ouvert) : on l'ignore et on retombe sur le nom ou
// le dossier du pane.
const SLUG = /^[a-z0-9][a-z0-9._-]*$/i
const validProject = (v: unknown): string | undefined =>
  typeof v === 'string' && SLUG.test(v.trim()) ? v.trim() : undefined

// Jetons du pane dans le snapshot de Herdr (`tokens: { hp_project, hp_rank }`).
export function projectToken(tokens: unknown): string | undefined {
  const t = tokens && typeof tokens === 'object' ? tokens as Record<string, unknown> : {}
  return validProject(t.hp_project) || validProject(t.hp_group)
}

type ProjectPane = Pick<Pane, 'name' | 'cwd'> & Partial<Pick<Pane, 'project'>>

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

// Numéro du thread (t-0018 -> 18), pour un ordre stable ; null : coordinateur.
export function threadNumber(p: ProjectPane): number | null {
  if (!isProjectThread(p)) return null
  const m = (p.name && THREAD.exec(p.name)) || THREAD_DIR.exec(norm(p.cwd)) || /\/threads\/t-(\d{4,})/.exec(norm(p.cwd))
  return m ? Number(m[m.length - 1]) : null
}

export interface ProjectGroup<P> {
  key: string // slug, en minuscules
  name: string
  coordinator: P | null
  panes: P[] // coordinateur d'abord, puis les threads
  blocked: number
  working: number
}

// Agents regroupés par projet (ordre alphabétique des projets) ; les autres
// gardent leur ordre d'origine.
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

// Coordinateur d'un projet : un agent rattaché à un projet sans être un de ses
// threads (le serveur vérifie en plus que son dossier est celui du projet).
export function isCoordinator(p: ProjectPane & Pick<Pane, 'agent'>): boolean {
  return Boolean(p.agent && projectOf(p) && !isProjectThread(p))
}

// Coordinateur d'un projet sur une autre machine (les threads restent sous la
// leur) : le bloc projet de cette machine dit d'où il est coordonné et y mène.
// `all` : les agents de toutes les machines ; `machine` : celle du bloc.
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

// Le dépôt d'un thread vient d'abord du workspace rattaché au shell racine.
// Sans shell visible, le chemin du worktree donne encore un groupe repliable.
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
