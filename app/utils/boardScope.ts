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
// machine; after that, and after a choice made by hand, refreshes and new
// visits to the Board on the same tab keep what was chosen. The next tab
// starts from its own selection.
export function boardTabScope() {
  let tab: string | null | undefined
  let chosen: string | undefined
  return {
    manual(scope: string) { chosen = scope },
    update(pick: string | null, machines: readonly string[], groups: readonly MachineGroup[]): string | undefined {
      if (pick !== tab) { tab = pick; chosen = undefined }
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
