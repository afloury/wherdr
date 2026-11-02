import type { AgentStatus } from './types'
// Deliberately independent of legacy panes, desktop layouts and conversation IDs.
export interface CoreTerminal {
  agent?: string | null
  argv?: string[]
  foreground?: { argv: string[]; name?: string; cwd?: string } | null
  address: string
  name?: string | null
  title?: string
  template?: string | null
  cwd: string
  state: string
  reason?: string | null
  status?: { state: string; app?: string; msg?: string } | null
}
export interface CoreInventory {
  terminals: CoreTerminal[]
  machines: { name: string; state: string }[]
  hidden_finished: number
}
export function coreActivity(terminal: CoreTerminal): AgentStatus | 'error' {
  const state = terminal.status?.state
  return state && ['idle', 'working', 'blocked', 'done', 'error'].includes(state) ? state as AgentStatus | 'error' : 'unknown'
}
export function coreTitle(terminal: CoreTerminal) {
  return terminal.name || terminal.title || terminal.address
}
