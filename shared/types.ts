// Types partagés entre le serveur (Nitro) et l'app (Vue).
import type { TabLayout } from './layout'

export type AgentStatus = 'working' | 'blocked' | 'done' | 'idle' | 'unknown'

export interface ChoiceOption { label: string, hint: string | null }
export interface Choices { question: string | null, cursor: number, options: ChoiceOption[] }

export interface QueuedMessage { id: string, text: string, at?: number }

export interface Workspace {
  id: string
  // Machine distante (clé courte) ; absent pour la machine locale.
  machine?: string
  label: string
  number: number
  status: string | null
  worktree: boolean
  // Dépôt Git du workspace (Herdr : `worktree.repo_key` / `repo_name`), commun
  // au checkout principal et à ses worktrees ; absent hors dépôt.
  repo?: string
  repoName?: string
}

// Onglet d'un workspace Herdr et sa disposition (splits réels, cf. shared/layout.ts).
export interface Tab {
  // w1:t1 (local) ou <machine>~w1:t1 (distant).
  id: string
  machine?: string
  workspace: string
  label: string
  number: number
  // Absente si Herdr ne l'a pas donnée : l'app empile alors les panes.
  layout: TabLayout | null
}

export interface Pane {
  // w1:p1 (local) ou <machine>~w1:p1 (distant, cf. shared/ids.ts).
  id: string
  // Machine distante (clé courte) ; absent pour la machine locale.
  machine?: string
  workspace: string
  tab: string
  tabLabel: string | null
  agent: string | null
  name: string | null
  label: string | null
  status: AgentStatus | null
  title: string | null
  cwd: string | null
  agentSession: string | null
  // Projet herdr-projects (jeton `hp_project` / `hp_group` du pane), cf. shared/projects.ts.
  project?: string
  bornAt?: number
  pendingPrompt?: boolean
  queued?: QueuedMessage[]
  prompt?: Choices
  preview?: string
  model?: ModelInfo
  // Claude au travail, conversation affichée : verbe de sa ligne d'activité (« Orbiting »).
  activity?: string
}

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

// Modèle d'un agent : libellé lisible (« Opus 5.5 », « GPT-6-Sol ») et identifiant
// brut quand on le connaît (`claude-opus-5-5`, `gpt-6-sol`).
export interface ModelInfo {
  id: string | null
  label: string
  effort?: string | null
  at?: string | null
}
// Option du menu /model d'un agent.
export interface ModelOption { label: string, hint: string | null, current?: boolean, isDefault?: boolean }
export interface ModelList { agent: string, options: ModelOption[], at: number }
export interface EffortList { levels: string[], current: string | null }

// Une machine (locale, ou profil SSH de Herdr) et l'état de sa connexion.
export interface MachineInfo {
  key: string // '' = locale
  baseKey?: string // machine d'origine pour une session nommée
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
  error?: string
  version?: string
  session?: string
  workspaces: Workspace[]
  panes: Pane[]
  // Onglets et dispositions (absents d'un état ancien gardé hors ligne).
  tabs?: Tab[]
  // Présent seulement quand il y a des machines distantes.
  machines?: MachineInfo[]
}

export type ChatRole = 'user' | 'assistant' | 'tool' | 'cmd' | 'system'
export interface ChatItem {
  role: ChatRole
  text: string
  ts: string | null
  name?: string
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

// Thème de Herdr (~/.config/herdr/config.toml, section [theme]), pour « Suivre Herdr ».
export interface HerdrThemeConfig {
  name: string | null
  autoSwitch: boolean
  darkName: string | null
  lightName: string | null
  custom: Record<string, string>
  customLight: Record<string, string>
  customDark: Record<string, string>
}

// Machine proposée dans la feuille « Nouveau » : dossier personnel et récents.
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

// Commande « / » d'un agent (menu du champ de saisie).
export interface SlashCommand {
  name: string // sans la barre oblique
  desc: string
  hint?: string
  source: 'builtin' | 'skill' | 'command'
}

// Quotas d'utilisation d'un compte (Claude ou Codex) : fenêtre de 5 h et semaine.
export interface QuotaWindow {
  used: number // % utilisé
  resetsAt: number | null // ms
  minutes: number // durée de la fenêtre
  fresh?: boolean // fenêtre qui vient de repartir, absente de la lecture : rien d'utilisé
}
export interface Quota { five: QuotaWindow | null, week: QuotaWindow | null, at: number }
// Quotas d'un compte et machines qui l'utilisent (clé '' = locale, nom affiché).
export interface AccountQuota extends Quota { machines: { key: string, label: string }[] }
export interface Quotas {
  // Lecture la plus récente, toutes machines confondues.
  claude: Quota | null
  codex: Quota | null
  // Présent seulement quand les machines en ligne n'utilisent pas le même compte
  // Claude : un bloc par compte (au moins deux).
  claudeAccounts?: AccountQuota[]
  // Idem pour Codex (empreinte tirée de ses conversations).
  codexAccounts?: AccountQuota[]
  // Machines en ligne dont la barre d'état de wherdr n'est pas en place
  // (absent : toutes configurées).
  claudeSetup?: ClaudeSetup[]
}
// Barre d'état des quotas Claude d'une machine : `missing` = à installer,
// `pending` = installée, en attente du prochain échange avec un Claude.
// `installable` : le serveur peut l'installer lui-même (sinon, commande à copier).
export interface ClaudeSetup { key: string, state: 'missing' | 'pending', installable: boolean }

// Worktree Git lié à un dépôt (Herdr), pour la liste de nettoyage.
export interface WorktreeInfo {
  machine: string // clé de la machine ('' = locale)
  repo: string
  repoRoot: string
  path: string
  branch: string | null
  workspace: string | null // workspace ouvert (ID de l'app), sinon fermé
  agents: number
  panes: number
  prunable: boolean // dossier disparu
}

// Action d'un plugin Herdr (`[[actions]]` de herdr-plugin.toml), telle que
// wherdr la propose : dans le menu d'un agent (contextes workspace/tab/pane,
// lancée avec le pane de l'agent) ou dans celui de sa machine (contexte global).
export interface PluginAction {
  plugin: string // plugin_id
  pluginName: string
  id: string // action_id (local au plugin)
  title: string
  label: string // titre sans le nom du plugin en préfixe (menu groupé par plugin)
  description: string | null
  agent: boolean // proposée dans le menu d'un agent
  machine: boolean // proposée dans le menu de la machine
  confirm: boolean // demande une confirmation (peut modifier quelque chose)
}
export interface PluginActionList { actions: PluginAction[] }
// Résultat d'une action : Herdr la lance en tâche de fond, on attend sa fin un moment.
export interface PluginActionResult {
  status: 'succeeded' | 'failed' | 'running'
  exitCode: number | null
  output: string // fin de la sortie (stdout, sinon stderr), courte
}
