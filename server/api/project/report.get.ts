// Report of a thread of a coordinator's project (`?pane=<id>&id=t-NNNN`), read-only.
import { readThreadReport } from '../../utils/projectBoard'

export default defineApi(async (event) => {
  const q = getQuery(event)
  const p = findPane(String(q.pane || ''))
  if (!p) throw new HerdrError('bad_pane', 'Pane not found')
  return readThreadReport(p, String(q.id || ''))
})
