// After Lock all devices or turning the lock off (auth.lockAll / disable): the
// push subscriptions go (each device subscribes again once unlocked, under the
// new generation) and open WebSockets are judged at once, not at the next
// network reading. Returns how many WebSockets were closed.
import { dropAllSubs } from './push'
import { revalidatePeers } from './ws'

export async function revokeEverywhere(peers?: Parameters<typeof revalidatePeers>[0]): Promise<number> {
  await dropAllSubs()
  return peers ? revalidatePeers(peers) : revalidatePeers()
}

// Lock turned off: every device stays open but lost its push subscription.
// Each open app is asked to post its own again (the browser keeps it); one
// that is closed or asleep does so when it opens or reconnects.
export const PUSH_RESUBSCRIBE = JSON.stringify({ type: 'push-resubscribe' })
export function askPushResubscribe(clients: Iterable<{ send: (data: string) => void }>): number {
  let asked = 0
  for (const c of clients) {
    try {
      c.send(PUSH_RESUBSCRIBE)
      asked++
    } catch { /* client gone */ }
  }
  return asked
}
