// Global Board: every herdr-projects project (its coordinator), its threads and
// TASKS.md tasks, and every agent pane, in four columns. Built on the Project
// panel (shared/projectBoard.ts): same TASKS.md lists, thread tokens and
// messages; the server reads one ProjectBoard per project (server/utils/globalBoard.ts).
// Pure functions, tested in tests/globalBoard.test.ts.
import type { Pane } from './types'
import {
  type ListKind, type MoveAction, type ProjectBoard, type ProjectTask, type ProjectThread, type TestLang,
  boardSections, launchMessage, moveMessage, reviewedMessage, testedMessage, unblockMessage,
} from './projectBoard'
import { isCoordinator, pickCoordinator, projectOf } from './projects'
import { paneGroup } from './spaces'

export type BoardColumn = 'blocked' | 'todo' | 'ongoing' | 'finished'
export const BOARD_COLUMNS: readonly BoardColumn[] = ['blocked', 'todo', 'ongoing', 'finished']

// ---------------------------------------------------------------- server reply
// GET /api/board: one entry per project folder that has a coordinator pane.
export interface BoardProject {
  key: string // `<base machine>|<project folder>`, stable across reads
  slug: string
  panes: string[] // coordinator panes in that folder, the preferred first
  board: ProjectBoard | null // null: herdr-projects missing on that machine, or never read
  resolvedTotal?: number // resolved threads before the server kept the RESOLVED_KEPT most recent
  stale?: boolean // machine offline or read failed: the last board read
  error?: string
}
export interface GlobalBoard { version: string, projects: BoardProject[] }
export type GlobalBoardReply = GlobalBoard | { same: true, version: string }
export const RESOLVED_KEPT = 20

// ---------------------------------------------------------------- columns
type ColumnPane = Pick<Pane, 'agent' | 'status'> & Partial<Pick<Pane, 'restart' | 'pendingPrompt'>>

// An agent pane: Your turn → Blocked; working, starting or restarting → Ongoing;
// done, idle or unknown (the agent list's "Ready") → Finished.
export function paneColumn(p: ColumnPane): BoardColumn {
  const group = paneGroup(p)
  if (group === 'blocked') return 'blocked'
  const restarting = Boolean(p.restart && p.restart.phase !== 'failed')
  const starting = Boolean(p.agent && (p.status || 'unknown') === 'unknown' && p.pendingPrompt)
  return group === 'working' || restarting || starting ? 'ongoing' : 'finished'
}

// A TASKS.md task: Blocked list → Blocked; In progress → Ongoing; Done or
// checked → Finished; every other list (the user's checks included) → To do.
export function taskColumn(kind: ListKind | null, task: Pick<ProjectTask, 'done'>): BoardColumn {
  if (task.done || kind === 'done') return 'finished'
  if (kind === 'blocked') return 'blocked'
  if (kind === 'doing') return 'ongoing'
  return 'todo'
}

// A herdr-projects thread: its live panes first, then its group token.
export function threadColumn(th: Pick<ProjectThread, 'token' | 'resolved'>, panes: ColumnPane[]): BoardColumn {
  if (th.resolved) return 'finished'
  const live = panes.map(paneColumn)
  if (live.includes('blocked')) return 'blocked'
  if (live.includes('ongoing')) return 'ongoing'
  if (th.token === 'waiting-on-you') return 'blocked'
  if (th.token === 'ready-for-review') return 'todo'
  return 'ongoing'
}

// A project: the most urgent column among its coordinator and its cards.
const PRECEDENCE: readonly BoardColumn[] = ['blocked', 'ongoing', 'todo', 'finished']
export function rollUp(columns: Iterable<BoardColumn>): BoardColumn {
  let best = PRECEDENCE.length - 1
  for (const c of columns) best = Math.min(best, PRECEDENCE.indexOf(c))
  return PRECEDENCE[best]!
}

// ---------------------------------------------------------------- moves
// A task card moved to another column sends the Project panel's message when
// one says it (Launch now, Launch, Unblock, Tested, Reviewed), otherwise a
// Board move (Mark blocked, Move to To do, Mark done). To decide needs an answer:
// no move. The coordinator edits TASKS.md; the card moves on the next read.
export type BoardAction = MoveAction | 'launch' | 'unblock' | 'tested' | 'reviewed'
export interface BoardMove { to: BoardColumn, action: BoardAction }

export function boardMoves(kind: ListKind | null, done: boolean): BoardMove[] {
  let m: Partial<Record<BoardColumn, BoardAction>>
  if (done || kind === 'done') m = { todo: 'todo' }
  else if (kind === 'blocked') m = { todo: 'todo', ongoing: 'unblock', finished: 'done' }
  else if (kind === 'doing') m = { blocked: 'block', todo: 'todo', finished: 'done' }
  else if (kind === 'backlog') m = { blocked: 'block', ongoing: 'launch', finished: 'done' }
  else if (kind === 'test') m = { finished: 'tested' }
  else if (kind === 'review') m = { finished: 'reviewed' }
  else if (kind === 'decide') m = {}
  else m = { blocked: 'block', ongoing: 'now', finished: 'done' } // To do, In queue, unknown lists
  return BOARD_COLUMNS.flatMap((to) => {
    const action = m[to]
    return action ? [{ to, action }] : []
  })
}

export function boardMoveMessage(action: BoardAction, task: string, lang: TestLang): string {
  if (action === 'launch') return launchMessage(task, lang)
  if (action === 'unblock') return unblockMessage(task, lang)
  if (action === 'tested') return testedMessage(task, lang)
  if (action === 'reviewed') return reviewedMessage(task, lang)
  return moveMessage(action, task, lang)
}

// ---------------------------------------------------------------- cards
interface CardBase {
  key: string
  column: BoardColumn
  // Cards of one project share it (the project's key); '' outside projects.
  segment: string
  // Project name shown on the card; null outside projects.
  project: string | null
}
export interface ProjectCard extends CardBase {
  kind: 'project'
  coordinator: Pane
  board: ProjectBoard | null
  resolvedTotal: number
  stale: boolean
  error: string
  // The project's other cards per column (its threads, tasks and agents).
  counts: Record<BoardColumn, number>
}
export interface ThreadCard extends CardBase { kind: 'thread', coordinator: Pane, thread: ProjectThread, panes: Pane[] }
export interface TaskCard extends CardBase { kind: 'task', coordinator: Pane, task: ProjectTask, list: ListKind | null, listTitle: string, moves: BoardMove[] }
export interface AgentCard extends CardBase { kind: 'agent', pane: Pane }
export type BoardCard = ProjectCard | ThreadCard | TaskCard | AgentCard

// Panes shown on the Board: agents, and agents restarting (briefly without one).
const isBoardAgent = (p: Pane) => Boolean(p.agent || (p.restart && p.restart.phase !== 'failed'))

// The live agent panes of a herdr-projects thread: those carrying its token
// (`hpThread` = `<slug>/t-NNNN`, tab threads included); otherwise, for a pane
// left without its token, the thread's pane name, on `machine` first.
export function threadPanesOf(thread: Pick<ProjectThread, 'id' | 'agentName'>, slug: string, panes: Pane[], machine = ''): Pane[] {
  const agents = panes.filter(isBoardAgent)
  const ref = `${slug.toLowerCase()}/${thread.id.toLowerCase()}`
  const tagged = agents.filter(p => p.hpThread === ref)
  if (tagged.length || !thread.agentName) return tagged
  const named = agents.filter(p => !p.hpThread && p.name === thread.agentName)
  const pick = named.find(p => (p.machine || '') === machine) || named[0]
  return pick ? [pick] : []
}

interface Segment { key: string, slug: string, machine: string, project: BoardProject | null, coordinator: Pane | null, cards: BoardCard[] }

// Cards in display order: projects by name (then machine), each with its project
// card, open threads, tasks (Project panel order), resolved threads and its other
// agents; then the agents outside projects, in list order. Each agent pane is on
// exactly one card. `projects`: the server's reply (null before the first read);
// a coordinator without one gets a project card without a board.
export function buildGlobalBoard(projects: BoardProject[] | null, panes: Pane[]): BoardCard[] {
  const byId = new Map(panes.map(p => [p.id, p]))
  const segments: Segment[] = []
  const covered = new Set<string>()
  for (const project of projects || []) {
    const coordinator = project.panes.map(id => byId.get(id)).find(p => p !== undefined && isCoordinator(p))
    if (!coordinator) continue // another session's project, or gone
    covered.add(project.slug.toLowerCase())
    segments.push({ key: project.key, slug: project.slug, machine: coordinator.machine || '', project, coordinator, cards: [] })
  }
  for (const p of panes) {
    const slug = isCoordinator(p) ? projectOf(p)! : null
    if (!slug || covered.has(slug.toLowerCase())) continue
    covered.add(slug.toLowerCase())
    const coordinator = pickCoordinator(panes, slug)!
    segments.push({ key: `pane:${coordinator.id}`, slug, machine: coordinator.machine || '', project: null, coordinator, cards: [] })
  }

  const used = new Set<string>()
  const agents = panes.filter(isBoardAgent)
  for (const s of segments) used.add(s.coordinator!.id)
  // A pane of a project belongs to that project on its own machine when there is
  // one (two folders of the same name number their threads alike), else to the first.
  const ownerOf = (p: Pane, slug: string) => {
    const mine = segments.filter(s => s.slug.toLowerCase() === slug.toLowerCase())
    return mine.find(s => s.machine === (p.machine || '')) || mine[0]
  }

  for (const s of segments) {
    const board = s.project?.board
    if (!board) continue
    const coordinator = s.coordinator!
    const threadCard = (thread: ProjectThread): ThreadCard => {
      let live = threadPanesOf(thread, s.slug, agents.filter(p => !used.has(p.id) && ownerOf(p, s.slug) === s), s.machine)
      // A resolved thread keeps only its finished panes: a pane still at work stays an agent card.
      if (thread.resolved) live = live.filter(p => paneColumn(p) === 'finished')
      for (const p of live) used.add(p.id)
      return { kind: 'thread', key: `${s.key}|${thread.id}`, column: threadColumn(thread, live), segment: s.key, project: s.slug, coordinator, thread, panes: live }
    }
    s.cards.push(...board.open.map(threadCard))
    const seen = new Map<string, number>()
    for (const section of boardSections(board, { doing: '', done: '' })) {
      for (const task of section.tasks) {
        const id = `${section.key}|${task.text}`
        const n = seen.get(id) || 0
        seen.set(id, n + 1)
        s.cards.push({
          kind: 'task', key: `${s.key}|${id}|${n}`, column: taskColumn(section.kind, task), segment: s.key, project: s.slug,
          coordinator, task, list: section.kind, listTitle: section.title, moves: boardMoves(section.kind, task.done),
        })
      }
    }
    s.cards.push(...board.resolved.map(threadCard))
  }

  const outside: AgentCard[] = []
  for (const p of agents) {
    if (used.has(p.id)) continue
    const slug = projectOf(p)
    const agent: AgentCard = { kind: 'agent', key: `pane:${p.id}`, column: paneColumn(p), segment: '', project: slug, pane: p }
    if (!slug) {
      outside.push(agent)
      continue
    }
    let s = ownerOf(p, slug)
    if (!s) {
      s = { key: `slug:${slug.toLowerCase()}`, slug, machine: p.machine || '', project: null, coordinator: null, cards: [] }
      segments.push(s)
    }
    s.cards.push({ ...agent, segment: s.key, project: s.slug })
  }

  segments.sort((a, b) => a.slug.toLowerCase().localeCompare(b.slug.toLowerCase()) || a.machine.localeCompare(b.machine))
  const out: BoardCard[] = []
  for (const s of segments) {
    if (s.coordinator) {
      const counts: Record<BoardColumn, number> = { blocked: 0, todo: 0, ongoing: 0, finished: 0 }
      for (const c of s.cards) counts[c.column]++
      out.push({
        kind: 'project', key: `project:${s.key}`, segment: s.key, project: s.slug, coordinator: s.coordinator,
        column: rollUp([paneColumn(s.coordinator), ...s.cards.map(c => c.column)]),
        board: s.project?.board || null, resolvedTotal: s.project?.resolvedTotal ?? s.project?.board?.resolved.length ?? 0,
        stale: Boolean(s.project?.stale), error: s.project?.error || '', counts,
      })
    }
    out.push(...s.cards)
  }
  return [...out, ...outside]
}

// Finished column: per project, the first `n` resolved threads (most recent first)
// and the first `n` done tasks; project and agent cards always show.
export function capFinished(cards: BoardCard[], n: number): { cards: BoardCard[], hidden: number } {
  const taken = new Map<string, number>()
  let hidden = 0
  const kept = cards.filter((c) => {
    if (c.column !== 'finished' || (c.kind !== 'thread' && c.kind !== 'task')) return true
    const id = `${c.segment}|${c.kind}`
    const k = taken.get(id) || 0
    taken.set(id, k + 1)
    if (k < n) return true
    hidden++
    return false
  })
  return { cards: kept, hidden }
}
