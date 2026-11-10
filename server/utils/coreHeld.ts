// Messages that wait on the server while Codex installs or updates itself
// (Pane.installing): typed into Codex once it is ready, one at a time. When
// Codex is gone instead (exited, or stopped by its update) they are dropped
// here, and the device that sent them puts them back into its message field
// (app/composables/useOutbox.ts outboxReturnHeld). Never typed into a shell.
import type { Pane, QueuedMessage } from '../../shared/types'

const CLIENT_ID = /^w-[a-z0-9]{1,32}$/
const ready = (p: Pane) => p.agent === 'codex' && !p.installing && !p.stopped && p.status !== 'working' && p.status !== 'blocked'

export function createHeld(send: (p: Pane, q: QueuedMessage) => Promise<unknown>, now = Date.now) {
  const held = new Map<string, QueuedMessage[]>() // by core address
  const sending = new Set<string>()
  let seq = 0
  return {
    // `clientId`: the app's id for the bubble it already shows (app/utils/outbox.ts).
    hold(p: Pane, text: string, clientId?: unknown): QueuedMessage {
      const list = held.get(p.coreAddress!) || []
      const own = typeof clientId === 'string' && CLIENT_ID.test(clientId) && !list.some(q => q.id === clientId) ? clientId : null
      const q: QueuedMessage = { id: own || `held-${++seq}`, text, at: now(), state: 'held' }
      held.set(p.coreAddress!, [...list, q])
      return q
    },
    // With each new state: lists the waiting messages on their panes, types the
    // oldest one into a Codex that is ready, drops those of a Codex that is gone.
    apply(panes: Pane[]) {
      for (const [address, list] of held) {
        const p = panes.find(x => x.coreAddress === address)
        if (!p || p.agent !== 'codex' || p.stopped) { held.delete(address); continue }
        if (ready(p) && !sending.has(address)) {
          const [next, ...rest] = list
          if (rest.length) held.set(address, rest)
          else held.delete(address)
          sending.add(address)
          void send(p, next!).catch(() => {}).finally(() => sending.delete(address))
        }
        const left = held.get(address)
        if (left) p.queued = left
      }
    },
  }
}
