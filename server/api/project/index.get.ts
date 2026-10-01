// "Project" panel of a herdr-projects coordinator (`?pane=<id>`), read-only.
// `since=<version>`: replies `{ same: true }` if TASKS.md and the threads have not changed.
import { readProjectBoard } from '../../utils/projectBoard'

export default defineApi(async (event) => {
  const q = getQuery(event)
  const p = findPane(String(q.pane || ''))
  if (!p) throw new HerdrError('bad_pane', 'pane introuvable')
  return readProjectBoard(p, typeof q.since === 'string' ? q.since.slice(0, 200) : undefined)
})
