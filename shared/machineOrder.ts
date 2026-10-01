// The order only applies to the home list. Sessions of the same
// machine follow their original machine; new ones come after those
// the user has placed.
export function sortMachines<T extends { key: string, baseKey?: string }>(machines: T[], order: string[]): T[] {
  const rank = new Map(order.map((key, index) => [key, index]))
  return machines.map((machine, index) => ({ machine, index }))
    .sort((a, b) => (rank.get(a.machine.baseKey ?? a.machine.key) ?? Infinity) - (rank.get(b.machine.baseKey ?? b.machine.key) ?? Infinity) || a.index - b.index)
    .map(x => x.machine)
}

export function moveMachine(order: string[], key: string, before: string | null): string[] {
  const next = order.filter(k => k !== key)
  const at = before === null ? next.length : next.indexOf(before)
  if (at < 0) return order
  next.splice(at, 0, key)
  return next
}

// The local machine's key is the empty string: always compare with null,
// never test the key as a boolean.
export function shiftMachineKey(keys: string[], key: string, direction: -1 | 1): string[] | null {
  const at = keys.indexOf(key)
  const other = at + direction
  if (at < 0 || other < 0 || other >= keys.length) return null
  const next = [...keys]
  ;[next[at], next[other]] = [next[other]!, next[at]!]
  return next
}

export function dropMachineKey(keys: string[], from: string | null, target: string, after: boolean): string[] | null {
  if (from === null || from === target || !keys.includes(from) || !keys.includes(target)) return null
  const before = after ? keys[keys.indexOf(target) + 1] ?? null : target
  const next = moveMachine(keys, from, before)
  return next.every((k, i) => k === keys[i]) ? null : next
}

// Order read from disk: known strings, no duplicates. '' (local machine) is
// a valid key like the others.
export function cleanMachineOrder(value: unknown, known: string[]): string[] {
  if (!Array.isArray(value)) return []
  const ok = new Set(known)
  return value.filter((key, index): key is string => typeof key === 'string' && ok.has(key) && value.indexOf(key) === index)
}

export function validMachineOrder(order: unknown, known: string[]): order is string[] {
  return Array.isArray(order) && order.length <= known.length && new Set(order).size === order.length &&
    order.every(key => typeof key === 'string' && known.includes(key))
}
