import { notificationEvents, NotificationPresence, paneNotificationSource, parseNotificationSettings, type NotificationEvent, type NotificationSource } from '../../shared/notificationRules'
import { readBoardLinks } from './boardLinks'
import { readSettings } from './settings'
import { getMachine, machineOfPane } from './machines'
import type { HerdrState, Pane } from '../../shared/types'

export const notificationPresence = new NotificationPresence()

export async function notificationAllowed(event: NotificationEvent, state: Pick<HerdrState, 'workspaces'>,
  pane?: Pick<Pane, 'id' | 'workspace'>, fallback?: NotificationSource): Promise<boolean> {
  const settings = parseNotificationSettings((await readSettings()).notificationRules)
  const board = pane ? await readBoardLinks() : null
  const machine = pane ? machineOfPane(pane.id) : null
  const source = pane ? paneNotificationSource(pane, state, board && 'machines' in board ? board.machines : [],
    machine?.info().baseKey ?? machine?.key ?? fallback?.machine) : fallback
  if (!source) return false
  // Resolve session machine keys to the base machine used by the menus.
  const resolved = { ...source, project: source.project ?? fallback?.project, subagent: source.subagent || fallback?.subagent,
    machine: getMachine(source.machine)?.info().baseKey ?? source.machine }
  return notificationEvents(settings, resolved).includes(event)
    && !(source.conversation && notificationPresence.viewed(source.conversation))
}
