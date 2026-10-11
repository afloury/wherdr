// Global Board: the Project panel board of every herdr-projects project.
// `since=<version>`: replies `{ same: true }` if nothing changed.
// `refresh=<key>&refresh=<key>`: projects to re-read in full (no per-project
// version). Repeated params, not a joined list: a folder path may contain a comma.
import { readGlobalBoard } from '../utils/globalBoard'

const REFRESH_KEYS = 50
const REFRESH_KEY_CHARS = 400

export default defineApi(async (event) => {
  const q = getQuery(event)
  const raw = [q.refresh ?? []].flat()
  const refresh = raw
    .filter((k): k is string => typeof k === 'string' && !!k && k.length <= REFRESH_KEY_CHARS)
    .slice(0, REFRESH_KEYS)
  return readGlobalBoard(typeof q.since === 'string' ? q.since.slice(0, 64) : undefined, refresh)
})
