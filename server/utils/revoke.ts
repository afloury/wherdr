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
