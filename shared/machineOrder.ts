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
