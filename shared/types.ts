// Types shared between the server (Nitro) and the app (Vue).
import type { TabLayout } from './layout'

export type AgentStatus = 'working' | 'blocked' | 'done' | 'idle' | 'unknown'

// `checked`: box of a multiple-choice list (Choices.multi), checked on screen.
export interface ChoiceOption { label: string, hint: string | null, checked?: boolean }
// What a permission request allows: the tool, its description, and the
// full command (or tool input), or the file touched.
export interface PromptDetail {
  tool: string
  description?: string
  command?: string
  file?: string
  added?: number
  removed?: number
  // Command cut on the server side (very long): the app says so.
  truncated?: boolean
}
// `multi`: checkboxes (omp); a choice checks or unchecks, Enter moves on.
export interface Choices { question: string | null, cursor: number, options: ChoiceOption[], detail?: PromptDetail, multi?: boolean }

// Waiting screen of an agent (Codex at startup: hooks, folder trust,
// login…), see server/utils/waitScreen.ts. `other`: unrecognized screen,
// only shown while there is no conversation.
export type WaitKind = 'hooks' | 'trust' | 'login' | 'update' | 'other'
// Key from the screen's legend ("t trust all" → { key: 't', label: 'trust all' }).
export interface WaitAction { key: string, label: string }
export interface WaitScreen { kind: WaitKind, title: string | null, lines: string[], actions: WaitAction[] }

// Claude Code's full-screen interactive menu (/resume, /model, /mcp…), see
// shared/menuScreen.ts. `header`: group header, not an entry; `search`:
// text of the search field (null: no search); `more`: "19 more below".
export interface MenuEntry { label: string, hint: string | null, header?: boolean, cursor?: boolean }
export interface InteractiveMenu {
  title: string | null
  lines: string[]
  items: MenuEntry[]
  cursor: number | null
  search: string | null
  actions: WaitAction[]
  more: string | null
}

// state: held until a menu closes (server side), or failed to send.
export interface QueuedMessage { id: string, text: string, at?: number, state?: 'held' | 'failed' }

// Claude Code's screen while working (see server/utils/claudeScreen.ts): the
// "!" command running, the last message sent, the messages
// still in its queue. The transcript only has the "!" command at the end.
export interface ShellRun {
  command: string
  // Last output lines shown (Claude only shows a few).
  lines: string[]
  // Hidden lines above ("+12 lines").
  hidden: number
  // Start of the execution (ms), deduced from the "(37s)" counter.
  since: number | null
}
export interface ClaudeScreen { shell: ShellRun | null, sent: string | null, queued: string[] }

export interface Workspace {
  id: string
  // Remote machine (short key); missing for the local machine.
  machine?: string
  label: string
  number: number
  status: string | null
  worktree: boolean
  // Git repository of the workspace (Herdr: `worktree.repo_key` / `repo_name`), shared
  // by the main checkout and its worktrees; missing outside a repository.
  repo?: string
  repoName?: string
  branch?: string
}

// Tab of a Herdr workspace and its layout (real splits, see shared/layout.ts).
export interface Tab {
  // w1:t1 (local) ou <machine>~w1:t1 (distant).
  id: string
  machine?: string
  workspace: string
  label: string
  number: number
  // Missing if Herdr did not give it: the app then stacks the panes.
  layout: TabLayout | null
}

export interface Pane {
  // w1:p1 (local) ou <machine>~w1:p1 (distant, cf. shared/ids.ts).
  id: string
  // Remote machine (short key); missing for the local machine.
  machine?: string
  workspace: string
  tab: string
  tabLabel: string | null
  agent: string | null
  name: string | null
  label: string | null
  // Agent name shown by Herdr (`display_agent`), if it says more than the agent kind.
  displayAgent?: string
  // Pane without an agent: foreground command ("pnpm dev"), missing at the shell prompt.
  command?: string
  status: AgentStatus | null
  title: string | null
  cwd: string | null
  agentSession: string | null
  // Projet herdr-projects (jeton `hp_project` / `hp_group` du pane), cf. shared/projects.ts.
  project?: string
  bornAt?: number
  // Number of the agent's last state change (Herdr's `state_change_seq`,
  // increasing on a machine): "recent" sort of Ready.
  stateSeq?: number
  pendingPrompt?: boolean
  queued?: QueuedMessage[]
  prompt?: Choices
  screen?: WaitScreen
  // Menu interactif ouvert (agent au repos) : il remplace `prompt` et `screen`.
  menu?: InteractiveMenu
  preview?: string
  model?: ModelInfo
  // Claude working, conversation shown: verb of its activity line ("Orbiting").
  activity?: string
  // Claude working, conversation shown: what its screen shows.
  claudeScreen?: ClaudeScreen
  // Claude Code status near the input field ("✔ Update installed · Restart to update").
  claudeNotice?: string
  // Restart requested from wherdr (see server/utils/restart.ts): the agent
  // quits then comes back, the pane is briefly without an agent.
  restart?: { phase: 'stopping' | 'starting' | 'failed', agent: string, error?: string }
  // Grayed-out next-message suggestion in Claude Code's field (Tab accepts it).
  claudeSuggestion?: string
  // omp shown: its status line (model, folder, branch) and its gauges (context, quotas).
  ompStatus?: OmpStatus
}
export interface OmpStatus { line: string, meters: string | null }

export interface ChangeLine { kind: 'add' | 'del' | 'context' | 'hunk' | 'meta', text: string }
export interface ChangeFile {
  path: string
  previousPath?: string
  status: string
  added: number | null
  deleted: number | null
  lines: ChangeLine[]
  binary: boolean
  truncated: boolean
  summary?: string
}
export interface ChangeSet { files: ChangeFile[], truncated: boolean, count: number }
export interface ChangesResponse {
  git: boolean
  root?: string
  branch?: string
  working?: ChangeSet
  committed?: ChangeSet | null
  comparison?: string | null
  commits?: number | null
}

// Model of an agent: readable label ("Opus 5.5", "GPT-6-Sol") and raw
// identifier when known (`claude-opus-5-5`, `gpt-6-sol`).
export interface ModelInfo {
  id: string | null
  label: string
  effort?: string | null
  at?: string | null
}
// Option of an agent's /model menu.
export interface ModelOption { label: string, hint: string | null, current?: boolean, isDefault?: boolean }
export interface ModelList { agent: string, options: ModelOption[], at: number }
export interface EffortList { levels: string[], current: string | null }

// A machine (local, or Herdr SSH profile) and the state of its connection.
export interface MachineInfo {
  key: string // '' = local
  baseKey?: string // original machine for a named session
  session?: string
  label: string
  local: boolean
  status: 'online' | 'connecting' | 'offline'
  error: string | null
  target?: string
  version?: string
}

export interface NamedSession { name: string, running: boolean, key: string }

export interface HerdrState {
  ok: boolean
  // false: server just (re)started, state still partial (shared/stateReady.ts).
  ready?: boolean
  error?: string
  version?: string
  session?: string
  workspaces: Workspace[]
  panes: Pane[]
  // Tabs and layouts (missing from an old state kept offline).
  tabs?: Tab[]
  // Only present when there are remote machines.
  machines?: MachineInfo[]
}

// 'bash': Claude Code "!" command (bash mode), 'cmd': local "/" command.
// 'notice': note shown by the agent outside its replies (omp advisor,
// finished background task, IRC message…); `name` gives its kind.
export type ChatRole = 'user' | 'assistant' | 'tool' | 'cmd' | 'bash' | 'system' | 'notice'
export interface ChatItem {
  role: ChatRole
  text: string
  ts: string | null
  name?: string
  // Output of a 'bash' or 'cmd' command (stdout / stderr).
  out?: string
  err?: string
  images?: number
  ref?: string
  error?: boolean
}
export interface ClaudeQueueEntry { text: string, ts: string | null }

export interface ChatResponse {
  available: boolean
  reason?: 'unsupported' | 'not_found'
  file?: string
  session?: string
  guessed?: boolean
  token?: string
  unchanged?: boolean
  older?: boolean
  items?: ChatItem[]
  start?: number
  queue?: ClaudeQueueEntry[]
  model?: ModelInfo | null
}

export interface ConversationHit {
  pane: string
  agent: string
  title: string
  role: ChatRole
  text: string
  excerpt: string
  ts: string | null
  offset: number
}
export interface ConversationSearchResponse { hits: ConversationHit[], limited: boolean }

// Herdr theme (~/.config/herdr/config.toml, [theme] section), for "Follow Herdr".
export interface HerdrThemeConfig {
  name: string | null
  autoSwitch: boolean
  darkName: string | null
  lightName: string | null
  custom: Record<string, string>
  customLight: Record<string, string>
  customDark: Record<string, string>
}

// Machine offered in the "New" sheet: home folder and recent ones.
export interface MachineConfig { key: string, label: string, local: boolean, home: string, dirs: string[], online: boolean, kinds: string[] }

export interface AppConfig {
  hostLabel?: string
  machines?: MachineConfig[]
  herdrTheme?: HerdrThemeConfig | null
  kinds: string[]
  home: string
  dirs: string[]
  push: { enabled: boolean, key: string | null, devices: number }
}

export interface DirEntry { name: string, path: string, git: boolean }
export interface DirListing { path: string, parent: string | null, home: string, dirs: DirEntry[] }

export interface AuthStatus {
  hostLabel?: string
  enabled: boolean
  unlocked: boolean
  expiresAt?: number | null
  devices: { name: string, createdAt: string, lastUsed: string | null }[]
}

// "/" command of an agent (input field menu).
export interface SlashCommand {
  name: string // without the slash
  desc: string
  hint?: string
  source: 'builtin' | 'skill' | 'command'
}

// Usage quotas of an account (Claude or Codex): 5-hour window and week.
export interface QuotaWindow {
  used: number // % used
  resetsAt: number | null // ms
  minutes: number // window duration
  fresh?: boolean // window that just restarted, missing from the reading: nothing used
}
export interface Quota { five: QuotaWindow | null, week: QuotaWindow | null, at: number }
// Quotas of an account and machines using it (key '' = local, displayed name).
export interface AccountQuota extends Quota { machines: { key: string, label: string }[] }
export interface Quotas {
  // Most recent reading, across all machines.
  claude: Quota | null
  codex: Quota | null
  // Only present when the online machines do not use the same account
  // Claude: one block per account (at least two).
  claudeAccounts?: AccountQuota[]
  // Same for Codex (fingerprint taken from its conversations).
  codexAccounts?: AccountQuota[]
  // Online machines where wherdr's status line is not set up
  // (missing: all configured).
  claudeSetup?: ClaudeSetup[]
}
// Claude quota status line of a machine: `missing` = to install,
// `pending` = installed, waiting for the next exchange with a Claude.
// `installable`: the server can install it itself (otherwise, a command to copy).
export interface ClaudeSetup { key: string, state: 'missing' | 'pending', installable: boolean }

// Git worktree linked to a repository (Herdr), for the cleanup list.
export interface WorktreeInfo {
  machine: string // machine key ('' = local)
  repo: string
  repoRoot: string
  path: string
  branch: string | null
  workspace: string | null // open workspace (app ID), otherwise closed
  agents: number
  panes: number
  prunable: boolean // dossier disparu
}

// Action of a Herdr plugin (`[[actions]]` of herdr-plugin.toml), as
// wherdr offers it: in an agent's menu (workspace/tab/pane contexts,
// run with the agent's pane) or in its machine's menu (global context).
export interface PluginAction {
  plugin: string // plugin_id
  pluginName: string
  id: string // action_id (local au plugin)
  title: string
  label: string // title without the plugin name as prefix (menu grouped by plugin)
  description: string | null
  agent: boolean // offered in an agent's menu
  machine: boolean // offered in the machine's menu
  confirm: boolean // asks for confirmation (may change something)
}
export interface PluginActionList { actions: PluginAction[] }
// Result of an action: Herdr runs it in the background, we wait a while for it to finish.
export interface PluginActionResult {
  status: 'succeeded' | 'failed' | 'running'
  exitCode: number | null
  output: string // end of the output (stdout, otherwise stderr), short
  // herdr-projects "Check setup": what wherdr uses, then the full output.
  setup?: { key: 'version' | 'binary' | 'home' | 'config', value: string, warn?: boolean }[]
  full?: string
}
