// One thread of a coordinator's project (`?pane=<id>&id=t-NNNN`): its record
// and Next list, from `herdr-projects thread show --json`. Read-only.
import { readThreadDetail } from '../../utils/projectThreads'

export default defineApi(async (event) => {
  const q = getQuery(event)
  const p = findPane(String(q.pane || ''))
  if (!p) throw new HerdrError('bad_pane', 'Pane not found')
  return readThreadDetail(p, q.id)
})
