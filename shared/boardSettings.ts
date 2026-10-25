// Board settings of one machine (herdr-projects 1.x `show`, `set`, `unset`):
// the board's own settings, the user's defaults for every task, and one repo's
// entry. Rows are `show --json [--repo NAME]` as herdr-projects gives them
// (shared/taskSettings.ts); nothing here guesses a value the CLI did not send.
//
// The choices offered come from herdr-projects' own list of settings
// (docs/settings.md upstream); anything else is typed, and the CLI refuses a
// wrong value with the nearest right one.
import { parseTaskSettings, type TaskSetting, type TaskSettings } from './taskSettings'

export type BoardSettingsTab = 'machine' | 'defaults' | 'repo'
export const BOARD_SETTINGS_TABS: BoardSettingsTab[] = ['machine', 'defaults', 'repo']

export interface BoardSettings extends TaskSettings {
  // The repo whose entry this is ('' for the user's own settings).
  repo: string
  // Agent programs installed on the machine (choices for *.agent).
  agents: string[]
}

export const parseBoardSettings = (raw: string) => parseTaskSettings(raw)

// ------------------------------------------------------------ themes
export const WORK_THEMES = ['worker', 'review', 'plan', 'attempts', 'merge', 'limits', 'workspace', 'check', 'modes', 'other'] as const
export const MACHINE_THEMES = ['board', 'coordinator', 'autopilot', 'watcher', 'voice', 'other'] as const
export type BoardSettingTheme = typeof WORK_THEMES[number] | typeof MACHINE_THEMES[number]

export function boardSettingTheme(name: string): BoardSettingTheme {
  const head = name.split('.')[0] ?? ''
  if (name === 'research.only' || name === 'chat.only') return 'modes'
  if (head === 'reviewer' || head === 'review') return 'review'
  if (head === 'limit') return 'limits'
  if (['worker', 'plan', 'attempts', 'merge', 'workspace', 'check', 'board', 'coordinator', 'autopilot', 'watcher', 'voice'].includes(head)) return head as BoardSettingTheme
  return 'other'
}

// Board settings (board.*, coordinator.*, watcher.*) are the user's only: the
// Machine tab. Work settings: the Defaults tab (the user's) and the Repos tab
// (one repo's entry, with `repo.key`, a fact of the repo).
const MACHINE_KINDS = ['board', 'coordinator']
export function tabRows(rows: TaskSetting[], tab: BoardSettingsTab): TaskSetting[] {
  if (tab === 'machine') return rows.filter(r => MACHINE_KINDS.includes(r.kind))
  if (tab === 'defaults') return rows.filter(r => !MACHINE_KINDS.includes(r.kind) && r.kind !== 'repo')
  return rows.filter(r => !MACHINE_KINDS.includes(r.kind))
}
export function themedRows(rows: TaskSetting[], tab: BoardSettingsTab): { theme: BoardSettingTheme, rows: TaskSetting[] }[] {
  const themes: readonly BoardSettingTheme[] = tab === 'machine' ? MACHINE_THEMES : WORK_THEMES
  const shown = tabRows(rows, tab)
  return themes.map(theme => ({ theme, rows: shown.filter(r => boardSettingTheme(r.name) === theme) })).filter(g => g.rows.length)
}
// A repo's entry: what differs from the user's settings for that repo (its
// own entry or its file).
export const differsForRepo = (row: TaskSetting) => row.place === 'repo' || row.place === 'file'
// Said at this level: ↺ (`unset`) brings back the inherited value.
export const canReset = (row: TaskSetting) => row.own === true

// ------------------------------------------------------------ values
// A value as it is typed back to `set`: a list with commas, a switch as true/false.
export function settingText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(v => String(v)).join(', ')
  return String(value)
}
// `codex/gpt-6` → `codex`.
export const programOf = (agent: string) => agent.split('/')[0]!.trim()
export const modelOf = (agent: string) => (agent.includes('/') ? agent.slice(agent.indexOf('/') + 1) : '')

export type SettingChoice =
  | { type: 'agent', none: boolean }
  | { type: 'effort', agent: string }
  | { type: 'switch' }
  | { type: 'pick', values: string[] }
  | { type: 'text', long: boolean }

// The lists herdr-projects documents for each choice.
const PICKS: Record<string, string[]> = {
  'review.when': ['repos', 'always', 'never'],
  'review.mustFix': ['critical', 'major', 'minor', 'trivial'],
  'merge.by': ['you', 'itself'],
  'merge.checks': ['github', 'none'],
  'attempts.pick': ['you', 'reviewer'],
  'plan.approve': ['none', 'you', 'reviewer'],
  'board.open': ['tab', 'popup'],
}
const ACCESS = ['full', 'ask']
const AGENT_NONE = ['plan.agent', 'coordinator.agent', 'watcher.agent']
const LONG = ['worker.instructions', 'reviewer.instructions', 'coordinator.instructions', 'board.notify', 'board.keys']

export function settingChoice(name: string, value: unknown): SettingChoice {
  if (typeof value === 'boolean') return { type: 'switch' }
  if (PICKS[name]) return { type: 'pick', values: PICKS[name]! }
  const [head, tail] = name.split('.')
  if (tail === 'access' && ['worker', 'reviewer', 'coordinator'].includes(head!)) return { type: 'pick', values: ACCESS }
  if (tail === 'agent' && ['worker', 'reviewer', 'coordinator', 'plan', 'watcher'].includes(head!)) return { type: 'agent', none: AGENT_NONE.includes(name) }
  if (tail === 'effort' && ['worker', 'reviewer', 'coordinator'].includes(head!)) return { type: 'effort', agent: `${head}.agent` }
  return { type: 'text', long: LONG.includes(name) }
}

// ------------------------------------------------------------ commands
export const SETTING_NAME_RE = /^[a-z][A-Za-z]*\.[a-z][A-Za-z]*$/
export const SETTING_VALUE_MAX = 8000
const REPO_RE = /^[A-Za-z0-9][\w.-]{0,79}$/
export interface SettingChange { name: string, repo?: string, value?: string, unset?: boolean }
// `set|unset [--repo=R] -- <name> [<value>]`. Throws on what cannot be sent.
export function settingArgs(c: { name?: unknown, repo?: unknown, value?: unknown, unset?: unknown }): string[] {
  if (typeof c.name !== 'string' || !SETTING_NAME_RE.test(c.name)) throw new Error('Invalid setting')
  const repo = c.repo === undefined || c.repo === null || c.repo === '' ? '' : c.repo
  if (typeof repo !== 'string' || (repo && !REPO_RE.test(repo))) throw new Error('Invalid repository')
  const where = repo ? [`--repo=${repo}`] : []
  if (c.unset === true) return ['unset', ...where, '--', c.name]
  if (c.unset !== undefined && c.unset !== false) throw new Error('Invalid setting')
  // eslint-disable-next-line no-control-regex
  if (typeof c.value !== 'string' || !c.value.trim() || c.value.length > SETTING_VALUE_MAX || /\u0000/.test(c.value)) throw new Error('Invalid value')
  return ['set', ...where, '--', c.name, c.value.trim()]
}

// ------------------------------------------------------------ confirmations
// Settings whose change acts at once on work already under way, across the
// board (herdr-projects reads them right before the step). The key the caller
// turns into a sentence (app/utils/boardSettings.ts).
export type SettingWarning = 'mergeItself' | 'mergeNoChecks' | 'noReview' | 'mayMergeItself' | 'mayMergeNoChecks' | 'boardAgents' | 'noCoordinator'
export function settingWarning(name: string, value: string | null): SettingWarning | null {
  // Capacity changes immediately, including when restoring the inherited value.
  if (name === 'board.agents') return 'boardAgents'
  // `unset`: the inherited value applies at once; it may be the risky one.
  if (value === null) {
    if (name === 'merge.by') return 'mayMergeItself'
    if (name === 'merge.checks') return 'mayMergeNoChecks'
    return null
  }
  const v = value.trim()
  if (name === 'merge.by' && v === 'itself') return 'mergeItself'
  if (name === 'merge.checks' && v === 'none') return 'mergeNoChecks'
  if (name === 'review.when' && v === 'never') return 'noReview'
  if (name === 'coordinator.agent' && v === 'none') return 'noCoordinator'
  return null
}
