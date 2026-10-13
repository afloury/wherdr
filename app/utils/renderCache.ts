// Cache of rendered text, bounded twice: in entries and in weight (the
// characters an entry holds, given by the caller). The least recently used
// entry leaves first, so what the screen shows now outlives an old conversation.
export interface RenderCache<V> {
  get(key: string): V | undefined
  set(key: string, value: V, weight: number): void
  delete(key: string): V | undefined
  stats(): { entries: number, weight: number }
  clear(): void
}

export function createRenderCache<V>(maxEntries: number, maxWeight: number): RenderCache<V> {
  const entries = new Map<string, { value: V, weight: number }>()
  let total = 0
  function drop(key: string) {
    const e = entries.get(key)
    if (!e) return undefined
    entries.delete(key)
    total -= e.weight
    return e.value
  }
  return {
    get(key) {
      const e = entries.get(key)
      if (!e) return undefined
      entries.delete(key)
      entries.set(key, e)
      return e.value
    },
    set(key, value, weight) {
      drop(key)
      // Heavier than the whole budget: keeping it would empty the cache for one entry.
      if (weight > maxWeight) return
      entries.set(key, { value, weight })
      total += weight
      while (entries.size > maxEntries || total > maxWeight) drop(entries.keys().next().value!)
    },
    delete: drop,
    stats: () => ({ entries: entries.size, weight: total }),
    clear() { entries.clear(); total = 0 },
  }
}

// A text re-read while it is still being written comes back longer each time:
// `key` then extends one of the last keys seen. Returns the keys it replaces
// (to drop from the cache) and remembers `key`. Only the last few keys are
// compared, enough for the replies growing on screen at the same time.
export function createSupersedeTracker(depth = 8) {
  const recent: string[] = []
  return (key: string): string[] => {
    const replaced: string[] = []
    for (let i = recent.length - 1; i >= 0; i--) {
      const old = recent[i]!
      if (old === key) recent.splice(i, 1)
      else if (key.length > old.length && key.startsWith(old)) replaced.push(...recent.splice(i, 1))
    }
    recent.push(key)
    if (recent.length > depth) recent.shift()
    return replaced
  }
}
