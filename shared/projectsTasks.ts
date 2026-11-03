// herdr-projects 1.x task rows. wherdr no longer reads the Board; these types
// remain for the static demo build (app/demo).

// The board's five groups, in the order they need you (1.x: shown/states.rs).
export type TaskGroup = 'needs' | 'ready' | 'working' | 'todo' | 'done'

export interface TaskReview {
  pass: boolean | null // null: a review from before the gate, with no verdict we can read
  tally: string // "1 critical, 1 minor" (the board's own words)
  by: string
}

export interface TaskAgentIdentity { agent: string, reviewer: string, from: string }

export interface TaskRow {
  id: string // `<repo>/<n>`
  repo: string
  n: number
  state: string // idle | working | blocked | done | error
  kind: string // question | permission | auth, when it waits for you
  stage: string
  title: string
  msg: string
  identity?: TaskAgentIdentity
  app: string // the agent program on it (claude, codex, …)
  progress: number | null
  eta: number | null
  pr: string // the pull request URL, or ''
  review: TaskReview | null
  reviewRound: number
  chat?: boolean // CLI `chat`: effective chat.only, distinct from a task-file chat exchange.
  research: boolean
  archived: boolean
  queue: number | null
  group: TaskGroup
  approvalBlocked?: boolean
  // Its repo's short key (`repo.key`, 1.x store/keys.rs), once read: `APP`
  // names this task `APP-6`. Not in `list --json`: wherdr asks `show --repo`.
  repoKey?: string
  // When it was made (ms, the task file's `created`): orders Done across
  // machines. Not in `list --json`: wherdr reads it from the task's file.
  created?: number
  // A partial read kept this row from an earlier one (when it was read, in ms).
  stale?: boolean
  readAt?: number
}

export interface MachineTasks {
  machine: string // the base machine's key
  // herdr-projects there (shared/projectsPlugin.ts): only `ready` has tasks.
  // `error`: Herdr did not answer, so it is not known.
  status: 'missing' | 'old' | 'shepherdr' | 'disabled' | 'ready' | 'error'
  version: string
  tasks: TaskRow[]
  // When `tasks` were read (ms). With `error` or `stale`: kept from that read.
  at?: number
  error?: string
  stale?: boolean
  // Still being read (the list past the deadline, or its repos' keys): ask again soon.
  pending?: boolean
}
export interface TasksBoard { version: string, machines: MachineTasks[] }

// The group the 1.x board puts a row in (shown/states.rs: group_of). The list
// needs the task file's merge/sync blockers too, absent from the CLI list.
export function groupOf(r: Pick<TaskRow, 'state' | 'kind' | 'stage' | 'review' | 'approvalBlocked'>): TaskGroup {
  const awaitsYes = r.state === 'blocked' && r.kind === 'permission' && r.stage === 'approval'
  if (awaitsYes && !r.approvalBlocked && r.review?.pass !== false) return 'ready'
  if (r.state === 'blocked' || r.state === 'error') return 'needs'
  if (r.state === 'working') return 'working'
  if (r.state === 'done') return 'done'
  return 'todo'
}
