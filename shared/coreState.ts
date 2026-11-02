import type { CoreTerminal } from './coreInventory'
import { coreActivity, coreTitle } from './coreInventory'
import type { HerdrState, MachineInfo, Pane } from './types'

export interface CoreMachine { name: string; state: string; why?: string }
// Lossless encoding keeps IDs stable across inventory order and core restarts.
const key = (value: string) => Array.from(new TextEncoder().encode(value), b => b.toString(16).padStart(2, '0')).join('')
export function coreState(terminals: CoreTerminal[], machines: CoreMachine[]): HerdrState {
  const result: HerdrState = { ok: true, ready: true, workspaces: [], tabs: [], panes: [], machines: [
    { key: '', label: 'Local', local: true, status: 'online', error: null },
    ...machines.map((m): MachineInfo => ({ key: key(m.name), label: m.name, local: false,
      status: m.state === 'connected' ? 'online' : m.state === 'connecting' ? 'connecting' : 'offline', error: m.why ?? null })),
  ] }
  for (const terminal of terminals) {
    const machineName = terminal.address.includes('/') ? terminal.address.split('/')[0]! : ''
    const machine = machineName ? key(machineName) : ''
    if (machine && !result.machines!.some(m => m.key === machine)) result.machines!.push({ key: machine, label: machineName, local: false, status: 'offline', error: null })
    const prefix = machine ? `${machine}~` : ''
    const cwd = terminal.cwd || ''
    const workspace = `${prefix}w${key(cwd || terminal.address)}`
    if (!result.workspaces.some(w => w.id === workspace)) result.workspaces.push({ id: workspace, machine,
      label: cwd.split('/').filter(Boolean).pop() || 'Terminals', path: cwd, number: result.workspaces.length + 1, status: null, worktree: false })
    const id = key(terminal.address)
    const tab = `${workspace}:t${id}`
    const activity = coreActivity(terminal)
    const commands = [terminal.template, terminal.status?.app, ...(terminal.foreground?.argv ?? []), ...(terminal.argv ?? [])]
    const agent = commands.map(c => c?.split('/').pop()?.replace(/^claude-code$/, 'claude').replace(/^gemini-cli$/, 'gemini')).find(c => c && ['claude', 'codex', 'omp', 'opencode', 'gemini', 'aider'].includes(c)) ?? null
    result.tabs!.push({ id: tab, workspace, machine, label: coreTitle(terminal), number: result.tabs!.length + 1, layout: null })
    const pane: Pane = { id: `${workspace}:p${id}`, coreAddress: terminal.address, machine, workspace, tab, tabLabel: coreTitle(terminal),
      agent, name: terminal.name ?? null, label: terminal.name ?? null, title: terminal.title ?? null, cwd, agentSession: null,
      status: activity === 'error' ? 'blocked' : activity, interaction: 'unknown' }
    result.panes.push(pane)
  }
  return result
}
