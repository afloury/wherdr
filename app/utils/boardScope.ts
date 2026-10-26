// The Board's machine filter. The local machine's key is the empty string, and a
// select's item cannot have an empty value (Reka refuses it, and the item is
// lost), so the filter gives it a value of its own.
import { LOCAL } from '../../shared/ids'
import type { MachineGroup } from './machineBar'

// Every machine.
export const SCOPE_ALL = '*'
// The local machine, in the select and in the device's storage.
export const SCOPE_LOCAL = '\u0000local'

// A machine's key → its value in the select.
export const boardScopeValue = (machine: string) => (machine === LOCAL ? SCOPE_LOCAL : machine)
// A value from the select (or the device's storage) → a machine's key, or SCOPE_ALL.
export const boardScopeMachine = (value: string | null | undefined) => (value === SCOPE_LOCAL ? LOCAL : value || SCOPE_ALL)

// A value is a machine's key, SCOPE_ALL, or a machine group's ID (Settings ›
// Appearance › Machine bar). Group IDs start with `*group:`: never a machine key.
export const isGroupScope = (scope: string) => scope.startsWith('*group:')

// The Board's scope follows the sidebar tab (the machine bar's pick): one
// automatic choice per tab. A late Board read may still bring the tab's
// machine; after that, and after a choice made by hand, refreshes, page
// reloads and new visits to the Board on the same tab keep what was chosen.
// The next tab starts from its own selection.
//
// A choice made by hand is kept on the device with the tab it was made on, so
// that a reload keeps it: the pick may pass through other tabs while the page
// loads (the machines arrive later), and only `forget` (the user chose another
// tab) drops it.
export interface BoardTabStore {
  read: () => string | null
  write: (value: string | null) => void
}
const TAB_CHOICE_KEY = 'boardMachineTab'
const deviceStore: BoardTabStore = {
  read() { try { return localStorage.getItem(TAB_CHOICE_KEY) } catch { return null } },
  write(value) {
    try { if (value === null) localStorage.removeItem(TAB_CHOICE_KEY); else localStorage.setItem(TAB_CHOICE_KEY, value) }
    catch { /* storage unavailable */ }
  },
}
function readTabChoice(store: BoardTabStore): { tab: string | null, scope: string } | undefined {
  try {
    const v = JSON.parse(store.read() || 'null')
    if (v && (typeof v.tab === 'string' || v.tab === null) && typeof v.scope === 'string') return { tab: v.tab, scope: v.scope }
  }
  catch { /* not ours */ }
}

export function boardTabScope(store: BoardTabStore = deviceStore) {
  let tab: string | null | undefined
  let chosen: string | undefined
  const followTab = (pick: string | null) => {
    if (pick === tab) return
    tab = pick
    const saved = readTabChoice(store)
    chosen = saved && saved.tab === pick ? saved.scope : undefined
  }
  return {
    followTab,
    manual(scope: string) {
      chosen = scope
      if (tab !== undefined) store.write(JSON.stringify({ tab, scope }))
    },
    // The user chose another sidebar tab: the choice made by hand is over.
    forget() { store.write(null) },
    update(pick: string | null, machines: readonly string[], groups: readonly MachineGroup[]): string | undefined {
      followTab(pick)
      if (chosen !== undefined || pick === null) return chosen
      const group = groups.find(g => g.id === pick)
      if (pick === SCOPE_ALL || (group ? group.machines.some(m => machines.includes(m)) : machines.includes(pick))) return chosen = pick
    },
  }
}

// One per app, so that leaving the Board and coming back keeps the choice.
export const boardTabChoice = boardTabScope()

export type BoardScopeItem =
  | { label: string, value: string, icon?: string }
  | { type: 'label', label: string }
  | { type: 'separator' }

// "All machines", then the machine groups under their heading, then each
// machine with a board, in Herdr's order, with its label. No group: as before.
export function boardScopeItems(machines: string[], label: (machine: string) => string, allLabel: string,
  groups: readonly MachineGroup[] = [], groupsLabel = 'Groups', machinesLabel = 'Machines'): BoardScopeItem[] {
  const all: BoardScopeItem = { label: allLabel, value: SCOPE_ALL }
  const each: BoardScopeItem[] = machines.map(m => ({ label: label(m), value: boardScopeValue(m) }))
  if (!groups.length) return [all, ...each]
  return [
    all,
    { type: 'separator' },
    { type: 'label', label: groupsLabel },
    ...groups.map(g => ({ label: g.name, value: g.id, icon: 'i-lucide-group' })),
    { type: 'separator' },
    { type: 'label', label: machinesLabel },
    ...each,
  ]
}

// The scope shown: a machine still on the Board, a group still defined, else
// every machine (the machine went away, the group was deleted).
export function boardShownScope(scope: string, machines: readonly string[], groups: readonly MachineGroup[]): string {
  if (scope === SCOPE_ALL) return SCOPE_ALL
  if (isGroupScope(scope)) return groups.some(g => g.id === scope) ? scope : SCOPE_ALL
  return machines.includes(scope) ? scope : SCOPE_ALL
}

// The machines a shown scope covers, or null for every machine.
export function boardScopeMachines(scope: string, groups: readonly MachineGroup[]): string[] | null {
  if (scope === SCOPE_ALL) return null
  if (isGroupScope(scope)) return groups.find(g => g.id === scope)?.machines ?? null
  return [scope]
}

// A machine's name on the Board: Herdr's name for it; the local machine falls
// back to this machine's name, any other to its key, so that a machine Herdr
// does not name (yet) is never taken for this one.
export function boardMachineLabel(machine: string, name: string, localName: string) {
  return name || (machine === LOCAL ? localName : machine)
}

// Board settings opened on a scope (the Board's filter, or a machine bar item):
// the machines it covers that have a board, in the Board's order. One: its
// settings open at once; several ("All", a group): the screen asks which.
export function boardSettingsMachines(scope: string, machines: readonly string[], groups: readonly MachineGroup[]): string[] {
  const only = boardScopeMachines(scope, groups)
  return only === null ? [...machines] : machines.filter(m => only.includes(m))
}

// A task opened (from the sidebar or a card): the scope that shows its machine.
// The scope shown already covers it: undefined, nothing changes. Otherwise the
// sidebar tab (the machine bar's pick, already moved to the task's machine) if
// it covers it, so that the Board and the sidebar match; else every machine.
export function boardScopeFor(machine: string, shown: string, pick: string | null, groups: readonly MachineGroup[]): string | undefined {
  const covers = (scope: string) => {
    const only = boardScopeMachines(scope, groups)
    return only === null || only.includes(machine)
  }
  if (covers(shown)) return undefined
  return pick !== null && covers(pick) ? pick : SCOPE_ALL
}
