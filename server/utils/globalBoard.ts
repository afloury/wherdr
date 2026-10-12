// Global Board (GET /api/board): the Project panel board of every herdr-projects
// project, in one reply. One project = one folder `<base machine>|<dir>` with at
// least one coordinator pane; the board comes from readProjectBoard.
//
// One slow, failing or offline project never fails the reply: its last board is
// shown again, marked stale. A read that outlives its deadline keeps running
// and fills the cache for the next poll.
import { createHash } from 'node:crypto'
import path from 'node:path'
import type { Pane } from '../../shared/types'
import { type BoardProject, type GlobalBoard, type GlobalBoardReply, RESOLVED_KEPT } from '../../shared/globalBoard'
import type { ProjectBoard } from '../../shared/projectBoard'
import { isCoordinator, pickCoordinator, projectOf } from '../../shared/projects'
import { readProjectBoard } from './projectBoard'
import { getState } from './state'
import { paneBaseMachine } from './threadLimits'

// Deadline of one project read. Remote machines can take much longer (binary
// lookup 8 s + thread list 15 s): the board must not wait for them.
export const READ_DEADLINE_MS = 4000
// A read that never settles is dropped after this long, so it cannot pin its project stale.
export const INFLIGHT_MAX_MS = 60_000
// A project read less than this long ago is reused: client polls must not cost
// an SSH round-trip per remote project each time.
export const REUSE_MS = 5000

interface Group { key: string, slug: string, panes: Pane[] }

// Last board read per project (null: herdr-projects missing there). `digest`
// covers the whole content: `board.version` is only a stat string and can stay
// the same while the thread list changes.
interface Cached { board: ProjectBoard | null, digest: string, at: number }
const cache = new Map<string, Cached>()
// One read per project at a time, also after its deadline passed.
const inflight = new Map<string, { read: Promise<void>, since: number }>()

// Same rule as coordinatorRoots (threadLimits.ts): a coordinator runs in `<root>/<slug>`.
function groupProjects(panes: Pane[]): Group[] {
  const groups = new Map<string, Group>()
  for (const p of panes) {
    const cwd = (p.cwd || '').replace(/\/+$/, '')
    const slug = projectOf(p)
    if (!isCoordinator(p) || !slug || !path.posix.isAbsolute(cwd)) continue
    const dirName = path.posix.basename(cwd)
    if (dirName.toLowerCase() !== slug.toLowerCase()) continue
    const key = `${paneBaseMachine(p)}|${cwd}`
    const g = groups.get(key)
    if (g) g.panes.push(p)
    else groups.set(key, { key, slug: dirName, panes: [p] })
  }
  return [...groups.values()]
}

function isOnline(machine: string | undefined): boolean {
  if (!machine) return true
  const info = getState().machines?.find(m => m.key === machine)
  return !info || info.status === 'online'
}

function startRead(key: string, pane: Pane, since: string | undefined): Promise<void> {
  const running = inflight.get(key)
  if (running && Date.now() - running.since < INFLIGHT_MAX_MS) return running.read
  const read: Promise<void> = readProjectBoard(pane, since).then((r) => {
    const at = Date.now()
    if ('same' in r) {
      // The cached board is still current: only its age restarts.
      const kept = cache.get(key)
      if (kept) kept.at = at
      return
    }
    const board = 'available' in r ? null : r
    cache.set(key, { board, digest: createHash('sha1').update(JSON.stringify(board)).digest('hex'), at })
  }).finally(() => {
    // A dropped (hung) read must not remove its replacement.
    if (inflight.get(key)?.read === read) inflight.delete(key)
  })
  inflight.set(key, { read, since: Date.now() })
  return read
}

async function withDeadline(read: Promise<void>): Promise<void> {
  const late = Promise.withResolvers<never>()
  const timer = setTimeout(() => late.reject(new Error('Board read timed out')), READ_DEADLINE_MS)
  try {
    await Promise.race([read, late.promise])
  } finally {
    clearTimeout(timer)
  }
}

async function readGroup(g: Group, refresh: boolean): Promise<BoardProject> {
  const pane = pickCoordinator(g.panes, g.slug) ?? g.panes[0]!
  const panes = [pane, ...g.panes.filter(p => p !== pane)].map(p => p.id)
  const project: BoardProject = { key: g.key, slug: g.slug, panes, board: null }
  let failure: string | undefined
  const kept = cache.get(g.key)
  if (!isOnline(pane.machine)) {
    failure = ''
  } else if (refresh || !kept || Date.now() - kept.at >= REUSE_MS) {
    try {
      await withDeadline(startRead(g.key, pane, refresh ? undefined : kept?.board?.version))
    } catch (e) {
      failure = (e as Error).message || 'Board read failed'
    }
  }
  const board = cache.get(g.key)?.board ?? null
  if (board) {
    project.board = { ...board, resolved: board.resolved.slice(0, RESOLVED_KEPT) }
    project.resolvedTotal = board.resolved.length
  }
  if (failure !== undefined) {
    project.stale = true
    if (failure) project.error = failure
  }
  return project
}

// Hashes the content digest, not `board.version`: the stat version can stay the
// same while threads change, and the client would keep the old board.
function versionOf(projects: BoardProject[]): string {
  const h = createHash('sha1')
  h.update(JSON.stringify(projects.map(p => [p.key, p.panes, cache.get(p.key)?.digest ?? null, p.stale ?? false, p.error ?? null])))
  return h.digest('hex').slice(0, 16)
}

export async function readGlobalBoard(since?: string, refresh: string[] = []): Promise<GlobalBoardReply> {
  const groups = groupProjects(getState().panes)
  const keys = new Set(groups.map(g => g.key))
  for (const k of cache.keys()) if (!keys.has(k)) cache.delete(k)
  const again = new Set(refresh)
  // readGroup never rejects: every failure becomes a stale project.
  const projects = await Promise.all(groups.map(g => readGroup(g, again.has(g.key))))
  projects.sort((a, b) => a.slug.localeCompare(b.slug) || (a.key < b.key ? -1 : 1))
  const version = versionOf(projects)
  if (since === version) return { same: true, version }
  return { version, projects } satisfies GlobalBoard
}
