import type { CoordinatorTarget } from './projectsTasks'

// The first herdr-projects with `autopilot on|off` and `autopilot --json`.
export const AUTOPILOT_MIN = '1.2.15'

export interface AutopilotStatus {
  on: boolean
  // The goal it works toward ('' when none is saved).
  goal: string
  // "next in 59m", "waits for its hours"… as the board says it.
  next: string
  state: string
  // Why its last wake could not do anything ('' when nothing went wrong).
  couldNot: string
}
// What `on` uses when a value is left empty, read from `show`.
export interface AutopilotDefaults { every: string, tasksPerDay: string, tasksAtOnce: string }
export interface AutopilotDetails extends AutopilotStatus { defaults: AutopilotDefaults }

// The id `autopilot --json` gives each coordinator.
export function autopilotId(to: CoordinatorTarget): string {
  return to.kind === 'project' ? `project:${to.repo}` : to.kind
}
export function autopilotTargetArgs(to: CoordinatorTarget): string[] {
  return to.kind === 'project' ? ['--project', to.repo] : to.kind === 'machine' ? ['--machine'] : []
}
// `show`'s flag for one coordinator's settings.
export function coordinatorShowArgs(to: CoordinatorTarget): string[] {
  return to.kind === 'project' ? ['--project-coordinator', to.repo] : [to.kind === 'main' ? '--main-coordinator' : '--machine-coordinator']
}

export const AUTOPILOT_SETTINGS = ['every', 'tasksPerDay', 'tasksAtOnce'] as const
export function autopilotOnArgs(to: CoordinatorTarget, input: Record<string, unknown>): string[] {
  const goal = typeof input.goal === 'string' ? input.goal.trim() : ''
  if (!goal || goal.length > 16000) throw new Error('An Autopilot goal is required (maximum 16000 characters).')
  const args = ['autopilot', 'on', ...autopilotTargetArgs(to), '--goal', goal]
  for (const name of AUTOPILOT_SETTINGS) {
    const value = typeof input[name] === 'string' ? (input[name] as string).trim() : input[name]
    if (value === undefined || value === null || value === '') continue
    if (typeof value !== 'string' || value.length > 100 || value.startsWith('-')) throw new Error('Invalid Autopilot setting.')
    args.push(`--autopilot.${name}`, value)
  }
  return args
}

const text = (v: unknown) => typeof v === 'string' ? v : ''
function statusOf(v: Record<string, unknown>): AutopilotStatus {
  return { on: v.on === true, goal: text(v.goal), next: text(v.next), state: text(v.state), couldNot: text(v.couldNot) }
}
// `autopilot --json`: every coordinator of the machine, by its id. A coordinator
// missing from the list has never been on autopilot: it is off.
export function parseAutopilotList(stdout: string): Record<string, AutopilotStatus> {
  const list = JSON.parse(stdout)
  if (!Array.isArray(list)) throw new Error('Invalid Autopilot status.')
  const out: Record<string, AutopilotStatus> = {}
  for (const v of list) {
    if (v && typeof v === 'object' && typeof v.coordinator === 'string' && typeof v.on === 'boolean') out[v.coordinator] = statusOf(v)
  }
  return out
}
export const OFF: AutopilotStatus = { on: false, goal: '', next: '', state: '', couldNot: '' }

// `show --<x>-coordinator --json`: its saved goal and the values `on` falls back on.
// An unset goal reads "none".
export function parseCoordinatorSettings(stdout: string): { goal: string, defaults: AutopilotDefaults } {
  const settings: unknown = JSON.parse(stdout)?.settings
  const value = (name: string) => {
    const s = Array.isArray(settings) ? settings.find(x => x?.name === `autopilot.${name}`) : undefined
    return s && (typeof s.value === 'string' || typeof s.value === 'number') ? String(s.value) : ''
  }
  const goal = value('goal')
  return { goal: goal === 'none' ? '' : goal, defaults: { every: value('every'), tasksPerDay: value('tasksPerDay'), tasksAtOnce: value('tasksAtOnce') } }
}
