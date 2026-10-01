// New app version after a redeployment: never a forced reload
// during use. We compare the identifier of the loaded build with the one
// the server serves (/_nuxt/builds/latest.json) and offer a
// "Reload" banner. Only exception: a code chunk not found (view not
// loaded yet, deleted by the deployment); we then reload to the
// requested view, only once (guard in sessionStorage, no loop).
// Not to be confused with the new image notice (server/utils/updates.ts).

const GUARD_KEY = 'wherdr:chunk-reload'
// A second failure within this delay after a reload = the new version
// is not enough: we stop at the banner.
export const CHUNK_RELOAD_GUARD_MS = 30000

// True if the server announces a build other than the one running.
export function isNewBuild(current: string | undefined, latest: unknown): boolean {
  if (!current || !latest || typeof latest !== 'object') return false
  const id = (latest as { id?: unknown }).id
  return typeof id === 'string' && id !== '' && id !== current
}

// Error loading a code chunk (dynamic import): wordings
// of Chromium, WebKit and Firefox.
export function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(msg)
}

interface MiniStorage { getItem(k: string): string | null, setItem(k: string, v: string): void }

// Can we reload for a missing chunk? Yes once; no if we
// just reloaded for it (loop). Records the attempt.
export function mayReloadForChunk(storage: MiniStorage | null, now: number): boolean {
  if (!storage) return false
  try {
    const last = Number(storage.getItem(GUARD_KEY) || 0)
    if (last && now - last < CHUNK_RELOAD_GUARD_MS) return false
    storage.setItem(GUARD_KEY, String(now))
    return true
  } catch { return false }
}
