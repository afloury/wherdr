// Threads tab of the Project panel: one thread's record (`herdr-projects thread
// show --json`) and the commands run on it (`thread stop|restart|ack|resolve`).
// Pure functions, tested in tests/projectThreads.test.ts.
// Options checked against herdr-projects 0.2.34 (`thread <command> --help`):
// every command takes `<SLUG> <ID>`; none takes a session (the Herdr session
// comes from the environment). The Next list is the `next` array of `show
// --json` (`thread next` prints the same lines as text only).
import { type ProjectThread, normalizeThreads } from './projectBoard'

export const THREAD_ID_RE = /^t-\d{4,}$/
// A project folder name passed as an argument: never an option ("-…") or a path.
export const PROJECT_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/
export const projectSlugOk = (slug: string) => PROJECT_SLUG_RE.test(slug) && !slug.includes('..')

export const THREAD_ACTIONS = ['stop', 'restart', 'ack', 'resolve'] as const
export type ThreadAction = typeof THREAD_ACTIONS[number]
export const isThreadAction = (v: unknown): v is ThreadAction => (THREAD_ACTIONS as readonly unknown[]).includes(v)

// Hard to undo: asked twice. `stop` interrupts the agent's turn; `resolve`
// removes the thread's worktree, merged branch and tab.
export const CONFIRMED_ACTIONS: readonly ThreadAction[] = ['stop', 'resolve']

// `resolve` makes a final copy (over SSH for a thread on another machine) and
// runs git; `restart` reopens a worktree and a pane.
export const THREAD_TIMEOUT_MS: Record<ThreadAction | 'show', number> = { show: 15000, stop: 20000, ack: 15000, restart: 90000, resolve: 180000 }

// argv of the herdr-projects command; never a shell, each value is one
// argument. Throws on an identifier that could be read as anything else.
export function threadCommandArgs(command: ThreadAction | 'show', root: string, slug: string, id: string): string[] {
  if (!root.startsWith('/')) throw new Error('invalid projects root')
  if (!projectSlugOk(slug)) throw new Error('invalid project')
  if (!THREAD_ID_RE.test(id)) throw new Error('invalid thread')
  if (command !== 'show' && !isThreadAction(command)) throw new Error('invalid action')
  return ['--root', root, 'thread', command, slug, id, ...(command === 'show' ? ['--json'] : [])]
}

export interface ThreadDetail extends ProjectThread {
  note: string // herdr-projects' note on the group ("done, on <machine>", "manual")
  error: string // last start or launch error
  kind: string // worktree | tab
  agent: string // harness (claude, codex, omp…)
  branch: string
  base: string
  prState: string
  prReview: string
  next: string[] // the thread's Next list, in order
  acked: boolean // the current report was already acknowledged
  hasPane: boolean
  keptWorktree: boolean
  resolvedReason: string
}

type Raw = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const NEXT_MAX = 20

export function normalizeThreadDetail(raw: unknown): ThreadDetail | null {
  const base = normalizeThreads([raw])[0]
  if (!base) return null
  const r = raw as Raw
  const hash = str(r.report_hash)
  return {
    ...base,
    note: str(r.note).trim(),
    error: str(r.error).trim().slice(0, 600),
    kind: str(r.kind),
    agent: str(r.agent),
    branch: str(r.branch),
    base: str(r.base),
    prState: str(r.pr_state),
    prReview: str(r.pr_review),
    next: (Array.isArray(r.next) ? r.next : []).filter((x): x is string => typeof x === 'string' && Boolean(x.trim())).slice(0, NEXT_MAX).map(x => x.trim().slice(0, 300)),
    acked: Boolean(hash) && str(r.acked_report_hash) === hash,
    hasPane: Boolean(str(r.pane_id)),
    keptWorktree: r.kept_worktree === true,
    resolvedReason: str(r.resolved_reason),
  }
}

// Actions offered on a thread. herdr-projects has the last word (it refuses a
// restart of a running agent, for instance); this only hides what cannot apply:
//  - stop: an agent is working in a pane;
//  - restart: an open thread that is not working (pane gone, failed start);
//  - ack: a report not acknowledged yet;
//  - resolve: any open thread.
export function threadActionsFor(th: Pick<ThreadDetail, 'resolved' | 'token' | 'report' | 'acked' | 'hasPane'>): ThreadAction[] {
  if (th.resolved) return []
  const out: ThreadAction[] = []
  if (th.report && !th.acked) out.push('ack')
  if (th.token === 'working' && th.hasPane) out.push('stop')
  if (th.token !== 'working') out.push('restart')
  out.push('resolve')
  return out
}

// Text typed in the Threads filter: every word must be in the ID, the title,
// the machine or the profile (case and accents ignored).
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
export function filterThreads<T extends Pick<ProjectThread, 'id' | 'title' | 'machine' | 'profile'>>(list: T[], query: string): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return list
  return list.filter((th) => {
    const hay = fold(`${th.id} ${th.title} ${th.machine} ${th.profile}`)
    return words.every(w => hay.includes(w))
  })
}

// Open threads under their herdr-projects group, in its order (Waiting on you
// first: `list` is already sorted by rank, see splitThreads).
export interface ThreadGroup<T> { token: string, group: string, threads: T[] }
export function groupThreads<T extends Pick<ProjectThread, 'token' | 'group'>>(list: T[]): ThreadGroup<T>[] {
  const groups: ThreadGroup<T>[] = []
  for (const th of list) {
    const known = groups.find(g => g.token === th.token)
    if (known) known.threads.push(th)
    else groups.push({ token: th.token, group: th.group, threads: [th] })
  }
  return groups
}

// Last useful line of a command's output, for a toast or an error.
export function lastLine(text: string): string {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  return (lines[lines.length - 1] || '').replace(/^error:\s*/i, '').slice(0, 400)
}
