// Mark every thought in a refreshed tail as seen, but animate only the newest
// previously unseen one. A historical slice must never start an animation.
export function newestThought(seen: Set<string>, ids: readonly string[], animate: boolean): string | null {
  let newest: string | null = null
  for (const id of ids) {
    if (!seen.has(id) && animate) newest = id
    seen.add(id)
  }
  return newest
}
