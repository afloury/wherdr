import type { CoreTerminal } from './coreInventory'

// herdr-core `events.subscribe`: a snapshot, then one `event` notification per fact
// change, numbered by `seq`. This applies one event to the terminals we hold.
export interface CoreEvent { type: string; terminal?: string; seq?: number; data?: Record<string, unknown> }
export type CoreTerminals = Map<string, CoreTerminal>

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const ended = (state: unknown) => state === 'finished' || state === 'lost'

// The live terminals of a snapshot, a `missed` resync or a `terminal.list`: core lists a
// remote machine's finished terminals too, and wherdr shows only live ones.
export function liveTerminals(list: CoreTerminal[]): CoreTerminals {
  return new Map(list.filter(t => t && typeof t.address === 'string' && !ended(t.state)).map(t => [t.address, t]))
}

// Returns what changed: 'terminal' (a terminal fact), 'doc' (a shared document changed),
// or null (unknown type, unknown terminal or heartbeat: ignored).
export function applyCoreEvent(terminals: CoreTerminals, event: CoreEvent): 'terminal' | 'doc' | null {
  const data = isObject(event.data) ? event.data : {}
  if (event.type === 'doc') return 'doc'
  if (!event.terminal) return null
  if (event.type === 'created' || event.type === 'restarted') {
    if (typeof data.address !== 'string') return null
    // Core re-announces a remote machine's terminals (after a rename or a reconnect),
    // finished ones included: those must not come back as live terminals.
    if (ended(data.state)) return terminals.delete(event.terminal) ? 'terminal' : null
    terminals.set(event.terminal, { ...terminals.get(event.terminal), ...data } as CoreTerminal)
    return 'terminal'
  }
  const t = terminals.get(event.terminal)
  if (!t) return null
  switch (event.type) {
    // A finished, lost or removed terminal leaves the live list.
    case 'removed': case 'finished': case 'lost': terminals.delete(event.terminal); return 'terminal'
    case 'status': {
      // `{status:{state}}` (core 0.1.16); a bare `{state}` is read too.
      const status = isObject(data.status) ? data.status : typeof data.state === 'string' ? data : null
      terminals.set(event.terminal, { ...t, status: status as CoreTerminal['status'] })
      return 'terminal'
    }
    case 'turn':
      if (typeof data.turn === 'number') terminals.set(event.terminal, { ...t, turn: data.turn })
      return 'terminal'
    case 'title': if (typeof data.title === 'string') terminals.set(event.terminal, { ...t, title: data.title }); return 'terminal'
    case 'labels': if (isObject(data.labels)) terminals.set(event.terminal, { ...t, labels: data.labels as Record<string, string> }); return 'terminal'
    case 'keep': if (typeof data.keep === 'boolean') terminals.set(event.terminal, { ...t, keep: data.keep }); return 'terminal'
    case 'size': terminals.set(event.terminal, { ...t, cols: Number(data.cols) || t.cols, rows: Number(data.rows) || t.rows }); return 'terminal'
    case 'foreground': terminals.set(event.terminal, { ...t, foreground: (typeof data.name === 'string' ? data : null) as CoreTerminal['foreground'] }); return 'terminal'
    default: return null
  }
}
