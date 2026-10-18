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
  // Its repo's short key (`repo.key`, 1.x store/keys.rs), once read: `APP`
  // names this task `APP-6`. Not in `list --json`: wherdr asks `show --repo`.
  repoKey?: string
  // A partial read kept this row from an earlier one (when it was read, in ms).
  stale?: boolean
  readAt?: number
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
  // What failed (1.x `failure.stage`: start, setup, send, agent, workflow,
  // pr, merge, attempts…) and whether a login stopped it: what Retry needs.
  failureStage: string
  failureAuth: boolean
  // The agent's closing note (task.json `summary`: 1.2.1's `details` leaves
  // it out, so the server reads it from the task's file) and, for research, its
  // report (`details.report`: the file's name, its link when it is https).
  summary: string
  report: { file: string, link: string } | null
  review: TaskReview | null
  reviewRounds: number
  plan: string
  research: boolean
}

// What wherdr can do on a task: 1.x `tell`, `approve`, `delegate`, `stop`,
// `retry`, `archive` (and its pane in Herdr).
export interface TaskActions { tell: boolean, approve: boolean, delegate: boolean, stop: boolean, retry: boolean, archive: boolean }
// The task commands that take nothing but the task's id.
export const TASK_COMMANDS = ['delegate', 'stop', 'retry', 'archive'] as const
export type TaskCommand = typeof TASK_COMMANDS[number]
export const isTaskCommand = (v: unknown): v is TaskCommand => TASK_COMMANDS.includes(v as TaskCommand)
export const NO_ACTIONS: TaskActions = { tell: false, approve: false, delegate: false, stop: false, retry: false, archive: false }

// One board per machine (its HOME): the named sessions of a machine share it.
export interface MachineTasks {
  machine: string // the base machine's key
  // herdr-projects there (shared/projectsPlugin.ts): only `ready` has tasks.
  // `error`: Herdr did not answer, so it is not known.
  status: 'missing' | 'old' | 'disabled' | 'ready' | 'error'
  version: string
  tasks: TaskRow[]
  // When `tasks` were read (ms). With `error` or `stale`: kept from that read.
  at?: number
  error?: string
  stale?: boolean
  // wherdr runs in a container: the board is read from its files, nothing is
  // run there (its upkeep belongs to the host), so no action from here.
  readOnly?: boolean
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

// A task as herdr-projects names it (store/keys.rs tag_of): its repo's key and
// its number, `APP-6` for `demo-app/6`; `#6` while the key is not known.
export const taskKey = (id: string, repoKey?: string | null) => { const n = id.split('/')[1] || ''; return repoKey ? `${repoKey}-${n}` : `#${n}` }

// A repo's key: 2 to 5 letters or digits, the first a letter, in capitals.
const REPO_KEY_RE = /^[A-Z][A-Z0-9]{1,4}$/
// `show --repo <name> --json`: the `repo.key` row. A key another repo has or
// had is not used: its note names the stand-in the tasks go by, if any.
export function parseRepoKey(text: string): string {
  let v: unknown
  try { v = JSON.parse(text) } catch { return '' }
  const rows = obj(v)?.settings
  const row = Array.isArray(rows) ? rows.map(obj).find(r => r?.name === 'repo.key') : null
  if (!row) return ''
  const note = str(row.note, 300)
  const standIn = /its tasks go by ([A-Z][A-Z0-9]{1,4})\b/.exec(note)
  if (standIn) return standIn[1]!
  if (note.startsWith('not used')) return ''
  const key = str(row.value, 10)
  return REPO_KEY_RE.test(key) ? key : ''
}

// From `data/repo-keys.json` (store/keys_given.rs), where a container reads the
// board's files: every key a repo went by (`had`, key -> repo, in the order they
// were recorded: the last is the latest) and the stand-ins (`standIn`, repo -> key).
export function repoKeysFromFile(text: string): Record<string, string> {
  let v: unknown
  try { v = JSON.parse(text) } catch { return {} }
  const o = obj(v)
  const out: Record<string, string> = {}
  for (const [key, repo] of Object.entries(obj(o?.had) || {})) if (typeof repo === 'string' && REPO_KEY_RE.test(key)) out[repo] = key
  for (const [repo, key] of Object.entries(obj(o?.standIn) || {})) if (typeof key === 'string' && REPO_KEY_RE.test(key)) out[repo] = key
  return out
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
    failureStage: str(obj(d.failure)?.stage, 30),
    failureAuth: obj(d.failure)?.auth === true,
    review: parseReview(d.review),
    reviewRounds: Array.isArray(d.reviews) ? d.reviews.length : 0,
    plan: plan ? str(plan.text, 8000) : '',
    research: d.research === true,
    summary: str(d.summary ?? t.summary, 8000).trim(),
    report: parseReport(d.report),
  }
}
function parseReport(v: unknown): TaskDetails['report'] {
  const r = obj(v)
  const file = r ? str(r.file, 200) : ''
  return file ? { file, link: cleanUrl(r!.link) } : null
}

// What the card offers, from the row and, for a failed task, what failed
// (`details`). These follow 1.2.1's own checks, so a button is shown only where
// the command can work; 1.x still has the last word, and says why it refuses.
// - `tell` reaches the task's agent (or, on a plan that waits, sends the plan
//   back), so only once an agent has been on it (1.x refuses it before);
// - `approve` merges finished work or says yes to a plan;
// - `delegate` puts an agent on a task of the backlog ("to do"), or again on
//   one that failed before its agent got going (start, setup, attempts);
// - `stop` stops the agent at work, or the one that waits for your answer;
// - `retry` is 1.2.1's `send_error` (cli/tasks.rs): it continues a task a
//   limit stopped, tells an agent that stopped without a summary to go on,
//   starts again an agent that never took its text, or sends a failure of the
//   agent or of the finish line back to it. Not a login problem (that needs
//   you first: reply instead), not a failure before an agent got going, not an
//   agent whose terminal is gone (the task is still at work: Stop is offered);
// - `archive` puts a task away (`restore` brings it back): not in a stage where
//   something runs (store/files.rs SLOT_STAGES, plus queued and attempts).
export type TaskFailure = Pick<TaskDetails, 'failureStage' | 'failureAuth'>
// 1.2.1 store/files.rs SLOT_STAGES, and the stages archive.rs also refuses.
const ACTIVE_STAGES = ['starting', 'setup', 'working', 'checking', 'pushing', 'reviewing', 'merging', 'queued', 'attempts']
// A failure before any agent was on it: Start again, not Retry.
const BEFORE_AGENT = ['start', 'setup', 'attempts']
export function taskActions(r: Pick<TaskRow, 'state' | 'kind' | 'stage' | 'group' | 'archived' | 'app'>, f?: TaskFailure | null): TaskActions {
  if (r.archived) return NO_ACTIONS
  const live = r.group !== 'todo' && r.group !== 'done'
  const limitStop = r.stage === 'stopped' && r.state === 'blocked'
  const failed = r.stage === 'failed'
  // A failed task's Retry depends on what failed: unknown until `details` says.
  const retryFailed = failed && Boolean(f) && !f!.failureAuth && (f!.failureStage === 'send' || (Boolean(f!.failureStage) && !BEFORE_AGENT.includes(f!.failureStage)))
  return {
    tell: live && Boolean(r.app),
    approve: r.stage === 'approval' || (r.stage === 'plan' && r.state === 'blocked'),
    delegate: r.group === 'todo' || (failed && Boolean(f) && BEFORE_AGENT.includes(f!.failureStage)),
    // Also an agent whose terminal is gone or that exited: still at work for 1.x.
    stop: r.group === 'working' || (r.group === 'needs' && r.state === 'blocked' && Boolean(r.app) && !limitStop && r.kind !== 'auth')
      || (r.stage === 'working' && r.state === 'error'),
    retry: limitStop || r.stage === 'nosummary' || retryFailed,
    archive: r.group !== 'working' && !ACTIVE_STAGES.includes(r.stage),
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

// ---------------------------------------------------------------- commands
// Every argument comes after the command's own flags, and the user's words
// after `--` (or as `--flag=value`), so no text is ever read as a flag.

// A new task's title: one line (1.x shortens a long one at a word and keeps
// the full text in the description).
export const TITLE_MAX = 300
export function cleanTitle(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX) : ''
}

// `--repo NAME|PATH`: a repo the board knows by its name, or a folder's path
// (absolute, or from the home folder). '' : the home folder (wherdr runs the
// command there). Anything else is refused, not guessed.
const REPO_NAME_RE = /^[A-Za-z0-9][\w.-]{0,79}$/
export function cleanRepo(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return ''
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return ''
  if (REPO_NAME_RE.test(s)) return s
  // eslint-disable-next-line no-control-regex
  if (/^(\/|~\/)/.test(s) && s.length <= 500 && !/[\u0000-\u001f]/.test(s)) return s
  return null
}

export interface NewTask { title: string, description: string, repo: string, delegate: boolean }
// `add`: `--delegate` puts an agent on it at once.
export function addArgs(t: NewTask): string[] {
  return ['add',
    ...(t.description ? [`--desc=${t.description}`] : []),
    ...(t.repo ? [`--repo=${t.repo}`] : []),
    ...(t.delegate ? ['--delegate'] : []),
    '--', t.title]
}

// Who the Board's chat talks to on a machine: its Coordinator (one per Herdr
// session), the machine coordinator, or a repo's project coordinator.
export type CoordinatorTarget = { kind: 'main' } | { kind: 'machine' } | { kind: 'project', repo: string }
export function cleanTarget(v: unknown): CoordinatorTarget | null {
  const o = obj(v)
  if (!o || o.kind === 'main') return { kind: 'main' }
  if (o.kind === 'machine') return { kind: 'machine' }
  if (o.kind === 'project' && typeof o.repo === 'string' && REPO_NAME_RE.test(o.repo)) return { kind: 'project', repo: o.repo }
  return null
}
// `coordinator [--machine | --project=REPO] [--delegate] -- tell <words>`:
// `--delegate` (the board's Tab) puts an agent on every task the message adds.
export function coordinatorArgs(to: CoordinatorTarget, words: string, delegate: boolean): string[] {
  return ['coordinator',
    ...(to.kind === 'machine' ? ['--machine'] : to.kind === 'project' ? [`--project=${to.repo}`] : []),
    ...(delegate ? ['--delegate'] : []),
    '--', 'tell', words]
}

// Which pane a coordinator talks in, as herdr-projects itself keeps it
// (coordinator/look.rs `summary`): `coordinator [--machine | --project=REPO]
// status --json` gives its state and its pane in the board's own session.
// Never guessed from an agent's name: two repos can share one once Herdr's
// rules shorten it (`demo` and `demo-2`, `demo.app` and `demo-app`).
export function coordinatorStatusArgs(to: CoordinatorTarget): string[] {
  return ['coordinator', ...(to.kind === 'machine' ? ['--machine'] : to.kind === 'project' ? [`--project=${to.repo}`] : []), '--json', 'status']
}
// Its agent answers in Herdr: working, blocked or idle. Anything else (none,
// starting, exited) has no pane to talk to yet.
const LIVE_COORDINATOR = ['working', 'blocked', 'idle']
const PANE_RE = /^w[0-9a-z]+:p[0-9a-z]+$/i
export function parseCoordinatorStatus(text: string): { state: string, pane: string | null } {
  let v: unknown
  try { v = JSON.parse(text) } catch { throw new Error('herdr-projects coordinator: not JSON') }
  const o = obj(v)
  if (!o) throw new Error('herdr-projects coordinator: unexpected reply')
  const state = str(o.state, 20)
  const pane = str(o.pane, 40)
  return { state, pane: LIVE_COORDINATOR.includes(state) && PANE_RE.test(pane) ? pane : null }
}

// ---------------------------------------------------------------- by repo
// A machine's rows under their repos (1.x: grouped by repo, `Alt+S`): repos
// by name, each one's rows as the board orders them (by group, newest first).
export interface RepoTasks { repo: string, tasks: TaskRow[] }
export function groupByRepo(rows: TaskRow[]): RepoTasks[] {
  const by = new Map<string, TaskRow[]>()
  for (const r of sortTasks(rows)) {
    const list = by.get(r.repo)
    if (list) list.push(r)
    else by.set(r.repo, [r])
  }
  return [...by].sort(([a], [b]) => a.localeCompare(b)).map(([repo, tasks]) => ({ repo, tasks }))
}

// How many rows of each group: a heading's summary.
export function groupCounts(rows: TaskRow[]): Record<TaskGroup, number> {
  const c: Record<TaskGroup, number> = { needs: 0, ready: 0, working: 0, todo: 0, done: 0 }
  for (const r of rows) c[r.group]++
  return c
}

// ---------------------------------------------------------------- push
// `board.notify` runs a command once per event, with the task's id, title and
// event in its environment. This one hands it to Herdr as a notification,
// which wherdr already sends to the phone (server/utils/herdrNotify.ts): no
// state of wherdr's own, and it works on every machine wherdr reaches.
export const NOTIFY_COMMAND = 'herdr notification show --body="$HERDR_PROJECTS_TITLE" --sound request -- "$HERDR_PROJECTS_ID · $HERDR_PROJECTS_EVENT"'
// The command that sets it, on each machine that runs herdr-projects.
export const NOTIFY_SETUP = (launcher: string) => `${launcher} set board.notify '${NOTIFY_COMMAND}'`
export const NOTIFY_EVENTS = ['needs you', 'ready to approve', 'failed'] as const
export type NotifyEvent = typeof NOTIFY_EVENTS[number]
// A notification that NOTIFY_COMMAND sent: its task and what happened; else null.
export function taskNotice(title: string): { id: string, event: NotifyEvent } | null {
  const m = /^(\S+) · (needs you|ready to approve|failed)$/.exec(title.trim())
  return m && isTaskId(m[1]) ? { id: m[1], event: m[2] as NotifyEvent } : null
}

// ---------------------------------------------------------------- read from the files
// wherdr in a container reads the board's own files (`data/tasks/<repo>/<n>/task.json`)
// instead of running herdr-projects there: no upkeep, nothing written. The row
// follows 1.2.1's own rules (flow/state.rs `show`) from the task's stage; for an
// agent at work, `paneStatus` is the status wherdr sees on its pane (Herdr's
// own, as 1.x reads it). A close reading, not the program's: the CLI stays the
// reference wherever it may run.
type Raw = Record<string, unknown>
const BLOCKED_STAGES: Record<string, string> = { approval: 'permission', plan: 'permission', pick: 'permission' }

export function stateFromTaskFile(t: Raw, paneStatus: string | null): { state: string, kind: string } {
  const stage = str(t.stage, 30)
  const failure = obj(t.failure)
  switch (stage) {
    case 'todo': return { state: 'idle', kind: '' }
    case 'after': return t.afterBlocked ? { state: 'blocked', kind: 'question' } : { state: 'working', kind: '' }
    case 'done': case 'tried': return { state: 'done', kind: '' }
    case 'failed': return failure?.auth ? { state: 'blocked', kind: 'auth' } : { state: 'error', kind: '' }
    case 'asks': return { state: 'blocked', kind: str(t.kind, 20) || 'question' }
    case 'nosummary': return { state: 'error', kind: '' }
    case 'reviewneeds': return { state: 'blocked', kind: '' }
    case 'stopped': return t.limitStop ? { state: 'blocked', kind: '' } : { state: 'idle', kind: '' }
    case 'working': return paneStatus === 'blocked' ? { state: 'blocked', kind: '' } : { state: 'working', kind: '' }
  }
  if (BLOCKED_STAGES[stage]) return { state: 'blocked', kind: BLOCKED_STAGES[stage]! }
  return { state: 'working', kind: '' } // queued, starting, reviewing, checking, merging, attempts…
}

// One row of the board from a task file; null for what the board does not list
// on its own (an attempt of a task done several times at once) or cannot read.
export function rowFromTaskFile(t: unknown, paneStatus: string | null): TaskRow | null {
  const o = obj(t)
  if (!o || o.attemptOf) return null
  const { state, kind } = stateFromTaskFile(o, paneStatus)
  const review = obj(o.review)
  return parseTaskRow({
    id: o.id, state, kind, stage: o.stage, title: o.title, msg: o.msg, app: o.app,
    pr: o.pr, review: review && !review.stale ? review : null, reviewRound: o.reviewRound,
    research: o.research === true, archivedAt: o.archivedAt,
    progress: obj(o.watch)?.progress,
  })
}

// `details` from a task file: what the file holds (no plan text, no review history).
export function detailsFromTaskFile(t: unknown): TaskDetails | null {
  const o = obj(t)
  if (!o || !isTaskId(o.id)) return null
  return parseTaskDetails(JSON.stringify({
    task: { id: o.id, title: o.title, stage: o.stage, msg: o.msg, description: o.description, summary: o.summary },
    report: o.report ?? null,
    failure: o.failure ?? null, review: o.review ?? null, reviews: [],
    // The program on it: `on` while one works, then `agent`, as `details` gives it; else the row's `app`.
    agent: o.on || o.agent || o.app || null,
    research: o.research === true, pr: o.pr ?? null, branch: o.branch ?? null, worktree: o.worktree ?? null, plan: null,
  }))
}
