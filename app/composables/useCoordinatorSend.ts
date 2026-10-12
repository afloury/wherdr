// Messages to a project's coordinator pane, and the "Sent" state of the task
// actions: shared by the Project panel and the Board, so a task sent from one
// shows as sent in the other. The state is module level: it survives tab
// switches, until the coordinator removes the task from its list.
import type { QueuedMessage } from '#shared/types'
import type { BoardAction } from '#shared/globalBoard'
import type { ListKind, ProjectBoard } from '#shared/projectBoard'
import { viaPrompt } from '#shared/sendRoute'

// Sends `text` to the coordinator pane as a message. null or a queued message: sent.
// false: refused (offline, no agent in the pane) or failed, the user has been told.
// Never typed as keys (/api/input, the route of an answer on screen): from the
// Board the user does not see the coordinator's screen, and Enter would answer
// its question or permission dialog, or run the text in a shell. /api/prompt
// holds the message until the input field is back.
export async function sendToCoordinator(paneId: string, text: string): Promise<QueuedMessage | null | false> {
  const pane = herdrState.value.panes.find(p => p.id === paneId)
  if (!eventsOpen.value || offlineView.value || paneStale(pane)) {
    toast(t('Sending unavailable offline'), true)
    return false
  }
  if (!pane?.agent) {
    toast(t('The coordinator is not running'), true)
    return false
  }
  try {
    if (viaPrompt(pane)) return await sendMessage(pane, paneId, text)
    return (await api<{ queued?: QueuedMessage }>('/api/prompt', { pane_id: paneId, text })).queued || null
  } catch (e) {
    toast((e as Error).message, true)
    return false
  }
}

// Keys `kind|action|text`, per coordinator pane.
const sent = reactive(new Map<string, Set<string>>())

export const sentKey = (kind: ListKind | null, action: BoardAction, text: string) => `${kind}|${action}|${text}`
export const isSent = (paneId: string, key: string) => Boolean(sent.get(paneId)?.has(key))
export function markSent(paneId: string, key: string) {
  const keys = sent.get(paneId)
  if (keys) keys.add(key)
  else sent.set(paneId, new Set([key]))
}

// Every action but Move up / down sends the task away from its list: once one is
// sent (from the panel or the Board), the task shows "Sent" and offers no other.
const SENT_ACTIONS: readonly BoardAction[] = ['tested', 'launch', 'unblock', 'reviewed', 'queue', 'now', 'unqueue', 'backlog', 'block', 'todo', 'done']
export const isTaskSent = (paneId: string, kind: ListKind | null, text: string) => SENT_ACTIONS.some(a => isSent(paneId, sentKey(kind, a, text)))

// The task action on its way, app-wide: one at a time, so two quick taps (or a
// tap and a drop) never send two instructions for the same task.
export const taskSending = ref<string | null>(null)

// Sends one task action, unless another is on its way or it was already sent.
// Move up / down can be sent again; the others are marked sent.
export async function sendTask(paneId: string, kind: ListKind | null, action: BoardAction, text: string, message: string): Promise<QueuedMessage | null | false> {
  const key = sentKey(kind, action, text)
  if (taskSending.value || isSent(paneId, key)) return false
  taskSending.value = key
  haptic()
  try {
    const queued = await sendToCoordinator(paneId, message)
    if (queued !== false && action !== 'up' && action !== 'down') markSent(paneId, key)
    return queued
  } finally { taskSending.value = null }
}

// Forgets the keys whose task is no longer in a list of that kind.
export function pruneSent(paneId: string, board: ProjectBoard) {
  const keys = sent.get(paneId)
  if (!keys) return
  for (const key of [...keys]) {
    const [kind, , ...text] = key.split('|')
    const task = text.join('|')
    if (!board.lists.some(l => String(l.kind) === kind && l.tasks.some(x => x.text === task))) keys.delete(key)
  }
}
