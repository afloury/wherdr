// Server restart (redeployment): its first state may be partial.
// The server only says it is "ready" once the machine list is read, the
// local machine probed and each remote machine either probed or declared
// offline (or after READY_MAX_MS, so it never stays stuck).
// The app keeps its last state while the server is not ready, then, right
// after a reconnection, keeps the panes of machines that are reconnecting:
// the open view never unmounts for a transient reason.
import type { HerdrState, MachineInfo } from './types'
import { LOCAL, machineOf } from './ids'

export const READY_MAX_MS = 20000

export interface ReadyInput {
  machinesListed: boolean
  localPolled: boolean
  remotes: { status: MachineInfo['status'], polled: boolean }[]
  elapsedMs: number
}

export function serverReady(i: ReadyInput): boolean {
  if (i.elapsedMs >= READY_MAX_MS) return true
  return i.machinesListed && i.localPolled && i.remotes.every(r => r.polled || r.status === 'offline')
}

// State to show: null = keep the current state. `settling`: recent
// reconnection (the server may have restarted).
export function settleState(prev: HerdrState | null, next: HerdrState, settling: boolean): HerdrState | null {
  if (!prev || !prev.ok) return next
  if (next.ready === false) return null
  if (!settling || !next.ok) return next
  // Panes of remote machines missing from the received state, or not online yet:
  // we keep their last state (grayed out like an offline machine).
  const online = new Set([LOCAL, ...(next.machines || []).filter(m => m.status === 'online').map(m => m.key)])
  const present = new Set(next.panes.map(p => machineOf(p.id)))
  const keep = (id: string) => {
    const m = machineOf(id)
    return m !== LOCAL && !online.has(m) && !present.has(m)
  }
  const panes = prev.panes.filter(p => keep(p.id))
  if (!panes.length) return next
  const kept = new Set(panes.map(p => machineOf(p.id)))
  const known = new Set((next.machines || []).map(m => m.key))
  const lost = (prev.machines || []).filter(m => kept.has(m.key) && !known.has(m.key))
    .map((m): MachineInfo => ({ ...m, status: 'connecting' }))
  const localInfo: MachineInfo[] = next.machines ? [] : (prev.machines || []).filter(m => m.key === LOCAL)
  return {
    ...next,
    workspaces: [...next.workspaces, ...prev.workspaces.filter(w => keep(w.id))],
    tabs: [...(next.tabs || []), ...(prev.tabs || []).filter(t => keep(t.id))],
    panes: [...next.panes, ...panes],
    machines: [...localInfo, ...(next.machines || []), ...lost],
  }
}
