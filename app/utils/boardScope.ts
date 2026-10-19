// The Board's machine filter. The local machine's key is the empty string, and a
// select's item cannot have an empty value (Reka refuses it, and the item is
// lost), so the filter gives it a value of its own.
import { LOCAL } from '../../shared/ids'

// Every machine.
export const SCOPE_ALL = '*'
// The local machine, in the select and in the device's storage.
export const SCOPE_LOCAL = '\u0000local'

// A machine's key → its value in the select.
export const boardScopeValue = (machine: string) => (machine === LOCAL ? SCOPE_LOCAL : machine)
// A value from the select (or the device's storage) → a machine's key, or SCOPE_ALL.
export const boardScopeMachine = (value: string | null | undefined) => (value === SCOPE_LOCAL ? LOCAL : value || SCOPE_ALL)

// "All machines", then each machine with a board, in Herdr's order, with its label.
export function boardScopeItems(machines: string[], label: (machine: string) => string, allLabel: string) {
  return [{ label: allLabel, value: SCOPE_ALL }, ...machines.map(m => ({ label: label(m), value: boardScopeValue(m) }))]
}

// A machine's name on the Board: Herdr's name for it; the local machine falls
// back to this machine's name, any other to its key, so that a machine Herdr
// does not name (yet) is never taken for this one.
export function boardMachineLabel(machine: string, name: string, localName: string) {
  return name || (machine === LOCAL ? localName : machine)
}
