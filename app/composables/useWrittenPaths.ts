// Where each path written in a pane's conversation was found (POST
// /api/files/resolve, server/utils/files.ts findWritten): asked once per path,
// one request for all the paths a render shows that are not known yet.
// Unknown (not asked yet, or the request failed): the chip stays as it was.
import type { PathFound } from '#shared/filePaths'

const known = new Map<string, Map<string, PathFound[] | 'unknown'>>()
const inFlight = new Set<string>()

export const writtenFound = (pane: string, p: string): PathFound[] | undefined => {
  const v = known.get(pane)?.get(p)
  return Array.isArray(v) ? v : undefined
}

export async function resolveWritten(pane: string, paths: string[], ask = (body: unknown) => api<{ found?: Record<string, PathFound[]> }>('/api/files/resolve', body)) {
  const seen = known.get(pane) ?? new Map<string, PathFound[] | 'unknown'>()
  known.set(pane, seen)
  const fresh = [...new Set(paths)].filter(p => !seen.has(p) && !inFlight.has(`${pane}\n${p}`))
  if (!fresh.length) return false
  for (const p of fresh) inFlight.add(`${pane}\n${p}`)
  try {
    const r = await ask({ pane, paths: fresh })
    for (const p of fresh) seen.set(p, r.found?.[p] ?? 'unknown')
  } catch {
    for (const p of fresh) seen.set(p, 'unknown')
  } finally {
    for (const p of fresh) inFlight.delete(`${pane}\n${p}`)
  }
  return true
}
