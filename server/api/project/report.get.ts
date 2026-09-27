// Rapport d'un thread du projet d'un coordinateur (`?pane=<id>&id=t-NNNN`), lecture seule.
import { readThreadReport } from '../../utils/projectBoard'

export default defineApi(async (event) => {
  const q = getQuery(event)
  const p = findPane(String(q.pane || ''))
  if (!p) throw new HerdrError('bad_pane', 'pane introuvable')
  return readThreadReport(p, String(q.id || ''))
})
