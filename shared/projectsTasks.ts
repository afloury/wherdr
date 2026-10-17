// herdr-projects 1.x: one task board per machine, read through its own CLI
// (`list --json`, `details <id> --json`; checked against 1.2.1). Pure
// functions, tested in tests/projectsTasks.test.ts with recorded output.
//
// Nothing here trusts the output: every field is checked and bounded, and an
// unknown field is dropped, so a newer 1.x can add fields without breaking it.

// The board's five groups, in the order they need you (1.x: shown/states.rs).
export type TaskGroup = 'needs' | 'ready' | 'working' | 'todo' | 'done'
export const TASK_GROUPS: readonly TaskGroup[] = ['needs', 'ready', 'working', 'todo', 'done']

export interface TaskReview {
  pass: boolean | null // null: a review from before the gate, with no verdict we can read
  tally: string // "1 critical, 1 minor" (the board's own words)
  by: string
}

export interface TaskRow {
  id: string // `<repo>/<n>`
  repo: string
  n: number
  state: string // idle | working | blocked | done | error
  kind: string // question | permission | auth, when it waits for you
  stage: string
  title: string
  msg: string
  app: string // the agent program on it (claude, codex, …)
  progress: number | null
  eta: number | null
  pr: string // the pull request URL, or ''
  review: TaskReview | null
  reviewRound: number
  research: boolean
  archived: boolean
  queue: number | null
  group: TaskGroup
}

export interface TaskDetails {
  id: string
  title: string
  stage: string
  msg: string
  description: string
  agent: string
  pr: string
  branch: string
  worktree: string
  failure: string
  review: TaskReview | null
  reviewRounds: number
  plan: string
  research: boolean
}

// What wherdr can do on a task (1.x `tell`, `approve`, and its pane in Herdr).
export interface TaskActions { tell: boolean, approve: boolean }

export interface MachineTasks {
  machine: string
  // herdr-projects there (shared/projectsPlugin.ts): only `ready` has tasks.
  status: 'missing' | 'old' | 'disabled' | 'ready'
  version: string
  tasks: TaskRow[]
  error?: string
  stale?: boolean
}
export interface TasksBoard { version: string, machines: MachineTasks[] }
export type TasksReply = TasksBoard | { same: true, version: string }

const MAX_TASKS = 500
const ID_RE = /^[A-Za-z0-9][\w.-]{0,79}\/\d{1,7}$/
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null)

export function isTaskId(v: unknown): v is string {
  return typeof v === 'string' && ID_RE.test(v)
}

// Only an https link is kept: the card opens it in a new tab.
export function cleanUrl(v: unknown): string {
  const s = str(v, 400)
  return /^https:\/\/[^\s"'<>]+$/i.test(s) ? s : ''
}

// `#7` from a GitHub pull request link, else '' (the card then says "PR").
export function prNumber(url: string): string {
  const m = /\/pull\/(\d{1,7})(?:[/?#]|$)/.exec(url)
  return m ? `#${m[1]}` : ''
}

const SEVERITIES = ['critical', 'major', 'minor', 'trivial'] as const

// The review as the board counts it: findings by severity, those that were
// there before the task apart (1.x: gate.rs tally).
export function parseReview(v: unknown): TaskReview | null {
  const rv = obj(v)
  if (!rv || rv.stale === true) return null
  const by = str(rv.by, 40)
  if (Array.isArray(rv.findings) && typeof rv.meets === 'boolean') {
    const findings = rv.findings.slice(0, 200).map(obj).filter(Boolean) as Record<string, unknown>[]
    const open = findings.filter(f => f.preexisting !== true)
    const parts: string[] = []
    for (const s of SEVERITIES) {
      const n = open.filter(f => (SEVERITIES.includes(f.severity as typeof SEVERITIES[number]) ? f.severity : 'major') === s).length
      if (n) parts.push(`${n} ${s}`)
    }
    const pre = findings.length - open.length
    if (pre) parts.push(`${pre} pre-existing`)
    return { pass: rv.pass === true ? true : rv.pass === false ? false : null, tally: parts.join(', '), by }
  }
  if (typeof rv.error === 'string') return { pass: false, tally: str(rv.error, 200), by }
  const score = num(rv.score)
  if (score !== null) return { pass: rv.recommend === false ? false : rv.recommend === true ? true : null, tally: `${score}/5`, by }
  return null
}

// The group the 1.x board puts a row in (shown/states.rs: group_of). The list
// does not carry merge failures: such a row shows as ready, its message says why.
export function groupOf(r: Pick<TaskRow, 'state' | 'kind' | 'stage' | 'review'>): TaskGroup {
  const awaitsYes = r.state === 'blocked' && r.kind === 'permission' && r.stage === 'approval'
  if (awaitsYes && r.review?.pass !== false) return 'ready'
  if (r.state === 'blocked' || r.state === 'error') return 'needs'
  if (r.state === 'working') return 'working'
  if (r.state === 'done') return 'done'
  return 'todo'
}

export function parseTaskRow(v: unknown): TaskRow | null {
  const t = obj(v)
  if (!t || !isTaskId(t.id)) return null
  const [repo, n] = t.id.split('/') as [string, string]
  const progress = num(t.progress)
  const row: Omit<TaskRow, 'group'> = {
    id: t.id, repo, n: Number(n),
    state: str(t.state, 20), kind: str(t.kind, 20), stage: str(t.stage, 30),
    title: str(t.title, 300), msg: str(t.msg, 1000), app: str(t.app, 40),
    progress: progress === null ? null : Math.max(0, Math.min(100, Math.round(progress))),
    eta: num(t.eta),
    pr: cleanUrl(t.pr),
    review: parseReview(t.review),
    reviewRound: Math.max(0, Math.floor(num(t.reviewRound) ?? 0)),
    research: t.research === true,
    archived: Boolean(t.archivedAt),
    queue: num(t.queue),
  }
  return { ...row, group: groupOf(row) }
}

// `list --json`: an array of rows. Anything else is refused, not guessed.
export function parseTaskList(text: string): TaskRow[] {
  let v: unknown
  try { v = JSON.parse(text) } catch { throw new Error('herdr-projects list: not JSON') }
  if (!Array.isArray(v)) throw new Error('herdr-projects list: not a list')
  return v.slice(0, MAX_TASKS).map(parseTaskRow).filter((r): r is TaskRow => r !== null)
}

// A failure is an object with words in it, or plain words.
function failureText(v: unknown): string {
  if (typeof v === 'string') return v.slice(0, 2000)
  const f = obj(v)
  if (!f) return ''
  for (const k of ['msg', 'message', 'error', 'words', 'text', 'why']) if (typeof f[k] === 'string' && f[k]) return (f[k] as string).slice(0, 2000)
  return ''
}

export function parseTaskDetails(text: string): TaskDetails {
  let v: unknown
  try { v = JSON.parse(text) } catch { throw new Error('herdr-projects details: not JSON') }
  const d = obj(v)
  const t = obj(d?.task)
  if (!d || !t || !isTaskId(t.id)) throw new Error('herdr-projects details: unexpected reply')
  const plan = obj(d.plan)
  return {
    id: t.id,
    title: str(t.title, 300), stage: str(t.stage, 30), msg: str(t.msg, 1000), description: str(t.description, 8000),
    agent: str(d.agent, 40),
    pr: cleanUrl(d.pr),
    branch: str(d.branch, 200),
    worktree: str(d.worktree, 500),
    failure: failureText(d.failure),
    review: parseReview(d.review),
    reviewRounds: Array.isArray(d.reviews) ? d.reviews.length : 0,
    plan: plan ? str(plan.text, 8000) : '',
    research: d.research === true,
  }
}

// What the card offers. `tell` reaches the task's agent (or, on a plan that
// waits, sends the plan back); `approve` merges finished work or says yes to a plan.
export function taskActions(r: Pick<TaskRow, 'state' | 'stage' | 'group' | 'archived'>): TaskActions {
  if (r.archived) return { tell: false, approve: false }
  const live = r.group !== 'todo' && r.group !== 'done'
  return {
    tell: live,
    approve: r.stage === 'approval' || (r.stage === 'plan' && r.state === 'blocked'),
  }
}

// Rows of one group, as the board orders them: by repo, then newest first.
export function sortTasks(rows: TaskRow[]): TaskRow[] {
  return [...rows].sort((a, b) => TASK_GROUPS.indexOf(a.group) - TASK_GROUPS.indexOf(b.group) || a.repo.localeCompare(b.repo) || b.n - a.n)
}

// Text sent with `tell`: one message, bounded. Empty: nothing to send.
export const TELL_MAX = 8000
export function cleanTell(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, TELL_MAX) : ''
}
