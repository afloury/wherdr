// One synchronized policy, evaluated identically by the server and the UI.
import type { MachineLinks } from './boardLinks'
import type { HerdrState, Pane } from './types'
import { machineOf } from './ids'

export const NOTIFICATION_EVENTS = ['needs-you', 'finished', 'message', 'scheduled'] as const
export type NotificationEvent = typeof NOTIFICATION_EVENTS[number]
export const COORDINATOR_EVENTS: NotificationEvent[] = ['needs-you', 'finished']
export type NotificationScope = 'machine' | 'project' | 'conversation'
export interface NotificationTarget { scope: NotificationScope, machine: string, id: string, label: string }
export interface NotificationRule extends NotificationTarget {
  mode: 'on' | 'muted' | 'inherit'
  events: NotificationEvent[]
  until: number | null
}
export interface NotificationSettings {
  defaults: NotificationEvent[]
  muteSubagents: boolean
  rules: NotificationRule[]
}
export interface NotificationSource {
  machine: string
  project?: string
  conversation?: string
  coordinator?: boolean
  subagent?: boolean
}
export const defaultNotifications = (): NotificationSettings => ({ defaults: [], muteSubagents: true, rules: [] })
const eventsOf = (value: unknown): NotificationEvent[] => Array.isArray(value)
  ? NOTIFICATION_EVENTS.filter(e => value.includes(e)) : []

export function parseNotificationSettings(raw: string | null | undefined): NotificationSettings {
  const fallback = defaultNotifications()
  try {
    const v = JSON.parse(raw || 'null')
    if (!v || typeof v !== 'object' || Array.isArray(v)) return fallback
    const rules: NotificationRule[] = []
    if (Array.isArray(v.rules)) for (const r of v.rules.slice(0, 100)) {
      if (!r || !['machine', 'project', 'conversation'].includes(r.scope)
        || !['on', 'muted', 'inherit'].includes(r.mode)
        || typeof r.machine !== 'string' || r.machine.length > 80
        || typeof r.id !== 'string' || r.id.length > 512
        || typeof r.label !== 'string' || r.label.length > 120
        || (r.until !== null && (typeof r.until !== 'number' || !Number.isFinite(r.until) || r.until <= 0))) continue
      const rule: NotificationRule = { scope: r.scope, machine: r.machine, id: r.id, label: r.label,
        mode: r.mode, events: eventsOf(r.events), until: r.until }
      const old = rules.findIndex(x => sameNotificationTarget(x, rule))
      if (old >= 0) rules.splice(old, 1)
      rules.push(rule)
    }
    return { defaults: eventsOf(v.defaults), muteSubagents: v.muteSubagents !== false, rules }
  } catch { return fallback }
}
export const sameNotificationTarget = (a: NotificationTarget, b: NotificationTarget) =>
  a.scope === b.scope && a.machine === b.machine && a.id === b.id

export function notificationEvents(settings: NotificationSettings, source: NotificationSource, now = Date.now()): NotificationEvent[] {
  const rule = (scope: NotificationScope, id: string | undefined) => id === undefined ? undefined
    : settings.rules.find(r => r.scope === scope && r.machine === source.machine && r.id === id
      && r.mode !== 'inherit' && (r.until === null || r.until > now))
  const conversation = rule('conversation', source.conversation)
  if (conversation) return conversation.mode === 'muted' ? [] : conversation.events
  // The preset is a conversation default: broad "all" rules must not wake
  // every board worker. Opt a task in explicitly at conversation level.
  if (source.subagent && settings.muteSubagents) return []
  const inherited = rule('project', source.project) || rule('machine', '')
  if (inherited) return inherited.mode === 'muted' ? [] : inherited.events
  return source.coordinator ? COORDINATOR_EVENTS : settings.defaults
}

// Board files identify coordinators and every helper (including attempts).
// Repo keys from Herdr are shared by worktrees; board repo names are used when
// the board owns the conversation so its project menu addresses the same rule.
export function paneNotificationSource(pane: Pick<Pane, 'id' | 'workspace'>, state: Pick<HerdrState, 'workspaces'>,
  boards: MachineLinks[], baseMachine = machineOf(pane.id)): NotificationSource {
  const ws = state.workspaces.find(w => w.id === pane.workspace)
  for (const board of boards) {
    const coordinator = board.coordinators.find(c => c.pane === pane.id)
    if (coordinator) return { machine: board.machine, project: coordinator.repo, conversation: pane.id, coordinator: true }
    const task = board.tasks.find(t => t.panes.some(p => p.id === pane.id) || (t.workspace !== null && t.workspace === pane.workspace))
    if (task) return { machine: board.machine, project: task.repo, conversation: pane.id, subagent: true }
  }
  const board = boards.find(b => b.machine === baseMachine)
  const linked = board?.tasks.find(t => ws?.repo && state.workspaces.find(w => w.id === t.workspace)?.repo === ws.repo)
  const repo = board?.repos?.find(r => r.root === ws?.repo || `${r.root}/.git` === ws?.repo || r.repo === ws?.repoName)
  return { machine: baseMachine, project: linked?.repo || repo?.repo || ws?.repoName || ws?.repo || undefined, conversation: pane.id }
}

// A lease uses server time only. A hidden, disconnected or idle tab cannot
// suppress push forever; the last visible heartbeat expires after 30 seconds.
export class NotificationPresence {
  private leases = new Map<string, { pane: string, at: number }>()
  heartbeat(client: string, pane: string | null, visible: boolean, now = Date.now()) {
    this.prune(now)
    if (visible && pane) this.leases.set(client, { pane, at: now })
  }
  private prune(now: number) {
    for (const [id, lease] of this.leases) if (now - lease.at >= 30_000) this.leases.delete(id)
  }
  viewed(pane: string, now = Date.now()) {
    this.prune(now)
    return [...this.leases.values()].some(lease => lease.pane === pane)
  }
}
