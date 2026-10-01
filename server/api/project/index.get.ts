// Panneau « Projet » d'un coordinateur herdr-projects (`?pane=<id>`), lecture seule.
// `since=<version>` : réponse `{ same: true }` si TASKS.md et les threads n'ont pas bougé.
import { readProjectBoard } from '../../utils/projectBoard'

export default defineApi(async (event) => {
  const q = getQuery(event)
  const p = findPane(String(q.pane || ''))
  if (!p) throw new HerdrError('bad_pane', 'Pane not found')
  return readProjectBoard(p, typeof q.since === 'string' ? q.since.slice(0, 200) : undefined)
})
