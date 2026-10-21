// Who an agent is, beyond its pane: when Herdr closes a pane and opens another
// one for the same agent (a coordinator restarted by herdr-projects, a task's
// agent started again), the new pane has a new id. These keys tell that it is
// the same agent, so its draft can follow it and its view can move to it.
//  - `session:<machine>:<id>`: the agent's conversation, as Herdr's integration
//    reports it (herdr-projects resumes the coordinator's conversation);
//  - `coord:<machine>:<level>:<repo>`: a herdr-projects coordinator;
//  - `task:<machine>:<task>:<role>:<letter>`: an agent of a board task.
// Pure functions, tested in tests/agentIdentity.test.ts.
import type { MachineLinks } from '../../shared/boardLinks'
import type { Pane } from '../../shared/types'
import { machineOf } from '../../shared/ids'

type PaneLike = Pick<Pane, 'id' | 'agentSession'> & Partial<Pick<Pane, 'agent'>>

export function agentKeys(pane: PaneLike, links: MachineLinks[] = []): string[] {
  const keys: string[] = []
  const machine = machineOf(pane.id) || ''
  if (pane.agentSession) keys.push(`session:${machine}:${pane.agentSession}`)
  for (const m of links) {
    for (const c of m.coordinators) {
      if (c.pane === pane.id) keys.push(`coord:${m.machine}:${c.level}:${c.repo || ''}`)
    }
    for (const t of m.tasks) {
      for (const p of t.panes) {
        if (p.id === pane.id) keys.push(`task:${m.machine}:${t.id}:${p.role}:${p.letter || ''}`)
      }
    }
  }
  return keys
}

// Keys gathered over time, oldest first, without duplicates; capped so a
// pane that changes conversation many times keeps a small record.
export function mergeKeys(known: readonly string[], add: readonly string[], max = 8): string[] {
  const out = [...known]
  for (const k of add) if (!out.includes(k)) out.push(k)
  return out.slice(-max)
}

// The live pane that took over a closed one: another pane of the same machine
// that shares one of its keys. A board key wins over a conversation one; on a
// tie, the newest pane (Herdr's ids grow).
export function replacementPane<P extends PaneLike>(closedId: string, closedKeys: readonly string[], panes: readonly P[], links: MachineLinks[] = []): P | null {
  if (!closedKeys.length) return null
  const machine = machineOf(closedId) || ''
  let best: { pane: P, score: number } | null = null
  for (const p of panes) {
    if (p.id === closedId || (machineOf(p.id) || '') !== machine) continue
    const shared = agentKeys(p, links).filter(k => closedKeys.includes(k))
    if (!shared.length) continue
    const score = shared.some(k => !k.startsWith('session:')) ? 2 : 1
    if (!best || score > best.score || (score === best.score && p.id.localeCompare(best.pane.id, undefined, { numeric: true }) > 0)) best = { pane: p, score }
  }
  return best?.pane ?? null
}
