// Who an agent is, beyond its pane: when a pane closes and another one opens
// for the same agent, the new pane has a new id. Its conversation key tells
// that it is the same agent, so its draft can follow it and its view can move
// to it: `session:<machine>:<id>`, the agent's conversation as its
// integration reports it.
// Pure functions, tested in tests/agentIdentity.test.ts.
import type { Pane } from '../../shared/types'
import { machineOf } from '../../shared/ids'

type PaneLike = Pick<Pane, 'id' | 'agentSession'> & Partial<Pick<Pane, 'agent'>>

export function agentKeys(pane: PaneLike): string[] {
  return pane.agentSession ? [`session:${machineOf(pane.id) || ''}:${pane.agentSession}`] : []
}

// Keys gathered over time, oldest first, without duplicates; capped so a
// pane that changes conversation many times keeps a small record.
export function mergeKeys(known: readonly string[], add: readonly string[], max = 8): string[] {
  const out = [...known]
  for (const k of add) if (!out.includes(k)) out.push(k)
  return out.slice(-max)
}

// The live pane that took over a closed one: another pane of the same machine
// that shares one of its keys; the newest one (ids grow) on a tie.
export function replacementPane<P extends PaneLike>(closedId: string, closedKeys: readonly string[], panes: readonly P[]): P | null {
  if (!closedKeys.length) return null
  const machine = machineOf(closedId) || ''
  let best: P | null = null
  for (const p of panes) {
    if (p.id === closedId || (machineOf(p.id) || '') !== machine) continue
    if (!agentKeys(p).some(k => closedKeys.includes(k))) continue
    if (!best || p.id.localeCompare(best.id, undefined, { numeric: true }) > 0) best = p
  }
  return best
}
