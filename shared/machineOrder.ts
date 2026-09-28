// L'ordre concerne seulement la liste de l'accueil. Les sessions d'une même
// machine suivent leur machine d'origine ; les nouvelles arrivent après celles
// que l'utilisateur a placées.
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

// La machine locale a pour clé la chaîne vide : toujours comparer à null,
// jamais tester la clé comme un booléen.
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

// Ordre lu sur disque : chaînes connues, sans doublon. '' (machine locale) est
// une clé valide comme les autres.
export function cleanMachineOrder(value: unknown, known: string[]): string[] {
  if (!Array.isArray(value)) return []
  const ok = new Set(known)
  return value.filter((key, index): key is string => typeof key === 'string' && ok.has(key) && value.indexOf(key) === index)
}

export function validMachineOrder(order: unknown, known: string[]): order is string[] {
  return Array.isArray(order) && order.length <= known.length && new Set(order).size === order.length &&
    order.every(key => typeof key === 'string' && known.includes(key))
}
