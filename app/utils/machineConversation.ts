import type { HerdrState } from '../../shared/types'
import { BAR_ALL, barMachineSelection, type MachineGroup } from './machineBar'

export type Conversation = { pane: string } | { tab: string }
export type ConversationMemory = Record<string, Conversation>
export function readConversationMemory(raw: string | null): ConversationMemory {
  try {
    const value = JSON.parse(raw || '{}')
    if (!value || Array.isArray(value) || typeof value !== 'object') return {}
    const result: ConversationMemory = {}
    for (const [key, entry] of Object.entries(value)) {
      if (!entry || typeof entry !== 'object') continue
      if ('pane' in entry && typeof entry.pane === 'string') Object.defineProperty(result, key, { value: { pane: entry.pane }, enumerable: true })
      else if ('tab' in entry && typeof entry.tab === 'string') Object.defineProperty(result, key, { value: { tab: entry.tab }, enumerable: true })
    }
    return result
  } catch { return {} }
}
export function conversationMachine(s: HerdrState, view: Conversation): string | undefined {
  const item = 'pane' in view ? s.panes.find(p => p.id === view.pane) : s.tabs?.find(t => t.id === view.tab && s.panes.some(p => p.tab === t.id))
  if (!item) return undefined
  const key = s.workspaces.find(w => w.id === item.workspace)?.machine ?? item.machine ?? ''
  return s.machines?.find(m => m.key === key)?.baseKey ?? key
}
export function conversationIn(s: HerdrState, view: Conversation, pick: string | null, groups: MachineGroup[]): boolean {
  const machine = conversationMachine(s, view)
  const selection = barMachineSelection(pick, groups)
  return machine !== undefined && (selection === null || selection.includes(machine))
}
// undefined keeps the current route; null opens the usual empty state.
export function machineConversation(s: HerdrState, pick: string | null, groups: MachineGroup[], memory: ConversationMemory, current: Conversation | null): Conversation | null | undefined {
  if (pick === null || pick === BAR_ALL || (current && conversationIn(s, current, pick, groups))) return undefined
  const saved = Object.hasOwn(memory, pick) ? memory[pick] : undefined
  if (saved && conversationIn(s, saved, pick, groups)) return saved
  return null
}
