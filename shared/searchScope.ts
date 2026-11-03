import type { TaskHit } from './taskSearch'

// v3 (herdr-core) has no Board: its tasks are never read nor searched.
export async function boardTaskHits(core: boolean, read: () => Promise<TaskHit[]>): Promise<TaskHit[]> {
  if (core) return []
  return read().catch(() => [])
}
